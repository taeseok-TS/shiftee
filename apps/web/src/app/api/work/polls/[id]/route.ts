import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitWork } from "@/lib/work-events";

// 투표하기 (토글). 단일선택은 기존 표를 교체, 복수선택은 켜고 끄기.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { optionIndex } = (await request.json()) as { optionIndex?: number };
  if (typeof optionIndex !== "number" || !Number.isInteger(optionIndex) || optionIndex < 0)
    return NextResponse.json({ error: "선택지가 올바르지 않습니다." }, { status: 400 });

  const poll = await prisma.workPoll.findUnique({
    where: { id },
    select: { channelId: true, multiple: true, closedAt: true, closesAt: true, options: true, channel: { select: { isDefault: true, members: { select: { userId: true } } } } },
  });
  if (!poll) return NextResponse.json({ error: "투표를 찾을 수 없습니다." }, { status: 404 });
  if (poll.closedAt) return NextResponse.json({ error: "마감된 투표입니다." }, { status: 400 });
  // 종료 시간이 이미 지났으면 표를 받지 않고 즉시 마감 처리 (스케줄러 틱 사이의 늦은 표 방지)
  if (poll.closesAt && poll.closesAt <= new Date()) {
    try {
      const { closePollAndAnnounce } = await import("@/lib/poll-close");
      await closePollAndAnnounce(id, "deadline");
    } catch (e) {
      console.error("[poll] 기한 경과 마감 오류:", e);
    }
    emitWork({ type: "message", channelId: poll.channelId });
    return NextResponse.json({ error: "마감된 투표입니다." }, { status: 400 });
  }
  const isMember = poll.channel.members.some((m) => m.userId === session.userId);
  if (!poll.channel.isDefault && !isMember)
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  const optCount = Array.isArray(poll.options) ? poll.options.length : 0;
  if (optionIndex >= optCount)
    return NextResponse.json({ error: "선택지가 올바르지 않습니다." }, { status: 400 });

  const existing = await prisma.workPollVote.findUnique({
    where: { pollId_userId_optionIndex: { pollId: id, userId: session.userId, optionIndex } },
  });
  let added = true; // 표 추가 여부 — 회수(토글 오프)만 한 경우엔 전원 마감 체크를 하지 않는다
  if (existing) {
    await prisma.workPollVote.delete({ where: { id: existing.id } });
    added = false;
  } else if (!poll.multiple) {
    // 단일선택: 기존 표 제거 + 새 표를 한 트랜잭션으로 (동시 탭으로 2표 남는 것 방지)
    await prisma.$transaction([
      prisma.workPollVote.deleteMany({ where: { pollId: id, userId: session.userId } }),
      prisma.workPollVote.create({ data: { pollId: id, userId: session.userId, optionIndex } }),
    ]);
  } else {
    await prisma.workPollVote.create({ data: { pollId: id, userId: session.userId, optionIndex } });
  }

  // 채팅방 인원 전원이 투표했으면 자동 마감 + 채팅 알림 (활성 사용자 기준)
  // 표 회수(토글 오프)만 한 요청에서는 체크하지 않음 — 표를 빼는 행동이 마감을 트리거하면 안 됨
  if (added) {
    try {
      let eligible: string[];
      if (poll.channel.isDefault) {
        const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
        eligible = users.map((u) => u.id);
      } else {
        const members = await prisma.workChannelMember.findMany({
          where: { channelId: poll.channelId },
          select: { userId: true, user: { select: { isActive: true } } },
        });
        eligible = members.filter((m) => m.user.isActive).map((m) => m.userId);
      }
      const votes = await prisma.workPollVote.findMany({ where: { pollId: id }, select: { userId: true } });
      const voters = new Set(votes.map((v) => v.userId));
      if (eligible.length > 0 && eligible.every((uid) => voters.has(uid))) {
        const { closePollAndAnnounce } = await import("@/lib/poll-close");
        await closePollAndAnnounce(id, "all");
      }
    } catch (e) {
      console.error("[poll] 전원 투표 체크 오류:", e);
    }
  }

  emitWork({ type: "message", channelId: poll.channelId });
  return NextResponse.json({ success: true });
}

// 투표 마감 (생성자 또는 관리자/원장)
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const poll = await prisma.workPoll.findUnique({ where: { id }, select: { creatorId: true, closedAt: true, channelId: true } });
  if (!poll) return NextResponse.json({ error: "투표를 찾을 수 없습니다." }, { status: 404 });
  if (poll.closedAt) return NextResponse.json({ error: "이미 마감된 투표입니다." }, { status: 400 });
  if (poll.creatorId !== session.userId && session.role !== "ADMIN" && session.role !== "MANAGER")
    return NextResponse.json({ error: "투표 마감은 만든 사람 또는 관리자만 가능합니다." }, { status: 403 });

  await prisma.workPoll.update({ where: { id }, data: { closedAt: new Date() } });
  emitWork({ type: "message", channelId: poll.channelId });
  return NextResponse.json({ success: true });
}
