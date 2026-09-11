import type { Prisma } from "@prisma/client";
import { isLeaveDeductible } from "@/lib/leave-types";
import { leaveYearOfLeave } from "@/lib/leave-calc";
import { restoreLeaveBalance } from "@/lib/leave-balance";
import { prisma } from "@/lib/db";
import { kstTodayMidnight } from "@/lib/resign";
import { logAudit } from "@/lib/audit";

/**
 * 승인된 휴가의 **취소 결재** — 최종 승인 처리와 결재함 조건을 한 곳에 둔다.
 *
 * 디렉터 확정(2026-09-11, 내부 회의): 승인된 연차는 버튼으로 바로 취소하지 않는다. 휴가 쓴 **본인**이
 * "취소 결재"를 올리고 결재선은 **항상 관리자까지**(직원 [원장→관리자], 원장 [메인 원장→관리자]/[관리자]).
 * 올릴 수 있는 기한은 **시작 전날까지**. 결재가 도는 동안 연차는 차감된 채이고, **최종 승인 순간**
 * 원 휴가를 CANCELLED 로 바꾸며 **휴가를 쓰는 해** 행에 복구한다(차감과 같은 해). 반려되면 휴가는 그대로다.
 *
 * ⚠ 연차 **복구는 여기(applyLeaveCancel) 한 곳에서만** 한다. 휴가 취소 라우트(PATCH /api/leave/[id])는
 *   이제 대기 건만 거두므로 복구하지 않는다 — 복구 경로가 둘이면 한쪽만 고치는 일이 생긴다.
 */

type Tx = Prisma.TransactionClient;

/** 트랜잭션 안에서 "이미 처리됨"을 알리려고 던진다 — 호출부가 잡아 409 로 돌려준다(던지면 롤백된다). */
export class CancelConflict extends Error {}

/**
 * 최종 승인 — ① 취소 결재를 잡고 ② 원 휴가를 CANCELLED 로 ③ 차감된 연도 행에 연차 복구.
 * ①②는 조건부(CAS)라 두 사람이 동시에 최종 승인해도 한 번만 복구된다. 어느 하나라도 못 잡으면 던진다.
 *
 * 복구 연도 = **휴가를 쓰는 해**(시작일 기준, 9/11 디렉터) — 차감과 같은 함수(leaveYearOfLeave)로 정한다.
 * 종전에는 승인 시각(updatedAt)에서 역산해 "휴가 행을 고치는 경로는 승인·취소뿐"이라는 전제에 기댔다.
 */
export async function applyLeaveCancel(
  tx: Tx,
  cancelRequestId: string,
  leave: { id: string; userId: string; type: Parameters<typeof isLeaveDeductible>[0]; days: number; startDate: Date },
  approverId: string
): Promise<{ restoredDays: number; year: number }> {
  const won = await tx.leaveCancelRequest.updateMany({
    where: { id: cancelRequestId, status: "PENDING" },
    data: { status: "APPROVED", approverId },
  });
  if (won.count !== 1) throw new CancelConflict("이미 처리된 취소 결재입니다.");

  const year = leaveYearOfLeave(leave.startDate);
  // "시작 전"도 같은 조건부 갱신 안에서 본다 — 결재 라우트의 시작일 검사는 트랜잭션 밖이라
  // 23:59:59 에 통과하고 00:00 에 커밋되면 시작일 당일에 취소·복구가 성립했다(9/11 검증).
  const cancelled = await tx.leaveRequest.updateMany({
    where: { id: leave.id, status: "APPROVED", startDate: { gt: kstTodayMidnight() } },
    data: { status: "CANCELLED" },
  });
  if (cancelled.count !== 1) {
    throw new CancelConflict("휴가 상태가 바뀌었거나 이미 시작돼 취소할 수 없습니다. 연차 정정은 관리자 '잔여 조정'으로 해주세요.");
  }

  // 차감과 **같은 함수**로 차감 유형인지 본다(대체휴무·특별휴가 등은 차감도 복구도 없다)
  let restoredDays = 0;
  if (isLeaveDeductible(leave.type)) {
    restoredDays = await restoreLeaveBalance(tx, leave.userId, year, leave.days);   // 차감과 같은 파일의 짝 함수
  }
  return { restoredDays, year };
}

/**
 * 취소 결재 결재함 조건 — 결재함 API 와 대시보드 숫자가 **같은 조건**을 쓴다
 * (9/9 대시보드 숫자가 결재함과 어긋났던 교훈). 휴가 결재함(my-approvals)과 같은 규칙:
 * 본인 요청 제외 · 관리자는 대기 중인 모든 단계 · 원장은 못박힌 단계 또는 담당 지점의 미지정 단계.
 */
export function cancelStepWhere(
  session: { userId: string; role: string },
  myBranches: string[],
  today: Date = kstTodayMidnight()
) {
  return {
    status: "PENDING" as const,
    // 휴가 첫날부터는 승인할 수 없으니 결재함·숫자에서도 뺀다(9/11 디렉터 "시작일부터 승인 막기").
    // 남은 요청은 봇이 매시 기한 만료로 닫는다(expireStaleCancelRequests).
    cancelRequest: {
      userId: { not: session.userId },
      status: "PENDING" as const,
      leaveRequest: { startDate: { gt: today } },
    },
    ...(session.role === "ADMIN"
      ? {}
      : {
          OR: [
            { approverId: session.userId },
            ...(session.role === "MANAGER"
              ? [{ approverRole: "MANAGER", branch: { in: myBranches }, approverId: null }]
              : []),
          ],
        }),
  };
}

export const LEAVE_TYPE_LABEL: Record<string, string> = {
  ANNUAL: "연차", HALF_AM: "오전반차", HALF_PM: "오후반차",
  QUARTER_AM: "오전반반차", QUARTER_PM: "오후반반차",
  SICK: "병가", PERSONAL: "개인휴가", SPECIAL: "특별휴가",
  COMPENSATORY: "대체휴무", COMPENSATORY_HALF: "대체휴무반차",
  CIVIL_DEFENSE: "민방위", RESERVE_FORCES: "예비군훈련",
  MATERNITY: "출산휴가", BEREAVEMENT: "상주휴가",
  FAMILY_EVENT: "경조사", FAMILY_MARRIAGE: "결혼", FAMILY_BIRTH: "출산", FAMILY_BEREAVEMENT: "사망(조사)",
};

export const ymdOf = (d: Date) => d.toISOString().slice(0, 10);

const EXPIRE_REASON = "기한 만료 — 휴가 시작 전까지 결재가 끝나지 않았습니다";

/**
 * 휴가 첫날이 되도록 끝나지 않은 취소 결재를 **기한 만료**로 닫는다(9/11 디렉터 "시작일부터 승인 막기").
 * 봇이 매시 1회 부른다. 결재 라우트가 시작일부터 승인을 막으므로(최종 방어) 이건 결재함·신청자 화면 정리다.
 * 휴가는 그대로 유지된다 — 정정이 필요하면 관리자 "잔여 조정".
 * ⚠ 조회(GET)에서 부르지 말 것 — 무중단 배포의 프록시가 GET 을 재시도하므로 GET 은 순수해야 한다.
 */
export async function expireStaleCancelRequests(): Promise<number> {
  const today = kstTodayMidnight();
  const stale = await prisma.leaveCancelRequest.findMany({
    where: { status: "PENDING", leaveRequest: { startDate: { lte: today } } },
    include: {
      user: { select: { name: true } },
      leaveRequest: { select: { id: true, type: true, startDate: true, endDate: true } },
    },
    take: 200,
  });
  let closed = 0;
  for (const cr of stale) {
    let done = false;
    // 건별로 감싼다 — 결재 라우트(단계→요청)와 잠금 순서가 반대라 드물게 교착으로 한쪽이 중단되는데,
    // 그때 루프 전체가 던지면 남은 건이 다음 시간으로 밀린다(9/11 검증). 실패한 건은 다음 틱에 다시 줍는다.
    try {
    await prisma.$transaction(async (tx) => {
      // 결재자가 같은 순간 처리해도 한쪽만 성립한다(조건부)
      const r = await tx.leaveCancelRequest.updateMany({
        where: { id: cr.id, status: "PENDING" },
        data: { status: "REJECTED", rejectedReason: EXPIRE_REASON },
      });
      if (r.count === 0) return;
      done = true;
      await tx.leaveCancelStep.updateMany({
        where: { cancelRequestId: cr.id, status: { in: ["PENDING", "WAITING"] } },
        data: { status: "REJECTED", comment: "기한 만료", decidedAt: new Date() },
      });
    });
    } catch (e) {
      console.error("[leave-cancel] 기한 만료 처리 실패(다음 틱에 재시도):", cr.id, e);
      continue;
    }
    if (!done) continue;
    closed++;
    const period = `${ymdOf(cr.leaveRequest.startDate)} ~ ${ymdOf(cr.leaveRequest.endDate)}`;
    await logAudit({
      actorId: "cubetee-bot", actorName: "큐브티 봇", action: "LEAVE_CANCEL_EXPIRE",
      targetType: "LEAVE", targetId: cr.leaveRequest.id, targetName: cr.user?.name ?? null,
      detail: `휴가 취소 요청 기한 만료 — 휴가 시작 전까지 결재가 끝나지 않음 (${period})`,
    }).catch(() => {});
    const { botSendDM } = await import("@/lib/bot");   // bot.ts 가 이 파일을 부르므로 순환을 피한다
    // 순서대로 보낸다 — 한 사람에게 2건이 한 번에 나가면 봇 DM 방 조회→생성 경쟁으로 방이 둘 생길 수 있다
    await botSendDM(
      cr.userId,
      `⏰ 휴가 취소 요청이 기한 만료로 닫혔습니다.\n\n${LEAVE_TYPE_LABEL[cr.leaveRequest.type] || cr.leaveRequest.type} ${period}\n휴가 시작 전까지 결재가 끝나지 않아 휴가는 그대로 유지됩니다. 연차 정정이 필요하면 관리자에게 요청해주세요.`
    ).catch(() => {});
  }
  return closed;
}
