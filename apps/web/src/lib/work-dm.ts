// 1:1 DM 방 찾기·만들기 — channels 라우트 POST 의 DM 분기를 그대로 옮긴 것(2026-10-26).
// 「한 번에 보내기」(/api/work/broadcast)가 사람마다 DM 방이 필요해서 꺼냈다. 동작은 그대로다.
import { prisma } from "@/lib/db";

/**
 * 나(meId)와 상대(otherId)의 DM 방을 돌려준다. 기존 1:1 DM 있으면 재사용.
 * 한쪽이 나가서 소프트 삭제됐던 DM이면 되살린다
 * (안 그러면 deletedAt이 남아 목록에서 계속 숨겨져 "초대해도 안 생김"이 됨).
 * 다시 대화를 시작하면 내가 숨겼던 DM을 다시 보이게 한다.
 */
export async function findOrCreateDM(meId: string, otherId: string) {
  const existing = await prisma.workChannel.findFirst({
    where: {
      type: "DM",
      AND: [
        { members: { some: { userId: meId } } },
        { members: { some: { userId: otherId } } },
      ],
    },
  });
  if (existing) {
    await prisma.workChannelMember.updateMany({
      where: { channelId: existing.id, userId: meId },
      data: { hiddenAt: null },
    });
    if (existing.deletedAt) {
      await prisma.workChannel.update({
        where: { id: existing.id },
        data: { deletedAt: null, permanentlyDeletedAt: null },
      });
      return { ...existing, deletedAt: null, permanentlyDeletedAt: null };
    }
    return existing;
  }

  return prisma.workChannel.create({
    data: {
      name: "DM",
      type: "DM",
      createdBy: meId,
      members: { create: [{ userId: meId }, { userId: otherId }] },
    },
  });
}
