import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { isResigned, kstTodayMidnight } from "@/lib/resign";

/**
 * 퇴사자 채팅방 정리 (2026-09-23 디렉터 지시).
 *
 * 퇴사하면 계정은 잠기지만 큐브티워크 채팅방 멤버로는 그대로 남아 있었다. 방 인원에 계속 세어지고,
 * 방장이었다면 그 방은 방장 없는 방이 된다(방장 지정은 생성자나 관리자만 할 수 있어 아무도 못 고친다).
 *
 * 디렉터 확정 사항
 *  - 그룹 채널에서는 **바로** 내보낸다(퇴사일이 지난 그날).
 *  - 나가는 표시(시스템 메시지)는 남기지 않는다 — 퇴사자가 몰리면 방이 안내로 도배된다.
 *  - 1:1 대화(DM)는 지우지 않고 **상대 목록에서만 숨긴다** — 지난 대화는 검색으로 다시 찾을 수 있다.
 *  - 방장을 넘겨받은 사람에게는 봇 DM 으로 알린다.
 *
 * ⚠ 메시지는 지우지 않는다. 대화 맥락이 끊기면 남은 사람들이 기록을 못 읽는다.
 * ⚠ 되돌릴 수 있어야 한다(퇴사일 오입력) — 어느 방에서 뺐고 누구에게 넘겼는지 감사 로그에 남긴다.
 */

const SYSTEM_ACTOR = { actorId: "system", actorName: "큐브티" };

type Handover = { channelId: string; channelName: string; successorId: string };

/** 퇴사자가 방장을 넘길 사람 — ① 남은 다른 방장 ② 원장(먼저 들어온 순) ③ 먼저 들어온 멤버 */
function pickSuccessor(
  members: { userId: string; isManager: boolean; joinedAt: Date; user: { role: string } }[],
): { id: string; alreadyManager: boolean } | null {
  const alive = members.slice().sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  if (!alive.length) return null;
  const other = alive.find((m) => m.isManager);
  if (other) return { id: other.userId, alreadyManager: true };
  const manager = alive.find((m) => m.user.role === "MANAGER");
  return { id: (manager ?? alive[0]).userId, alreadyManager: false };
}

/**
 * 한 사람 정리. 이미 정리된 사람을 다시 불러도 안전하다(멤버행이 없으면 아무것도 안 한다).
 * 반환: 무엇을 했는지 — 호출한 쪽이 요약을 남길 수 있게.
 */
export async function cleanupResignedUserChannels(userId: string): Promise<{
  name: string;
  removed: number;
  hiddenDms: number;
  handovers: Handover[];
}> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  const name = user?.name || "(이름 없음)";

  const rows = await prisma.workChannelMember.findMany({
    where: { userId, channel: { type: "CHANNEL", deletedAt: null } },
    select: { channelId: true, isManager: true, channel: { select: { name: true, createdBy: true } } },
  });

  const handovers: Handover[] = [];
  let removed = 0;

  for (const row of rows) {
    const needsSuccessor = row.isManager || row.channel.createdBy === userId;

    if (needsSuccessor) {
      // 남은 멤버 중에서 고른다 — 퇴사·비활성인 사람에게 넘기면 같은 문제가 되풀이된다
      const others = await prisma.workChannelMember.findMany({
        where: {
          channelId: row.channelId,
          userId: { not: userId },
          user: { isActive: true, deletedAt: null, employmentStatus: { not: "RESIGNED" } },
        },
        select: {
          userId: true, isManager: true, joinedAt: true,
          user: { select: { role: true, resignDate: true } },
        },
        orderBy: { joinedAt: "asc" },
      });
      // 퇴사일이 지난 사람(재직상태가 아직 안 바뀐 경우)도 뺀다
      const alive = others.filter((m) => !isResigned(m.user.resignDate));
      const pick = pickSuccessor(alive);
      if (pick) {
        if (!pick.alreadyManager) {
          await prisma.workChannelMember.update({
            where: { channelId_userId: { channelId: row.channelId, userId: pick.id } },
            data: { isManager: true },
          });
          handovers.push({ channelId: row.channelId, channelName: row.channel.name, successorId: pick.id });
        }
        // 생성자 자리도 넘긴다 — 생성자가 퇴사자로 남으면 그 방은 관리자 말고는
        // 방장 지정도 방 정리도 못 한다(생성자 전용 권한이라서).
        if (row.channel.createdBy === userId) {
          await prisma.workChannel.update({ where: { id: row.channelId }, data: { createdBy: pick.id } });
        }
      }
      // 남은 사람이 아무도 없으면 방은 그대로 둔다 — 기록은 지우지 않는다(관리자가 열람 가능)
    }

    await prisma.workChannelMember.deleteMany({ where: { channelId: row.channelId, userId } });
    removed++;
  }

  // DM — 상대 목록에서만 숨긴다(이미 숨긴 사람은 건드리지 않는다)
  const dmIds = (
    await prisma.workChannelMember.findMany({
      where: { userId, channel: { type: "DM" } },
      select: { channelId: true },
    })
  ).map((r) => r.channelId);
  const hidden = dmIds.length
    ? await prisma.workChannelMember.updateMany({
        where: { channelId: { in: dmIds }, userId: { not: userId }, hiddenAt: null },
        data: { hiddenAt: new Date() },
      })
    : { count: 0 };

  if (removed || hidden.count || handovers.length) {
    await logAudit({
      ...SYSTEM_ACTOR,
      action: "RESIGN_CHAT_CLEANUP",
      targetType: "USER",
      targetId: userId,
      targetName: name,
      // 되돌릴 때 쓰는 근거 — 방 id 까지 남긴다
      detail:
        `퇴사 정리: 채널 ${removed}곳에서 내보냄` +
        (handovers.length ? `, 방장 넘김 ${handovers.length}곳` : "") +
        (hidden.count ? `, DM ${hidden.count}건 숨김` : "") +
        ` [${rows.map((r) => r.channelId).join(",")}]` +
        (handovers.length ? ` 승계: ${handovers.map((h) => `${h.channelName}→${h.successorId}`).join(" / ")}` : ""),
    });
  }

  // 새 방장에게 알림 — 사람별로 묶어 한 번만 보낸다(여러 방을 한꺼번에 넘겨받을 수 있다)
  if (handovers.length) {
    const { botSendDM } = await import("@/lib/bot");
    const byUser = new Map<string, string[]>();
    for (const h of handovers) byUser.set(h.successorId, [...(byUser.get(h.successorId) || []), h.channelName]);
    for (const [uid, names] of byUser) {
      const list = names.map((n) => `「${n}」`).join(", ");
      await botSendDM(
        uid,
        `${name}님 퇴사로 ${list} 채팅방의 방장을 맡게 되셨습니다.\n` +
          `방 이름 변경, 인원 추가·내보내기를 하실 수 있습니다. 다른 분께 넘기시려면 채팅방 설정에서 바꿔주세요.`,
      ).catch(() => { /* 알림 실패가 정리 자체를 막으면 안 된다 */ });
    }
  }

  return { name, removed, hiddenDms: hidden.count, handovers };
}

/**
 * 매일 한 번 — 퇴사일이 지났는데 아직 채팅방에 남아 있는 사람을 모두 정리한다.
 * 미래 퇴사일은 그날이 되어야 처리되므로(퇴사 처리 시점에 한 번 도는 것만으로는 부족하다) 이 쓸이가 필요하다.
 */
export async function runResignChatCleanupDaily(): Promise<{ users: number; channels: number }> {
  // 퇴사일 '당일'은 아직 재직이다(마지막 근무일) — 날짜가 지난 사람만 정리한다
  const today = kstTodayMidnight();
  const targets = await prisma.user.findMany({
    where: {
      OR: [{ employmentStatus: "RESIGNED" }, { resignDate: { lt: today } }],
      workChannelMembers: { some: {} },
    },
    select: { id: true },
    take: 200, // 한 번에 몰아 돌지 않는다 — 남은 사람은 다음 날 처리된다
  });

  let channels = 0;
  for (const t of targets) {
    try {
      const r = await cleanupResignedUserChannels(t.id);
      channels += r.removed;
    } catch (e) {
      console.error("[퇴사 채팅 정리] 실패:", t.id, e);
    }
  }
  return { users: targets.length, channels };
}
