import { prisma } from "@/lib/db";
import { emitWork } from "@/lib/work-events";
import { ensureBot } from "@/lib/bot";

// 투표 마감 + 채팅방 시스템 알림. 전원 투표 완료(vote 라우트)와
// 종료 시간 도래(봇 스케줄러) 두 경로에서 공용.
export async function closePollAndAnnounce(pollId: string, reason: "all" | "deadline") {
  // 동시 호출 방어: 이미 마감된 투표면 알림 없이 종료 (updateMany 조건부 갱신)
  const res = await prisma.workPoll.updateMany({
    where: { id: pollId, closedAt: null },
    data: { closedAt: new Date() },
  });
  if (res.count === 0) return;

  const poll = await prisma.workPoll.findUnique({
    where: { id: pollId },
    select: { channelId: true, question: true, options: true, votes: { select: { userId: true, optionIndex: true } } },
  });
  if (!poll) return;

  const options = (Array.isArray(poll.options) ? poll.options : []) as string[];
  const counts = options.map((_, i) => poll.votes.filter((v) => v.optionIndex === i).length);
  const totalVoters = new Set(poll.votes.map((v) => v.userId)).size;
  const max = counts.length ? Math.max(...counts) : 0;
  const top = max > 0 ? options.filter((_, i) => counts[i] === max) : [];
  const result = totalVoters === 0
    ? "참여자 없음"
    : `최다 득표: ${top.join(", ")} (${max}표) · ${totalVoters}명 참여`;
  const why = reason === "all" ? "전원 참여 완료" : "종료 시간 도래";

  const botId = await ensureBot();
  await prisma.workMessage.create({
    data: {
      channelId: poll.channelId,
      userId: botId,
      content: `📊 투표 마감 (${why}) · "${poll.question}" — ${result}`,
      system: true,
    },
  });
  emitWork({ type: "message", channelId: poll.channelId });
}

// 종료 시간이 지난 열린 투표를 일괄 마감 (봇 스케줄러 매분 호출)
// 휴지통(soft delete)에 있는 채널의 투표는 건드리지 않음 — runScheduledMessages와 동일 규칙
export async function runPollDeadlines() {
  const due = await prisma.workPoll.findMany({
    where: { closedAt: null, closesAt: { lte: new Date() }, channel: { deletedAt: null } },
    select: { id: true },
  });
  for (const p of due) {
    try {
      await closePollAndAnnounce(p.id, "deadline");
    } catch (e) {
      console.error("[poll] 자동 마감 오류:", e);
    }
  }
}
