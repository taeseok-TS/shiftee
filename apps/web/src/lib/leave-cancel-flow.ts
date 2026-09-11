import type { Prisma } from "@prisma/client";
import { isLeaveDeductible } from "@/lib/leave-types";
import { leaveYearOf } from "@/lib/leave-calc";
import { prisma } from "@/lib/db";
import { kstTodayMidnight } from "@/lib/resign";
import { logAudit } from "@/lib/audit";

/**
 * 승인된 휴가의 **취소 결재** — 최종 승인 처리와 결재함 조건을 한 곳에 둔다.
 *
 * 디렉터 확정(2026-09-11, 내부 회의): 승인된 연차는 버튼으로 바로 취소하지 않는다. 휴가 쓴 **본인**이
 * "취소 결재"를 올리고 결재선은 **항상 관리자까지**(직원 [원장→관리자], 원장 [메인 원장→관리자]/[관리자]).
 * 올릴 수 있는 기한은 **시작 전날까지**. 결재가 도는 동안 연차는 차감된 채이고, **최종 승인 순간**
 * 원 휴가를 CANCELLED 로 바꾸며 차감된 연도 행에 복구한다. 반려되면 휴가는 그대로다.
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
 * ⚠ 복구 연도는 원 휴가의 `updatedAt`(= 최종 승인 시각)에서 계산한다. ②의 update 가 updatedAt 을 바꾸므로
 *   **호출부가 바꾸기 전에 읽은 값**을 넘겨야 한다. 휴가 행을 고치는 경로는 승인·대기 취소·여기뿐이다
 *   — 휴가 수정 경로를 새로 만들면 이 전제가 깨지니 승인 시각을 따로 남길 것.
 */
export async function applyLeaveCancel(
  tx: Tx,
  cancelRequestId: string,
  leave: { id: string; userId: string; type: Parameters<typeof isLeaveDeductible>[0]; days: number; updatedAt: Date },
  approverId: string
): Promise<{ restoredDays: number; year: number }> {
  const won = await tx.leaveCancelRequest.updateMany({
    where: { id: cancelRequestId, status: "PENDING" },
    data: { status: "APPROVED", approverId },
  });
  if (won.count !== 1) throw new CancelConflict("이미 처리된 취소 결재입니다.");

  const year = leaveYearOf(leave.updatedAt);
  const cancelled = await tx.leaveRequest.updateMany({
    where: { id: leave.id, status: "APPROVED" },
    data: { status: "CANCELLED" },
  });
  if (cancelled.count !== 1) throw new CancelConflict("휴가 상태가 바뀌어 취소할 수 없습니다.");

  // 차감과 **같은 함수**로 차감 유형인지 본다(대체휴무·특별휴가 등은 차감도 복구도 없다)
  let restoredDays = 0;
  if (isLeaveDeductible(leave.type)) {
    const r = await tx.leaveBalance.updateMany({
      where: { userId: leave.userId, year },
      data: { used: { decrement: leave.days }, remaining: { increment: leave.days } },
    });
    restoredDays = r.count > 0 ? leave.days : 0;
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
    if (!done) continue;
    closed++;
    const period = `${ymdOf(cr.leaveRequest.startDate)} ~ ${ymdOf(cr.leaveRequest.endDate)}`;
    await logAudit({
      actorId: "cubetee-bot", actorName: "큐브티 봇", action: "LEAVE_CANCEL_EXPIRE",
      targetType: "LEAVE", targetId: cr.leaveRequest.id, targetName: cr.user?.name ?? null,
      detail: `휴가 취소 요청 기한 만료 — 휴가 시작 전까지 결재가 끝나지 않음 (${period})`,
    }).catch(() => {});
    const { botSendDM } = await import("@/lib/bot");   // bot.ts 가 이 파일을 부르므로 순환을 피한다
    botSendDM(
      cr.userId,
      `⏰ 휴가 취소 요청이 기한 만료로 닫혔습니다.\n\n${LEAVE_TYPE_LABEL[cr.leaveRequest.type] || cr.leaveRequest.type} ${period}\n휴가 시작 전까지 결재가 끝나지 않아 휴가는 그대로 유지됩니다. 연차 정정이 필요하면 관리자에게 요청해주세요.`
    ).catch(() => {});
  }
  return closed;
}
