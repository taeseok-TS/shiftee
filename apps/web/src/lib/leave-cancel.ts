/**
 * 취소 가능 여부 — 휴가·근무일정 모두 **여기 한 곳에서만** 판정한다.
 *
 * 취소 라우트(휴가 PATCH /api/leave/[id], 근무일정 DELETE /api/schedule-requests/[id])가 이
 * 함수로 막고, 목록·결재함 API 가 같은 함수로 행마다 `canCancel`·`cancelBlock` 을 내려준다.
 * 화면(웹·앱)은 그 값으로만 버튼을 그린다 — **조건을 화면에 다시 쓰지 말 것.**
 * 종전에는 서버·화면 여러 곳이 조건을 각자 들고 있어서, 한쪽만 고치면 "누르면 403" 버튼이나
 * "버튼은 없는데 id 로는 되는" 구멍(반려건 덮어쓰기)이 남았다(2026-09-10).
 *
 * 디렉터 확정 (2026-09-10)
 *  - **승인된 휴가는 누구도 바로 취소하지 않는다**(9/11 내부 회의). 휴가 쓴 본인이 "취소 결재"를
 *    올려 관리자까지 승인받는다 — 올릴 수 있는지는 아래 cancelRequestDenial, 흐름은 lib/leave-cancel-flow.ts.
 *  - 본인: 대기 중인 자기 신청은 바로 취소할 수 있다.
 *  - 반려·취소된 건: 누구도 취소할 수 없다 — 반려 기록을 취소로 덮어쓰지 않는다.
 *  - **지나간 휴가(종료일이 오늘 이전)는 누구도 취소할 수 없다.** 연차는 관리자 "잔여 조정"으로
 *    정정한다. 여러 날 휴가는 **종료일 기준**(9/11 디렉터) — 진행 중이면 아직 취소할 수 있다.
 *    이때 이미 쓴 날까지 전부 복원되므로, 쓴 날은 관리자가 잔여 조정으로 맞춘다.
 *  - 원장: 담당 지점(대표+겸직) 소속 **직원**의 건. 다른 원장의 건은 **그 지점 메인 원장이
 *    일반 원장 건만** — "같은 지점 원장끼리 취소할 수 있는 건 단 하나, 메인 원장이 일반 원장이
 *    올린 것만". 겸직 원장이라도 메인이 아닌 지점의 원장 건은 못 한다. 관리자 건은 불가.
 *  - 관리자: 모두(위 공통 제한만).
 *  - 근무일정: 누구든 대기 중만(승인건은 이미 일정으로 반영돼 있어서). 범위 규칙은 휴가와 같고,
 *    **지난 신청(종료일이 오늘 이전)도 취소할 수 없다**(9/11 디렉터 "휴가처럼 지난 건은 막아").
 *
 * 연차는 **최종 승인 순간에만** 깎인다. 대기 중인 건은 아직 깎인 적이 없어 취소해도 그대로이고,
 * 승인된 건은 여기서 취소하지 않는다 — 취소 결재의 최종 승인에서만 복구한다(lib/leave-cancel-flow.ts).
 *
 * 이 파일은 import 가 없다 — 화면에서 불러도 안전하게 둘 것.
 */

export type CancelBlock =
  | "SCOPE"          // 범위 밖(권한 없음 · 타지점 · 관리자 건)
  | "MAIN_ONLY"      // 다른 원장의 건 — 그 지점 메인 원장만
  | "DONE"           // 이미 취소됨
  | "REJECTED"       // 반려건 — 덮어쓰기 금지
  | "STATE"          // 그 밖에 처리할 수 없는 상태(근무일정 승인건 등)
  | "PAST"           // 지난 건(종료일이 오늘 이전) — 휴가·근무일정
  | "NEEDS_REQUEST"; // 승인된 휴가 — 본인의 취소 결재로만(9/11)

export type CancelDenial = { status: number; error: string; block: CancelBlock };

export type CancelViewer = {
  userId: string;
  role: string;
  myBranches: string[];    // 원장의 담당 지점(대표+겸직). 그 외 역할은 빈 배열
  mainBranches: string[];  // 원장이 **메인 원장**인 지점. 그 외 역할은 빈 배열
  today: Date;             // KST 오늘 0시를 @db.Date 와 같은 UTC 자정으로(kstTodayMidnight)
};

type TargetUser = { role: string; branch: string | null } | null;

/** 목록·결재함 응답에 싣는 값 — canCancel(버튼을 그릴지) + cancelBlock(못 그리는 이유 코드) */
export function cancelFlags(d: CancelDenial | null): { canCancel: boolean; cancelBlock: CancelBlock | null } {
  return { canCancel: d === null, cancelBlock: d?.block ?? null };
}

// 누구의 신청을 거둘 수 있는가 — 휴가·근무일정 공통
function scopeDenial(v: CancelViewer, targetUserId: string, u: TargetUser): CancelDenial | null {
  if (targetUserId === v.userId) return null;
  if (v.role === "EMPLOYEE") return { status: 403, error: "권한이 없습니다.", block: "SCOPE" };
  if (v.role === "MANAGER") {
    if (!u || u.role === "ADMIN" || !u.branch || !v.myBranches.includes(u.branch)) {
      return { status: 403, error: "담당 지점 소속의 신청만 취소할 수 있습니다.", block: "SCOPE" };
    }
    if (u.role === "MANAGER" && !v.mainBranches.includes(u.branch)) {
      return { status: 403, error: "다른 원장의 신청은 그 지점 메인 원장만 취소할 수 있습니다.", block: "MAIN_ONLY" };
    }
  }
  return null;
}

export type LeaveCancelTarget = {
  userId: string;
  status: string;
  endDate: Date | string;     // 지난 휴가 판정(종료일 기준)
  user: TargetUser;
  approver: { role: string } | null;                          // 최종 승인자(leaveRequest.approverId)
  approvalSteps: { approverRole: string | null; status: string }[];
};

export function leaveCancelDenial(v: CancelViewer, t: LeaveCancelTarget): CancelDenial | null {
  // 범위 먼저 — 범위 밖 사람에게 그 건의 상태를 알려주지 않는다
  const scope = scopeDenial(v, t.userId, t.user);
  if (scope) return scope;

  if (t.status === "CANCELLED") return { status: 400, error: "이미 취소된 신청입니다.", block: "DONE" };
  if (t.status === "REJECTED") return { status: 409, error: "반려된 신청은 취소할 수 없습니다.", block: "REJECTED" };
  // ⚠ **승인된 휴가는 여기서 바로 취소하지 않는다**(9/11 디렉터 — 내부 회의 결정). 휴가 쓴 본인이
  //   "취소 결재"를 올려 관리자까지 승인받아야 하고, 최종 승인 순간 연차가 복구된다
  //   (lib/leave-cancel-flow.ts). 관리자도 예외 없다 — 정정은 "잔여 조정"으로.
  if (t.status === "APPROVED") {
    return {
      status: 409,
      error: "승인된 휴가는 바로 취소할 수 없습니다. 본인이 '취소 요청'을 올려 관리자까지 결재받아야 합니다.",
      block: "NEEDS_REQUEST",
    };
  }
  if (t.status !== "PENDING") {
    return { status: 409, error: "처리할 수 없는 상태의 신청입니다.", block: "STATE" };
  }

  // 지나간 휴가는 누구도 취소하지 않는다 — 관리자 "잔여 조정"으로 정정한다(디렉터 확정).
  // **종료일 기준**(9/11 디렉터): 어제 시작해 내일 끝나는 휴가는 아직 취소할 수 있다.
  // 날짜는 @db.Date(UTC 자정)라 KST 오늘 0시를 같은 형식으로 만든 today 와 비교한다.
  if (new Date(t.endDate).getTime() < v.today.getTime()) {
    return {
      status: 409,
      error: "이미 지난 휴가는 취소할 수 없습니다. 연차는 관리자 '잔여 조정'으로 정정해주세요.",
      block: "PAST",
    };
  }

  return null;
}

export type ScheduleCancelTarget = { userId: string; status: string; endDate: Date | string; user: TargetUser };

export function scheduleCancelDenial(v: CancelViewer, t: ScheduleCancelTarget): CancelDenial | null {
  const scope = scopeDenial(v, t.userId, t.user);
  if (scope) return scope;
  if (t.status === "REJECTED") return { status: 409, error: "반려된 신청은 취소할 수 없습니다.", block: "REJECTED" };
  // ⚠ 근무일정은 **대기 중인 신청만** 취소한다. 승인된 신청은 이미 근무일정으로 반영돼 있어서,
  //   되돌리려면 그 일정을 어떻게 할지 따로 정해야 한다(휴가는 연차만 복원하면 되지만
  //   근무일정은 그렇지 않다). 승인된 건은 일정 화면에서 직접 고친다.
  if (t.status !== "PENDING") {
    return {
      status: 409,
      error: `이미 ${t.status === "APPROVED" ? "승인" : "처리"}된 신청은 취소할 수 없습니다.`,
      block: t.status === "CANCELLED" ? "DONE" : "STATE",
    };
  }
  // 지난 신청은 취소하지 않는다 — 휴가와 같다(9/11 디렉터 "휴가처럼 지난 건은 막아"). 종료일 기준.
  if (new Date(t.endDate).getTime() < v.today.getTime()) {
    return { status: 409, error: "이미 지난 근무일정 신청은 취소할 수 없습니다.", block: "PAST" };
  }
  return null;
}

// ── 승인된 휴가의 **취소 결재** 올리기 ─────────────────────────────────────────────
// 디렉터 확정(9/11): 휴가 쓴 **본인만** · **시작 전날까지**(첫날부터는 진행 중 — 취소 대상이 아니고,
// 정정은 관리자 "잔여 조정") · 휴가 하나에 진행 중인 취소 결재는 **하나**. 결재선은 항상 관리자까지
// (lib/leave-policy.ts forCancel). 목록 API 의 canRequestCancel 과 취소 요청 라우트가 이 함수 하나를 쓴다.
export type CancelRequestBlock = "SCOPE" | "STATE" | "PENDING_REQUEST" | "STARTED";
export type CancelRequestDenial = { status: number; error: string; block: CancelRequestBlock };

export function cancelRequestDenial(
  v: { userId: string; today: Date },
  t: { userId: string; status: string; startDate: Date | string },
  hasPendingRequest: boolean
): CancelRequestDenial | null {
  if (t.userId !== v.userId) return { status: 403, error: "본인 휴가만 취소 요청할 수 있습니다.", block: "SCOPE" };
  if (t.status !== "APPROVED") {
    return { status: 409, error: "승인된 휴가만 취소 결재를 올립니다. 대기 중인 신청은 바로 취소할 수 있습니다.", block: "STATE" };
  }
  if (hasPendingRequest) return { status: 409, error: "이미 취소 결재가 진행 중입니다.", block: "PENDING_REQUEST" };
  // 시작 전날까지 — 시작일이 KST 오늘보다 **뒤**여야 한다(@db.Date UTC 자정끼리 비교)
  if (new Date(t.startDate).getTime() <= v.today.getTime()) {
    return {
      status: 409,
      error: "휴가 시작 전날까지만 취소 요청할 수 있습니다. 이미 시작했거나 지난 휴가는 관리자에게 '잔여 조정'을 요청해주세요.",
      block: "STARTED",
    };
  }
  return null;
}

/** 목록 응답에 싣는 값 — canRequestCancel(취소 요청 버튼을 그릴지) + requestBlock(못 그리는 이유) */
export function requestFlags(d: CancelRequestDenial | null): { canRequestCancel: boolean; requestBlock: CancelRequestBlock | null } {
  return { canRequestCancel: d === null, requestBlock: d?.block ?? null };
}
