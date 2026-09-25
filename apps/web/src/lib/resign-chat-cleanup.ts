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
 * 하지 않는 것 (검증 resignchat1)
 *  - **전체 채널(isDefault)은 건드리지 않는다.** 전체 채널은 멤버행이 없어도 모두에게 보이므로 내보내도
 *    막히는 게 없고, 멤버행을 지우면 그 사람의 `lastReadAt` 이 사라져 **복귀했을 때 안읽음이 전체 기록으로
 *    계산된다**. 화면에서도 같은 이유로 "전체 채널은 나갈 수 없다"고 막아 두었다.
 *  - **남은 사람이 아무도 없는 방은 그대로 둔다.** 멤버가 0명이 되면 그 방은 어떤 화면에서도 열 수 없다
 *    (목록·검색·휴지통이 전부 멤버행이나 deletedAt 기준). 기록을 잃지 않으려면 마지막 한 명은 남겨야 한다.
 *  - 메시지는 지우지 않는다.
 *
 * 되돌릴 수 있어야 한다(퇴사일 오입력) — 지운 멤버행의 값(방장·알림 설정·읽은 시각·고정·열람 범위)까지
 * 감사 로그(RESIGN_CHAT_CLEANUP)에 남긴다.
 */

const SYSTEM_ACTOR = { actorId: "system", actorName: "큐브티" };

type Handover = { channelId: string; channelName: string; successorId: string; tookOwner: boolean };
type RemovedRow = {
  c: string; // channelId
  m?: 1; // 방장이었음
  n?: string; // 알림 설정 (ALL 이 아닐 때만)
  p?: 1; // 상단 고정
  r?: string; // lastReadAt
  h?: string; // historyFrom
  j: string; // joinedAt
};

/** 방장을 넘길 사람 — ① 남은 다른 방장 ② 원장(먼저 들어온 순) ③ 먼저 들어온 멤버. 재직 중인 사람만. */
function pickSuccessor(
  members: { userId: string; isManager: boolean; user: { role: string } }[],
): { id: string; alreadyManager: boolean } | null {
  if (!members.length) return null;
  const other = members.find((m) => m.isManager);
  if (other) return { id: other.userId, alreadyManager: true };
  const manager = members.find((m) => m.user.role === "MANAGER");
  return { id: (manager ?? members[0]).userId, alreadyManager: false };
}

/**
 * 한 사람 정리. 이미 정리된 사람을 다시 불러도 안전하다(멤버행이 없으면 아무것도 안 한다).
 * 중간에 실패해도 **그때까지 한 일은 감사 로그에 남긴다** — 되돌릴 근거가 사라지면 안 된다.
 */
export async function cleanupResignedUserChannels(userId: string): Promise<{
  name: string;
  removed: number;
  keptAlone: number;
  hiddenDms: number;
  handovers: Handover[];
}> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  const name = user?.name || "(이름 없음)";

  const rows = await prisma.workChannelMember.findMany({
    where: {
      userId,
      // 전체 채널은 제외 — 위 주석 참고
      channel: { type: "CHANNEL", isDefault: false, deletedAt: null },
    },
    select: {
      channelId: true, isManager: true, notify: true, pinned: true,
      lastReadAt: true, historyFrom: true, joinedAt: true,
      channel: { select: { name: true, createdBy: true } },
    },
    orderBy: { channelId: "asc" },
  });

  const handovers: Handover[] = [];
  const removedRows: RemovedRow[] = [];
  const hiddenDmIds: string[] = [];
  let keptAlone = 0;

  const writeAudit = async () => {
    if (!removedRows.length && !hiddenDmIds.length && !handovers.length) return;
    // 되돌리기용 원본 값 — 너무 길면 잘라 둔다(핵심은 앞쪽 채널 id 들)
    let snapshot = JSON.stringify({ removed: removedRows, dmHidden: hiddenDmIds, handovers });
    if (snapshot.length > 3800) snapshot = snapshot.slice(0, 3800) + "…(생략)";
    await logAudit({
      ...SYSTEM_ACTOR,
      action: "RESIGN_CHAT_CLEANUP",
      targetType: "USER",
      targetId: userId,
      targetName: name,
      detail:
        `퇴사 정리: 채널 ${removedRows.length}곳에서 내보냄` +
        (handovers.length ? `, 방장 넘김 ${handovers.length}곳` : "") +
        (keptAlone ? `, 남은 사람이 없어 유지 ${keptAlone}곳` : "") +
        (hiddenDmIds.length ? `, DM ${hiddenDmIds.length}건 숨김` : "") +
        ` ${snapshot}`,
    }).catch(() => { /* 기록 실패가 정리를 되돌리지는 못한다 */ });
  };

  try {
    for (const row of rows) {
      const needsSuccessor = row.isManager || row.channel.createdBy === userId;
      let successor: { id: string; alreadyManager: boolean } | null = null;

      if (needsSuccessor) {
        // 넘길 사람은 **재직 중인 사람만** — 휴직자에게 넘기면(명부로 만든 휴직 계정은 본인도 모르는
        // 비밀번호라 로그인조차 못 한다) 사실상 방장 없는 방이 된다.
        const others = await prisma.workChannelMember.findMany({
          where: {
            channelId: row.channelId,
            userId: { not: userId },
            user: { isActive: true, deletedAt: null, employmentStatus: "ACTIVE" },
          },
          select: { userId: true, isManager: true, user: { select: { role: true, resignDate: true } } },
          // 같은 트랜잭션에서 만들어진 멤버행은 joinedAt 이 모두 같다 — id 로 순서를 확정한다
          orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
        });
        successor = pickSuccessor(others.filter((m) => !isResigned(m.user.resignDate)));
        if (!successor) {
          // 남은 사람이 없다 — 내보내면 아무도 못 여는 방이 된다. 그대로 둔다.
          keptAlone++;
          continue;
        }
      }

      const pickId = successor?.id;
      const takesOwner = !!pickId && row.channel.createdBy === userId;
      // 한 방의 승계·생성자 이전·내보내기는 한 덩어리로 — 중간에 끊기면 방장 없는 방이 남는다
      await prisma.$transaction(async (tx: typeof prisma) => {
        if (pickId && successor && !successor.alreadyManager) {
          await tx.workChannelMember.updateMany({
            where: { channelId: row.channelId, userId: pickId },
            data: { isManager: true },
          });
        }
        if (takesOwner && pickId) {
          await tx.workChannel.update({ where: { id: row.channelId }, data: { createdBy: pickId } });
        }
        await tx.workChannelMember.deleteMany({ where: { channelId: row.channelId, userId } });
      });

      if (pickId && successor) {
        handovers.push({
          channelId: row.channelId, channelName: row.channel.name,
          successorId: pickId, tookOwner: takesOwner,
        });
      }
      removedRows.push({
        c: row.channelId,
        ...(row.isManager ? { m: 1 as const } : {}),
        ...(row.notify !== "ALL" ? { n: row.notify } : {}),
        ...(row.pinned ? { p: 1 as const } : {}),
        ...(row.lastReadAt ? { r: row.lastReadAt.toISOString() } : {}),
        ...(row.historyFrom ? { h: row.historyFrom.toISOString() } : {}),
        j: row.joinedAt.toISOString(),
      });
    }

    // DM — 상대 목록에서만 숨긴다(이미 숨긴 사람은 건드리지 않는다)
    const dms = await prisma.workChannelMember.findMany({
      where: { userId, channel: { type: "DM" } },
      select: { channelId: true },
    });
    for (const dm of dms) {
      const r = await prisma.workChannelMember.updateMany({
        where: { channelId: dm.channelId, userId: { not: userId }, hiddenAt: null },
        data: { hiddenAt: new Date() },
      });
      if (r.count) hiddenDmIds.push(dm.channelId);
    }
  } finally {
    await writeAudit();
  }

  // 새 방장에게 알림 — 사람별로 묶어 한 번만 보낸다(여러 방을 한꺼번에 넘겨받을 수 있다).
  // 이미 방장이던 사람이 생성자 자리만 넘겨받은 경우는 알리지 않는다(바뀐 게 없다).
  const notifiable = handovers.filter((h) => removedRows.some((r) => r.c === h.channelId) && h.successorId);
  if (notifiable.length) {
    const { botSendDM } = await import("@/lib/bot");
    const byUser = new Map<string, string[]>();
    for (const h of notifiable) byUser.set(h.successorId, [...(byUser.get(h.successorId) || []), h.channelName]);
    for (const [uid, names] of byUser) {
      const list = names.map((n) => `「${n}」`).join(", ");
      await botSendDM(
        uid,
        `${name}님 퇴사로 ${list} 채팅방의 방장을 맡게 되셨습니다.\n` +
          `방 이름 변경, 인원 추가·내보내기를 하실 수 있습니다. 다른 분께 넘기시려면 채팅방 설정에서 바꿔주세요.`,
      ).catch((e) => console.error("[퇴사 채팅 정리] 방장 알림 실패:", uid, e));
    }
  }

  return { name, removed: removedRows.length, keptAlone, hiddenDms: hiddenDmIds.length, handovers };
}

/**
 * 매일 한 번 — 퇴사일이 지났는데 아직 그룹 채널에 남아 있는 사람을 정리한다.
 * 미래 퇴사일은 그날이 되어야 처리되므로(퇴사 처리 시점의 즉시 실행만으로는 부족하다) 이 쓸이가 필요하다.
 *
 * ⚠ 대상 조건은 **그룹 채널 멤버행이 남아 있는 사람**이다. DM 멤버행은 남겨 두므로(상대 목록만 숨김)
 *   "채팅 멤버행이 있는 사람"으로 잡으면 정리가 끝난 퇴사자가 매일 다시 대상에 들어와 자리만 차지한다
 *   — 봇 DM 때문에 거의 모든 직원이 DM 멤버행을 갖고 있다(검증 resignchat1 [1]).
 */
export async function runResignChatCleanupDaily(): Promise<{ users: number; channels: number }> {
  // 퇴사일 '당일'은 아직 재직이다(마지막 근무일) — 날짜가 지난 사람만.
  // 퇴사일 없이 재직상태만 퇴직인 옛 자료도 함께 본다.
  const today = kstTodayMidnight();
  const targets = await prisma.user.findMany({
    where: {
      OR: [
        { resignDate: { lt: today } },
        { AND: [{ employmentStatus: "RESIGNED" }, { resignDate: null }] },
      ],
      workChannelMembers: { some: { channel: { type: "CHANNEL", isDefault: false, deletedAt: null } } },
    },
    select: { id: true },
    orderBy: [{ resignDate: "asc" }, { id: "asc" }], // 오래된 퇴사자부터 — 남으면 다음 날 이어서
    take: 50, // 한 틱을 오래 붙잡지 않는다(그 분의 예약 전송·리마인더가 밀린다)
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
