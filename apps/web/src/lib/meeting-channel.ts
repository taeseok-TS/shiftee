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

/**
 * 회의 채팅방 참여자 등록 (2026-09-30 디렉터: 회의 채팅을 살린다).
 *
 * 회의방은 멤버 없이 만들어졌는데, 채팅 읽기·쓰기는 "멤버만"(2026-06-25 부터)이라 회의 화면의 채팅이
 * 그날 이후 누구에게도 열리지 않았다(전원 403). 회의에 들어올 수 있는 사람 — 개설자·초대받은 사람·회의에
 * 들어온 본부 관리자 — 을 그 방의 멤버로 넣는다. 다른 채팅 규칙(접근 검사·실시간 갱신)을 그대로 쓴다.
 * 알림은 MUTE: 회의 중 대화에 푸시가 가지 않게. 방은 숨김이라 채널 목록·안읽음 수에는 잡히지 않는다.
 * 이미 멤버면 건드리지 않는다(skipDuplicates).
 */
export async function addMeetingChatMembers(channelId: string | null | undefined, userIds: string[]): Promise<void> {
  const wanted = [...new Set(userIds.filter((v) => typeof v === "string" && v))];
  if (!channelId || !wanted.length) return;
  // 실제로 있는 사람만 — 초대 명단은 사용자 표와 묶여 있지 않아 없는 id 가 섞여 올 수 있고, 멤버 행은 FK 라 통째로 실패한다
  const ids = (await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true } })).map((u) => u.id);
  if (!ids.length) return;
  await prisma.workChannelMember.createMany({
    data: ids.map((userId) => ({ channelId, userId, notify: "MUTE" as const, lastReadAt: new Date() })),
    skipDuplicates: true,
  });
}
