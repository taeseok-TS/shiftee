// 회의 전용 채팅방 정리 (2026-09-30).
//
// 화상회의를 열면 「회의: …」 채팅방이 하나 같이 만들어진다(목록에서는 숨김, 멤버 없음 — 회의 화면에서만 쓴다).
// 회의가 끝나도 이 방은 그대로 남아, 아무도 들어갈 수 없는 빈 방이 계속 쌓였다(운영 35개).
// 끝난 회의의 방은 휴지통으로 보낸다 — 대화가 있던 방은 관리자가 휴지통에서 복구해 볼 수 있다.
// (영구 삭제는 하지 않는다. 휴지통 목록은 대화가 없는 회의방을 보여 주지 않는다 — channels/trash)
import { prisma } from "@/lib/db";

/** 끝난 회의의 채팅방을 휴지통으로. 여러 번 불러도 안전(이미 보낸 방은 건드리지 않는다). 보낸 개수를 돌려준다. */
export async function trashEndedMeetingChannels(): Promise<number> {
  // 살아 있는 숨김 방만 본다 — 진행 중 회의 + 아직 정리 안 된 방이라 몇 개 안 된다
  const live = await prisma.workChannel.findMany({
    where: { hidden: true, type: "CHANNEL", deletedAt: null },
    select: { id: true },
  });
  if (!live.length) return 0;
  const ended = await prisma.workMeeting.findMany({
    where: { channelId: { in: live.map((c) => c.id) }, endedAt: { not: null } },
    select: { channelId: true },
  });
  const ids = ended.map((m) => m.channelId).filter((v): v is string => !!v);
  if (!ids.length) return 0;
  const permanentlyDeletedAt = new Date();
  permanentlyDeletedAt.setDate(permanentlyDeletedAt.getDate() + 30);
  const r = await prisma.workChannel.updateMany({
    where: { id: { in: ids }, hidden: true, deletedAt: null },
    data: { deletedAt: new Date(), permanentlyDeletedAt },
  });
  return r.count;
}
