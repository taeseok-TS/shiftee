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
      members: { where: { userId }, select: { lastReadAt: true, notify: true, hiddenAt: true } },
    },
  });

  let total = 0;
  for (const c of channels) {
    const me = c.members[0];
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
