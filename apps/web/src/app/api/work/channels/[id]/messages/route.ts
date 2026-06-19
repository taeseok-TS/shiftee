import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitWork } from "@/lib/work-events";

async function assertAccess(channelId: string, userId: string) {
  const channel = await prisma.workChannel.findUnique({
    where: { id: channelId },
    include: { members: { select: { userId: true } } },
  });
  if (!channel) return { error: "채널을 찾을 수 없습니다.", status: 404 as const };
  if (channel.type === "DM" && !channel.members.some((m) => m.userId === userId))
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
