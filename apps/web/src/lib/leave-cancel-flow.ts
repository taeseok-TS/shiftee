import type { Prisma } from "@prisma/client";
import { isLeaveDeductible } from "@/lib/leave-types";
import { leaveYearOf } from "@/lib/leave-calc";

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
export function cancelStepWhere(session: { userId: string; role: string }, myBranches: string[]) {
  return {
    status: "PENDING" as const,
    cancelRequest: { userId: { not: session.userId }, status: "PENDING" as const },
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
