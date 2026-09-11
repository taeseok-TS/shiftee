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
 *  - 본인: 대기 중일 때만. 승인된 자기 휴가는 관리자에게 요청한다.
 *  - 반려·취소된 건: 누구도 취소할 수 없다 — 반려 기록을 취소로 덮어쓰지 않는다.
 *  - **지나간 휴가(종료일이 오늘 이전)는 누구도 취소할 수 없다.** 연차는 관리자 "잔여 조정"으로
 *    정정한다. 여러 날 휴가는 **종료일 기준**(9/11 디렉터) — 진행 중이면 아직 취소할 수 있다.
 *    이때 이미 쓴 날까지 전부 복원되므로, 쓴 날은 관리자가 잔여 조정으로 맞춘다.
 *  - 원장: 담당 지점(대표+겸직) 소속 **직원**의 건. 다른 원장의 건은 **그 지점 메인 원장이
 *    일반 원장 건만** — "같은 지점 원장끼리 취소할 수 있는 건 단 하나, 메인 원장이 일반 원장이
 *    올린 것만". 겸직 원장이라도 메인이 아닌 지점의 원장 건은 못 한다. 관리자 건은 불가.
 *    승인된 휴가는 원장 선에서 최종 승인된 것만(직원 1일 휴가) — 관리자가 관여한 건은 관리자만.
 *  - 관리자: 모두(위 공통 제한만).
 *  - 근무일정: 누구든 대기 중만(승인건은 이미 일정으로 반영돼 있어서). 범위 규칙은 휴가와 같고,
 *    **지난 신청(종료일이 오늘 이전)도 취소할 수 없다**(9/11 디렉터 "휴가처럼 지난 건은 막아").
 *
 * 연차는 **최종 승인 순간에만** 깎인다. 원장 승인 후 관리자 대기(PENDING) 건은 아직 깎인 적이
 * 없어 취소해도 그대로이고, 승인된 건은 취소 라우트가 차감된 연도 행으로 되돌린다.
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
  | "SELF_APPROVED"  // 승인된 본인 휴가
  | "ADMIN_ONLY";    // 관리자가 승인한 휴가

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
  if (t.status !== "PENDING" && t.status !== "APPROVED") {
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

  // 승인된 자기 휴가를 스스로 되돌려 연차를 돌려받는 길은 막는다(2026-09-09 검증에서 적발)
  const mine = t.userId === v.userId;
  if (mine && t.status !== "PENDING") {
    return {
      status: 403,
      error: "이미 승인된 본인 휴가는 직접 취소할 수 없습니다. 관리자에게 요청해주세요.",
      block: "SELF_APPROVED",
    };
  }

  // 원장은 **원장 선에서 끝난** 승인 건만. 결재선의 관리자 단계는 항상 마지막이라,
  // 최종 승인자가 원장이고 관리자 단계 승인이 없으면 관리자가 관여하지 않은 건이다.
  // 최종 승인자를 알 수 없는 옛 데이터는 관리자 몫으로 둔다.
  if (!mine && v.role === "MANAGER" && t.status === "APPROVED") {
    const managerFinal =
      t.approver?.role === "MANAGER" &&
      !t.approvalSteps.some((s) => s.approverRole === "ADMIN" && s.status === "APPROVED");
    if (!managerFinal) {
      return { status: 403, error: "관리자가 승인한 휴가는 관리자만 취소할 수 있습니다.", block: "ADMIN_ONLY" };
    }
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
