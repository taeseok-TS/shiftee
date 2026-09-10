/**
 * 휴가 취소 가능 여부 — **여기 한 곳에서만** 판정한다.
 *
 * 취소 라우트(PATCH /api/leave/[id])가 이 함수로 막고, 목록 API(GET /api/leave)가 같은
 * 함수로 행마다 `canCancel` 을 내려준다. 화면은 그 값으로만 버튼을 그린다.
 * 종전에는 서버와 화면 네 곳이 조건을 각자 들고 있어서, 한쪽만 고치면 "누르면 403"
 * 버튼이나 "버튼은 없는데 id 로는 되는" 구멍(반려건 덮어쓰기)이 남았다(2026-09-10).
 *
 * 디렉터 확정 (2026-09-10)
 *  - 본인: 대기 중일 때만. 승인된 자기 휴가는 관리자에게 요청한다.
 *  - 반려·취소된 건: 누구도 취소할 수 없다 — 반려 기록을 취소로 덮어쓰지 않는다.
 *  - 원장: 담당 지점 소속의 건(관리자 건 제외). 승인된 건은 **원장 선에서 최종 승인된
 *    것만**(직원 1일 휴가). 관리자가 승인한 건은 관리자만 취소한다.
 *  - 관리자: 모두.
 *
 * 연차는 **최종 승인 순간에만** 깎인다. 원장 승인 후 관리자 대기(PENDING) 건은 아직
 * 깎인 적이 없어 취소해도 그대로이고, 승인된 건은 취소 라우트가 되돌린다.
 */

export type LeaveCancelViewer = {
  userId: string;
  role: string;
  myBranches: string[];   // 원장의 담당 지점(대표+겸직). 그 외 역할은 빈 배열
};

export type LeaveCancelTarget = {
  userId: string;
  status: string;
  user: { role: string; branch: string | null } | null;
  approver: { role: string } | null;                          // 최종 승인자(leaveRequest.approverId)
  approvalSteps: { approverRole: string | null; status: string }[];
};

export function leaveCancelDenial(
  v: LeaveCancelViewer,
  t: LeaveCancelTarget
): { status: number; error: string } | null {
  const mine = t.userId === v.userId;

  // 권한(범위) 먼저 — 범위 밖 사람에게 그 건의 상태를 알려주지 않는다
  if (!mine) {
    if (v.role === "EMPLOYEE") return { status: 403, error: "권한이 없습니다." };
    if (v.role === "MANAGER") {
      const u = t.user;
      if (!u || u.role === "ADMIN" || !u.branch || !v.myBranches.includes(u.branch)) {
        return { status: 403, error: "담당 지점 소속의 신청만 취소할 수 있습니다." };
      }
    }
  }

  if (t.status === "CANCELLED") return { status: 400, error: "이미 취소된 신청입니다." };
  if (t.status === "REJECTED") return { status: 409, error: "반려된 신청은 취소할 수 없습니다." };
  if (t.status !== "PENDING" && t.status !== "APPROVED") {
    return { status: 409, error: "처리할 수 없는 상태의 신청입니다." };
  }

  // 승인된 자기 휴가를 스스로 되돌려 연차를 돌려받는 길은 막는다(2026-09-09 검증에서 적발)
  if (mine && t.status !== "PENDING") {
    return { status: 403, error: "이미 승인된 본인 휴가는 직접 취소할 수 없습니다. 관리자에게 요청해주세요." };
  }

  // 원장은 **원장 선에서 끝난** 승인 건만. 결재선의 관리자 단계는 항상 마지막이라,
  // 최종 승인자가 원장이고 관리자 단계 승인이 없으면 관리자가 관여하지 않은 건이다.
  // 최종 승인자를 알 수 없는 옛 데이터는 관리자 몫으로 둔다.
  if (!mine && v.role === "MANAGER" && t.status === "APPROVED") {
    const managerFinal =
      t.approver?.role === "MANAGER" &&
      !t.approvalSteps.some((s) => s.approverRole === "ADMIN" && s.status === "APPROVED");
    if (!managerFinal) {
      return { status: 403, error: "관리자가 승인한 휴가는 관리자만 취소할 수 있습니다." };
    }
  }

  return null;
}
