import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitWork } from "@/lib/work-events";
import { sendPushToUsers } from "@/lib/push";
import { isMentioned } from "@/lib/mention";

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

function shapeReactions(reactions: { emoji: string; userId: string; user: { name: string } }[], myId: string) {
  const map = new Map<string, { emoji: string; count: number; mine: boolean; names: string[] }>();
  for (const r of reactions) {
    const cur = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, names: [] };
    cur.count++;
    cur.names.push(r.user.name); // 누가 눌렀는지 표시용
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
      m.notify === "MENTION" ? isMentioned(message.content, m.user.name) : true
    )
    .map((m) => m.userId);

  const albumCount = Array.isArray((message as { albumUrls?: unknown }).albumUrls)
    ? ((message as { albumUrls?: unknown[] }).albumUrls as unknown[]).length
    : 0;
  const preview = message.content?.trim()
    ? message.content.trim()
    : albumCount > 0
    ? `사진 ${albumCount}장을 보냈습니다.`
    : (message as { fileType?: string | null }).fileType === "audio"
    ? "음성 메시지를 보냈습니다."
    : message.fileUrl
    ? "사진/파일을 보냈습니다."
    : "";

  await sendPushToUsers(recipients, {
    title: channel.name,
    body: `${message.user.name}: ${preview}`,
    data: { channelId: channel.id, type: "work-message" },
  }, { respectWorkMute: true, withWorkBadge: true });
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

  // 멤버들의 lastReadAt (읽음 워터마크 + 메시지별 안 읽은 사람 수 계산에 사용)
  const allMembers = await prisma.workChannelMember.findMany({
    where: { channelId: id },
    select: { userId: true, lastReadAt: true },
  });
  const otherReads = allMembers.filter((m) => m.userId !== session.userId).map((m) => m.lastReadAt);
  const readWatermark =
    otherReads.length > 0 && otherReads.every((t) => t)
      ? new Date(Math.min(...otherReads.map((t) => t!.getTime())))
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
      user: { select: { id: true, name: true, avatarUrl: true, branch: true } },
      reactions: { select: { emoji: true, userId: true, user: { select: { name: true } } } },
      _count: { select: { replies: true } },
      replyTo: { select: { id: true, content: true, deletedAt: true, user: { select: { name: true } } } },
      poll: { include: { votes: { select: { userId: true, optionIndex: true } } } },
      bookmarks: { where: { userId: session.userId }, select: { id: true } },
    },
    // 최신 300개를 가져와 시간순으로 뒤집는다 (asc+take는 "가장 오래된 300개"가 되어
    // 메시지가 300개를 넘는 순간 새 메시지가 영영 안 보이는 버그가 됨)
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  messages.reverse();

  // 투표 카드 데이터 변환 (옵션별 득표수 + 내 선택)
  const shapePoll = (p: (typeof messages)[number]["poll"]) => {
    if (!p) return null;
    const options = (Array.isArray(p.options) ? p.options : []) as string[];
    const counts = options.map((_, i) => p.votes.filter((v) => v.optionIndex === i).length);
    const myVotes = p.votes.filter((v) => v.userId === session.userId).map((v) => v.optionIndex);
    const totalVoters = new Set(p.votes.map((v) => v.userId)).size;
    return {
      id: p.id,
      question: p.question,
      options,
      multiple: p.multiple,
      closed: !!p.closedAt,
      closesAt: p.closesAt,
      counts,
      myVotes,
      totalVoters,
      creatorId: p.creatorId,
      creatorName: p.creatorName,
    };
  };

  return NextResponse.json({
    readWatermark,
    // 채널 고정 공지 (없으면 null). unreadCount = 공지 등록 후 채널을 안 연 멤버 수
    notice: acc.channel.noticeContent || acc.channel.noticeImageUrl
      ? {
          content: acc.channel.noticeContent ?? "",
          imageUrl: acc.channel.noticeImageUrl ?? null,
          by: acc.channel.noticeBy,
          at: acc.channel.noticeAt,
          important: acc.channel.noticeImportant,
          unreadCount: acc.channel.noticeAt
            ? allMembers.filter((m) => !m.lastReadAt || m.lastReadAt < acc.channel.noticeAt!).length
            : 0,
        }
      : null,
    messages: messages.map((m) => ({
      id: m.id,
      userId: m.userId,
      userName: m.user.name,
      userAvatar: m.user.avatarUrl,
      userBranch: m.user.branch,
      content: m.deletedAt ? "" : m.content,
      fileUrl: m.deletedAt ? null : m.fileUrl,
      albumUrls: m.deletedAt ? null : (m.albumUrls as string[] | null),
      fileName: m.deletedAt ? null : m.fileName,
      fileType: m.deletedAt ? null : m.fileType,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      deleted: !!m.deletedAt,
      system: m.system,
      poll: shapePoll(m.poll),
      bookmarked: m.bookmarks.length > 0,
      replyTo: m.replyTo
        ? { id: m.replyTo.id, userName: m.replyTo.user.name, content: m.replyTo.deletedAt ? "삭제된 메시지" : m.replyTo.content, deleted: !!m.replyTo.deletedAt }
        : null,
      mine: m.userId === session.userId,
      reactions: shapeReactions(m.reactions, session.userId),
      replyCount: m._count.replies,
      // 안 읽은 사람 수: 이 메시지 발신자 제외, lastReadAt이 메시지 시각보다 이전(또는 없음)인 멤버 수
      unreadBy: allMembers.filter((mm) => mm.userId !== m.userId && (!mm.lastReadAt || mm.lastReadAt < m.createdAt)).length,
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

  const { content, fileUrl, fileName, fileType, parentId, replyToId, albumUrls } = await request.json();
  // 앨범(여러 장 묶음): 내부 업로드 경로의 이미지 URL 2~10장
  const album: string[] | null =
    Array.isArray(albumUrls) && albumUrls.length >= 2
      ? (albumUrls as unknown[]).filter((u): u is string => typeof u === "string" && u.startsWith("/api/uploads/")).slice(0, 10)
      : null;
  if (!content?.trim() && !fileUrl && (!album || album.length < 2))
    return NextResponse.json({ error: "메시지를 입력해주세요." }, { status: 400 });

  const message = await prisma.workMessage.create({
    data: {
      channelId: id,
      userId: session.userId,
      content: content?.trim() ?? "",
      fileUrl: fileUrl ?? null,
      fileName: fileName ?? null,
      fileType: fileType ?? null,
      albumUrls: album ?? undefined,
      parentId: parentId ?? null,
      replyToId: replyToId ?? null,
    },
    include: {
      user: { select: { id: true, name: true, avatarUrl: true, branch: true } },
      replyTo: { select: { id: true, content: true, deletedAt: true, user: { select: { name: true } } } },
    },
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
      userAvatar: message.user.avatarUrl,
      userBranch: message.user.branch,
      content: message.content,
      fileUrl: message.fileUrl,
      albumUrls: (message.albumUrls as string[] | null) ?? null,
      fileName: message.fileName,
      fileType: message.fileType,
      parentId: message.parentId,
      createdAt: message.createdAt,
      editedAt: null,
      deleted: false,
      replyTo: message.replyTo
        ? { id: message.replyTo.id, userName: message.replyTo.user.name, content: message.replyTo.deletedAt ? "삭제된 메시지" : message.replyTo.content, deleted: !!message.replyTo.deletedAt }
        : null,
      mine: true,
      reactions: [],
      replyCount: 0,
    },
  });
}
