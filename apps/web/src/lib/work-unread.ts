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
      // 숨긴 DM 판정용 — 채널 목록과 같은 규칙(숨긴 뒤 새 메시지가 오면 다시 센다)
      messages: { where: { parentId: null }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  let total = 0;
  for (const c of channels) {
    const me = c.members[0];
    // 목록에서 안 보이는 DM 은 배지에서도 빼야 한다. 퇴사자 정리로 숨긴 DM 은 상대가 새 메시지를
    // 보낼 수 없어, 안 그러면 읽지 못한 개수가 배지에 영원히 박힌다(검증 resignchat1 [7]).
    if (c.type === "DM" && me?.hiddenAt) {
      const last = c.messages[0];
      if (!last || last.createdAt <= me.hiddenAt) continue;
    }
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
