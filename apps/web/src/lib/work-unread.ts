import { prisma } from "./db";
import { isMentioned } from "./mention";

// 사용자의 큐브티워크 미확인 메시지 총 개수 — 앱 메신저 탭 배지·앱 아이콘 뱃지(푸시 badge) 공용.
// 채널 목록의 unread 계산과 동일 규칙(멤버 채널+전체채널, MUTE 제외, MENTION 정확매칭).
export async function getWorkUnreadTotal(userId: string, userName: string): Promise<number> {
  const channels = await prisma.workChannel.findMany({
    where: {
      hidden: false,
      deletedAt: null,
      OR: [{ isDefault: true }, { members: { some: { userId } } }],
    },
    select: {
      id: true,
      type: true,
      members: { where: { userId }, select: { lastReadAt: true, notify: true, hiddenAt: true } },
    },
  });

  // 숨긴 DM 은 목록에서 안 보이니 배지에서도 빼야 한다 — 퇴사자 정리로 숨긴 DM 은 상대가 새 메시지를
  // 보낼 수 없어, 안 그러면 읽지 못한 개수가 배지에 영원히 박힌다(검증 resignchat1 [7]).
  // 마지막 메시지 조회는 **숨긴 DM 에 대해서만** 한다(대개 0건) — 모든 채널에 붙이면 푸시 보낼 때마다
  // 수신자 수만큼 돌아 가장 뜨거운 경로가 무거워진다([R5]). 판정 규칙은 채널 목록과 같다.
  const hiddenDmIds = channels.filter((c) => c.type === "DM" && c.members[0]?.hiddenAt).map((c) => c.id);
  const revived = new Set<string>();
  for (const id of hiddenDmIds) {
    const c = channels.find((x) => x.id === id)!;
    const last = await prisma.workMessage.findFirst({
      where: { channelId: id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last && c.members[0]?.hiddenAt && last.createdAt > c.members[0].hiddenAt) revived.add(id);
  }

  let total = 0;
  for (const c of channels) {
    const me = c.members[0];
    if (c.type === "DM" && me?.hiddenAt && !revived.has(c.id)) continue;
    const notify = me?.notify ?? "ALL";
    if (notify === "MUTE") continue;
    const afterRead = me?.lastReadAt ? { createdAt: { gt: me.lastReadAt } } : {};
    if (notify === "MENTION") {
      const cands = await prisma.workMessage.findMany({
        where: { channelId: c.id, parentId: null, userId: { not: userId }, ...afterRead, OR: [{ content: { contains: `@${userName}` } }, { content: { contains: "@전체" } }, { content: { contains: "@all" } }] },
        select: { content: true },
      });
      total += cands.filter((m) => isMentioned(m.content, userName)).length;
    } else {
      total += await prisma.workMessage.count({
        where: { channelId: c.id, parentId: null, userId: { not: userId }, ...afterRead },
      });
    }
  }
  return total;
}
