import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitWork } from "@/lib/work-events";
import { sendPushToUsers } from "@/lib/push";

async function assertAccess(channelId: string, userId: string) {
  const channel = await prisma.workChannel.findUnique({
    where: { id: channelId },
    include: { members: { select: { userId: true } } },
  });
  if (!channel) return { error: "채널을 찾을 수 없습니다.", status: 404 as const };
  // 기본 '전체' 채널이 아니면 멤버만 접근 가능 (그룹채널·DM 공통)
  const isMember = channel.members.some((m) => m.userId === userId);
  if (!channel.isDefault && !isMember)
    return { error: "접근 권한이 없습니다.", status: 403 as const };
  return { channel };
}

function shapeReactions(reactions: { emoji: string; userId: string }[], myId: string) {
  const map = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const r of reactions) {
    const cur = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    cur.count++;
    if (r.userId === myId) cur.mine = true;
    map.set(r.emoji, cur);
  }
  return [...map.values()];
}

// 새 메시지에 대한 푸시 알림 발송
async function notifyNewMessage(
  channel: { id: string; name: string },
  message: { content: string; fileUrl: string | null; user: { name: string } },
  senderId: string
) {
  const members = await prisma.workChannelMember.findMany({
    where: { channelId: channel.id, userId: { not: senderId } },
    select: { userId: true, notify: true, user: { select: { name: true } } },
  });

  const recipients = members
    .filter((m) => m.notify !== "MUTE")
    .filter((m) =>
      m.notify === "MENTION" ? message.content.includes(`@${m.user.name}`) : true
    )
    .map((m) => m.userId);

  const preview = message.content?.trim()
    ? message.content.trim()
    : message.fileUrl
    ? "사진/파일을 보냈습니다."
    : "";

  await sendPushToUsers(recipients, {
    title: channel.name,
    body: `${message.user.name}: ${preview}`,
    data: { channelId: channel.id, type: "work-message" },
  });
}

// 채널 메시지 조회 (최상위 메시지만, 댓글 수/반응 포함)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const acc = await assertAccess(id, session.userId);
  if ("error" in acc) return NextResponse.json({ error: acc.error }, { status: acc.status });

  // 읽음 표시용 워터마크: 다른 멤버들의 lastReadAt 중 최솟값 (DM이면 상대 1명)
  const otherMembers = await prisma.workChannelMember.findMany({
    where: { channelId: id, userId: { not: session.userId } },
    select: { lastReadAt: true },
  });
  const readWatermark =
    otherMembers.length > 0 && otherMembers.every((m) => m.lastReadAt)
      ? new Date(Math.min(...otherMembers.map((m) => m.lastReadAt!.getTime())))
      : null;

  // 내 멤버 행의 과거기록 열람 범위 (historyFrom 이후만 표시)
  const myMember = await prisma.workChannelMember.findUnique({
    where: { channelId_userId: { channelId: id, userId: session.userId } },
    select: { historyFrom: true },
  });

  const messages = await prisma.workMessage.findMany({
    where: {
      channelId: id,
      parentId: null,
      ...(myMember?.historyFrom ? { createdAt: { gte: myMember.historyFrom } } : {}),
    },
    include: {
      user: { select: { id: true, name: true } },
      reactions: { select: { emoji: true, userId: true } },
      _count: { select: { replies: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 300,
  });

  return NextResponse.json({
    readWatermark,
    messages: messages.map((m) => ({
      id: m.id,
      userId: m.userId,
      userName: m.user.name,
      content: m.content,
      fileUrl: m.fileUrl,
      fileName: m.fileName,
      fileType: m.fileType,
      createdAt: m.createdAt,
      mine: m.userId === session.userId,
      reactions: shapeReactions(m.reactions, session.userId),
      replyCount: m._count.replies,
    })),
  });
}

// 메시지 전송 (텍스트 / 첨부 / 댓글)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const acc = await assertAccess(id, session.userId);
  if ("error" in acc) return NextResponse.json({ error: acc.error }, { status: acc.status });

  const { content, fileUrl, fileName, fileType, parentId } = await request.json();
  if (!content?.trim() && !fileUrl)
    return NextResponse.json({ error: "메시지를 입력해주세요." }, { status: 400 });

  const message = await prisma.workMessage.create({
    data: {
      channelId: id,
      userId: session.userId,
      content: content?.trim() ?? "",
      fileUrl: fileUrl ?? null,
      fileName: fileName ?? null,
      fileType: fileType ?? null,
      parentId: parentId ?? null,
    },
    include: { user: { select: { id: true, name: true } } },
  });

  emitWork({ type: "message", channelId: id });

  // 푸시 알림(발신자 제외, MUTE 제외, MENTION이면 멘션 시만). 응답을 막지 않게 비동기 발송.
  notifyNewMessage(acc.channel, message, session.userId).catch((e) =>
    console.error("[push] notify 오류:", e)
  );

  return NextResponse.json({
    message: {
      id: message.id,
      userId: message.userId,
      userName: message.user.name,
      content: message.content,
      fileUrl: message.fileUrl,
      fileName: message.fileName,
      fileType: message.fileType,
      parentId: message.parentId,
      createdAt: message.createdAt,
      mine: true,
      reactions: [],
      replyCount: 0,
    },
  });
}
