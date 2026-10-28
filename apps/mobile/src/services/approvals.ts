/**
 * ============================================
 * 큐브티 Mobile - 결재함 서비스
 * 역할/지점 기반 결재 API 직접 호출 (Bearer 토큰)
 * ============================================
 */

import axios from "axios";
import { Alert } from "react-native";
import { API_URL } from "../config";
import { getAttendanceRequestInbox } from "./attendance";
import { getToken, getUser } from "./storage";

async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type InboxUser = { id?: string; name: string; department?: string | null; branch?: string | null; position?: string | null };
type InboxStepInfo = {
  id: string;
  order: number;
  status: string;
  approverRole?: string | null;
  branch?: string | null;
  approver?: { id: string; name: string } | null;
  comment?: string | null;   // 결재자 의견(2026-10-07 #64)
};

export type LeaveInboxStep = InboxStepInfo & {
  leaveRequest: {
    id: string;
    type: string;
    startDate: string;
    endDate: string;
    days: number;
    reason: string | null;
    attachmentUrl?: string | null;
    attachmentName?: string | null;
    canCancel?: boolean;   // 서버 판정(취소 라우트와 같은 함수) — 이 값으로만 취소 버튼을 그린다
    user: InboxUser;
    approvalSteps?: InboxStepInfo[];
  };
};

export type ScheduleInboxStep = InboxStepInfo & {
  scheduleRequest: {
    id: string;
    kind?: "CREATE" | "UPDATE" | "DELETE" | string;   // 2026-10-07 #49 — 수정 · 삭제 요청
    scheduleData?: { date: string; startTime: string; endTime: string }[] | null;   // 날짜별 일정(서버가 통째로 준다)
    templateName: string | null;
    startDate: string;
    endDate: string;
    totalHours: number;
    canCancel?: boolean;   // 서버 판정 — 이 값으로만 취소 버튼을 그린다
    reason: string | null;
    user: InboxUser;
    approvalSteps?: InboxStepInfo[];
  };
};

export async function getLeaveApprovals(): Promise<LeaveInboxStep[]> {
  const res = await axios.get(`${API_URL}/leave/my-approvals`, { headers: await authHeaders() });
  return (res.data?.steps as LeaveInboxStep[]) || [];
}

export async function getScheduleApprovals(): Promise<ScheduleInboxStep[]> {
  const res = await axios.get(`${API_URL}/schedule-requests/my-approvals`, { headers: await authHeaders() });
  return (res.data?.steps as ScheduleInboxStep[]) || [];
}

/**
 * 원장·관리자용 **휴가 내역** — 결재함은 내 차례인 대기 건만 보여서, 내가 승인해 관리자에게
 * 넘긴 건이나 원장 선에서 최종 승인된 1일 휴가를 취소할 자리가 없었다(2026-09-10 디렉터 지시,
 * 웹 원장 화면 "휴가 내역" 탭과 짝). scope 없이 부르면 서버가 원장에겐 담당 지점, 관리자에겐
 * 전사를 준다 — 이 화면은 그걸 의도한다. 개인 "내 휴가 내역"은 scope=self 로 따로 부른다.
 */
export type TeamLeave = {
  id: string;
  userId: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  reason: string | null;
  canCancel?: boolean;
  cancelBlock?: string | null;   // 못 하는 이유 코드(서버)
  pendingCancel?: { id: string; mine: boolean } | null;   // 진행 중인 취소 결재(9/11)
  user: { id: string; name: string; branch?: string | null };
  approvalSteps?: InboxStepInfo[];
};

export async function getTeamLeaves(): Promise<TeamLeave[]> {
  // current=1 — 진행 중·앞으로의 대기·승인만(서버가 거른다). 지난 기록은 연도 조회로 찾는다.
  const res = await axios.get(`${API_URL}/leave`, { params: { current: 1 }, headers: await authHeaders() });
  return (res.data?.requests as TeamLeave[]) || [];
}

// 잔여 부족 예외 승인(2026-10-22 본부) — 서버가 canOverride(관리자)를 주면 안내를 보여 주고 한 번 더 확인받아 다시 부른다. 원장은 그대로 막힌다
// who = 누구 건인지(승인 화면에서 5초 유예 뒤에 물으면 어느 카드였는지 모른다 — 검증 B1-d). 화면은 잔여 부족이 보이면 유예 전에 이 창으로 먼저 묻는다
export const confirmOverride = (msg: string, who?: string) => new Promise<boolean>((resolve) =>
  Alert.alert(who ? `잔여 부족 — ${who}님` : "잔여 부족", `${msg}\n\n본부 예외로 승인할까요?\n승인하면 잔여는 마이너스로 남고, 변경 로그에 「잔여 부족 예외 승인」으로 기록됩니다.`, [
    { text: "취소", style: "cancel", onPress: () => resolve(false) },
    { text: "예외 승인", style: "destructive", onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));

/** opts.override = 이미 예외 승인을 확인받았다(첫 요청부터 예외로 보낸다 — 서버는 잔여가 모자랄 때 · 본부일 때만 쓴다).
 *  opts.who = 확인창에 넣을 신청자 이름. 확인창에서 그만두면 false */
export async function decideLeave(id: string, action: "approve" | "reject", reason?: string, opts: { override?: boolean; who?: string } = {}): Promise<boolean> {
  try {
    await axios.post(`${API_URL}/leave/${id}/approve`, { action, reason, ...(action === "approve" && opts.override ? { overrideShortBalance: true } : {}) }, { headers: await authHeaders() });
    return true;
  } catch (e: any) {
    const d = e?.response?.data;
    if (action !== "approve" || opts.override || d?.code !== "SHORT_BALANCE" || !d?.canOverride) throw e;
    if (!(await confirmOverride(String(d.error || "연차 잔여가 부족합니다."), opts.who))) return false;
    await axios.post(`${API_URL}/leave/${id}/approve`, { action, reason, overrideShortBalance: true }, { headers: await authHeaders() });
    return true;
  }
}

export async function decideSchedule(id: string, action: "approve" | "reject", reason?: string) {
  await axios.post(`${API_URL}/schedule-requests/${id}/approve`, { action, reason }, { headers: await authHeaders() });
}

/**
 * 신청 **취소** — 반려와 다르다.
 *  · 반려: "안 된다"는 결재 결과. 기록에 REJECTED 로 남고 사유가 신청자에게 간다.
 *  · 취소: 신청 자체를 거둔다. CANCELLED 로 남는다 — 날짜를 잘못 넣은 신청을 반려로
 *    처리하면 기록에 "반려당함"으로 남아 나중에 오해를 산다.
 * 권한(담당 지점 소속인지, 대기 중인지)은 **서버가 다시 확인한다.**
 * 메서드가 서로 다르다 — 휴가는 PATCH, 근무일정은 DELETE(웹과 같은 계약).
 */
export async function cancelLeave(id: string) {
  await axios.patch(`${API_URL}/leave/${id}`, {}, { headers: await authHeaders() });
}

export async function cancelSchedule(id: string) {
  await axios.delete(`${API_URL}/schedule-requests/${id}`, { headers: await authHeaders() });
}

/**
 * 승인된 휴가의 **취소 결재**(2026-09-11 디렉터 — 내부 회의).
 * 승인된 연차는 버튼으로 바로 취소하지 않는다. 휴가 쓴 본인이 취소 결재를 올리고 관리자까지 승인받으면
 * 휴가가 취소되고 연차가 복구된다. 올릴 수 있는 기한은 시작 전날까지(서버가 판정 — 목록의 canRequestCancel).
 */
export type LeaveCancelInboxStep = InboxStepInfo & {
  cancelRequest: {
    id: string;
    reason: string | null;
    createdAt: string;
    user: InboxUser;
    leaveRequest: { id: string; type: string; startDate: string; endDate: string; days: number; reason: string | null };
    approvalSteps?: InboxStepInfo[];
  };
};

export async function getLeaveCancelApprovals(): Promise<LeaveCancelInboxStep[]> {
  const res = await axios.get(`${API_URL}/leave/cancel-requests/my-approvals`, { headers: await authHeaders() });
  return (res.data?.steps as LeaveCancelInboxStep[]) || [];
}

export async function decideLeaveCancel(id: string, action: "approve" | "reject", reason?: string) {
  await axios.post(`${API_URL}/leave/cancel-requests/${id}/approve`, { action, reason }, { headers: await authHeaders() });
}

/** 본인 휴가의 취소 결재 올리기 */
export async function requestLeaveCancel(leaveId: string, reason?: string) {
  await axios.post(`${API_URL}/leave/${leaveId}/cancel-request`, { reason }, { headers: await authHeaders() });
}

/** 본인이 올린 취소 결재 철회(대기 중일 때만) */
export async function withdrawLeaveCancel(cancelRequestId: string) {
  await axios.delete(`${API_URL}/leave/cancel-requests/${cancelRequestId}`, { headers: await authHeaders() });
}

/**
 * 본인 **연차 대장**(2026-09-11 디렉터 — 직원은 본인 열람만). 그 해(휴가를 쓰는 해) 휴가 전부와 결재 기록,
 * 취소 결재, 잔여 조정 이력. 서버: GET /api/leave/ledger (userId 를 안 주면 본인).
 */
type LedgerStep = { order: number; role: string | null; approverName: string | null; status: string; decidedAt: string | null; comment: string | null };
export type MyLedger = {
  year: number;
  balance: { total: number; used: number; remaining: number } | null;
  entries: {
    id: string; type: string; startDate: string; endDate: string; days: number; status: string; deductible: boolean;
    reason: string | null; rejectedReason: string | null; createdAt: string; steps: LedgerStep[];
    cancelRequests: { id: string; status: string; reason: string | null; rejectedReason: string | null; createdAt: string; steps: LedgerStep[] }[];
  }[];
  adjustments: { at: string; actorName: string; detail: string | null }[];
  summary: { approvedDeductibleDays: number; balanceUsed: number | null; match: boolean | null };
  // 잔여 숫자 숨김(2026-10-16 #219-1) — 서버가 총·사용·잔여·잔여 조정 이력을 빼고 보낸다. 화면은 「연차 정리 중」
  balanceHidden?: boolean;
};

export async function getMyLedger(year?: number): Promise<MyLedger> {
  const res = await axios.get(`${API_URL}/leave/ledger`, { params: year ? { year } : {}, headers: await authHeaders() });
  return { ...(res.data?.ledger as MyLedger), balanceHidden: !!res.data?.balanceHidden };
}

/**
 * 내 잔여 연차(올해) + 숨김 여부(2026-10-16 #219-1). 서버: GET /api/leave/balance?scope=self → { balance, balanceHidden }.
 * 공용 클라이언트(@shiftee/api getLeaveBalance)는 balance 만 돌려줘 숨김(null)과 「기록 없음」(null)을 가를 수 없어 따로 부른다.
 */
export async function getMyLeaveBalance(): Promise<{ balance: { total: number; used: number; remaining: number } | null; hidden: boolean }> {
  const res = await axios.get(`${API_URL}/leave/balance`, { params: { scope: "self" }, headers: await authHeaders() });
  return { balance: res.data?.balance ?? null, hidden: !!res.data?.balanceHidden };
}

/**
 * 휴가 신청 일수 미리보기(2026-10-16 #219-10·11·12) — 서버 신청 검사와 같은 함수(근무일정·공휴일 반영, 잔여 초과 막기)의 값.
 * 서버: GET /api/leave/days?start&end&type. blocked 면 신청 버튼을 막고 reason 을 보여 준다(숫자 숨김이면 숫자 없는 문구).
 */
export type LeaveDaysPreview = {
  days: number; blocked: boolean; code: "NO_WORKDAY" | "OVER_LIMIT" | null; reason: string | null; balanceHidden: boolean;
  limit: { kind: "annual" | "grant"; year: number | null; group: string | null; remaining: number | null; pending: number | null; available: number | null } | null;
};
export async function getLeaveDaysPreview(type: string, start: string, end: string): Promise<LeaveDaysPreview> {
  const res = await axios.get(`${API_URL}/leave/days`, { params: { type, start, end }, headers: await authHeaders() });
  return res.data as LeaveDaysPreview;
}

/**
 * 신청 화면 "N년 잔여" — 내년 날짜를 고르면 그 해 잔여를 따로 보여준다(2026-09-11 디렉터). 서버 신청 검사와 같은
 * 함수의 값이라 그 해 행이 없어도 서버가 검사할 값이 온다. 서버: GET /api/leave/balance?scope=self&forLeave=1&year=
 */
export async function getYearBalance(
  year: number,
  type: string
): Promise<{ balance: { total: number; used: number; remaining: number } | null; deductible: boolean; hidden: boolean }> {
  const res = await axios.get(`${API_URL}/leave/balance`, {
    params: { scope: "self", forLeave: 1, year, type },
    headers: await authHeaders(),
  });
  // deductible — 연차 차감 유형인지(서버 판정). 미차감 유형(경조사·대체휴무 등)엔 안내를 띄우지 않는다(9/11 검증 E1)
  // hidden — 잔여 숫자 숨김(#219-1)이면 balance 는 null 로 온다
  return { balance: res.data?.balance ?? null, deductible: res.data?.deductible !== false, hidden: !!res.data?.balanceHidden };
}

// 단계 라벨: 역할기반 단계는 승인 전 approver가 null → 역할명 표시
export function stepLabel(s: InboxStepInfo): string {
  if (s.approver) return s.approver.name;
  if (s.approverRole === "MANAGER") return `${s.branch ? `[${s.branch}] ` : ""}원장`;
  if (s.approverRole === "ADMIN") return "관리자";
  return "결재자";
}

/** 휴가 유형 기준표(2026-10-07 QA #30) — 서버 lib/leave-catalog 가 원천. 신청 목록(types)과 전 유형 이름(labels) */
export type LeaveTypeItem = { code: string; label: string; group: string; unit: "FULL" | "HALF" | "QUARTER"; paidHours: number; deducts: boolean; attachRequired: string | null; notice: string | null };
export async function getLeaveTypes(): Promise<{ types: LeaveTypeItem[]; labels: Record<string, string>; all: { code: string; unit: string }[] }> {
  const res = await axios.get(`${API_URL}/leave/types`, { headers: await authHeaders() });
  return { types: res.data?.types ?? [], labels: res.data?.labels ?? {}, all: res.data?.all ?? [] };
}

// 요청 한눈에(#51 #43 #76) — 서버 lib/request-feed 와 같은 모양
export type FeedItem = {
  kind: "LEAVE" | "LEAVE_CANCEL" | "SCHEDULE" | "ATTENDANCE";
  id: string; title: string; period: string; requester: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  /** 출퇴근 요청은 시각을 볼 수 없는 사람(직원 · 원장)에게 null — 그때는 createdDate(KST "YYYY-MM-DD")만 */
  createdAt: string | null;
  createdDate?: string;
  reason: string | null;
  progress: { done: number; total: number } | null;
  lastComment: { by: string; text: string } | null;
  rejectReason: string | null;
  myDecision?: "APPROVED" | "REJECTED";
};
/** limited=true 면 종류별 최근 300건(또는 전체 500건)에서 잘렸다 */
export async function getRequestFeed(who: "mine" | "decided", f: { status?: string; q?: string } = {}): Promise<{ items: FeedItem[]; limited: boolean }> {
  const p = new URLSearchParams({ who });
  if (f.status) p.set("status", f.status);
  if (f.q) p.set("q", f.q);
  const res = await axios.get(`${API_URL}/requests?${p}`, { headers: await authHeaders() });
  return { items: res.data?.items ?? [], limited: !!res.data?.limited };
}

/** 승인 카드 판단 정보(2026-10-23 앱 2) — 담당 지점(관리자는 전체) 직원의 올해 남은 연차. 숫자 숨김이면 null */
export async function getTeamBalances(): Promise<Map<string, number | null> | null> {
  try {
    const res = await axios.get(`${API_URL}/leave/balance`, { headers: await authHeaders() });
    if (res.data?.balanceHidden) return null;
    const m = new Map<string, number | null>();
    for (const b of (res.data?.balances ?? []) as { userId: string; remaining: number | null }[]) m.set(b.userId, b.remaining ?? null);
    return m;
  } catch { return null; }
}

/** 승인 카드 판단 정보 — 기간 안 담당 지점(관리자는 전체) 근무일정. 주 52시간 「안 / 넘음」을 일정 기준으로 센다 */
export type BranchShift = { userId: string; date: string; startTime: string; endTime: string; type: string };
export async function getBranchSchedules(start: string, end: string): Promise<BranchShift[]> {
  const res = await axios.get(`${API_URL}/schedule`, { params: { start, end }, headers: await authHeaders() });
  return (res.data?.schedules as BranchShift[]) || [];
}

/** 신청 화면 결재 순서 미리보기(2026-10-15 #16) — 신청할 때와 같은 함수(서버 lib/approval-rules). 실패하면 빈 배열 */
export async function getApprovalPreview(kind: "LEAVE" | "SCHEDULE"): Promise<{ label: string; sub: string }[]> {
  try {
    const res = await axios.get(`${API_URL}/approval-preview`, { params: { kind }, headers: await authHeaders() });
    return (res.data?.steps as { label: string; sub: string }[]) || [];
  } catch { return []; }
}

/** 지금 결재할 수 있는 사람인가 — 원장·본부, 또는 오늘 원장대행 중인 직원 */
export async function canApproveNow(): Promise<boolean | null> {
  const u = await getUser().catch(() => null);
  if (u?.role === "ADMIN" || u?.role === "MANAGER") return true;
  if (!u?.role) return false;
  // 원장대행 확인이 네트워크로 실패하면 null(모름) — 화면은 이전 판정을 그대로 둔다(일시 실패로 결재 메뉴가 사라지지 않게)
  try {
    const res = await axios.get(`${API_URL}/me/delegate`, { headers: await authHeaders() });
    return Array.isArray(res.data?.branches) && res.data.branches.length > 0;
  } catch {
    return null;
  }
}

/** 내가 지금 결재할 건수(휴가·근무일정·휴가 취소·출퇴근 요청) — 홈 「대기 결재」 칸, 결재 화면 합계와 같은 셈. 전부 못 받으면 null(모름) */
export async function myInboxCount(): Promise<number | null> {
  const r = await Promise.allSettled([getLeaveApprovals(), getScheduleApprovals(), getLeaveCancelApprovals(), getAttendanceRequestInbox()]);
  if (r.every((x) => x.status === "rejected")) return null;
  // 본부는 출퇴근 요청 중 아직 원장 차례인 건을 세지 않는다 — 홈 「결재 대기」 · 웹 결재 배지와 같은 기준(2026-10-28 S6 ③)
  const admin = (await getUser().catch(() => null))?.role === "ADMIN";
  return r.reduce((n, x, i) => {
    if (x.status !== "fulfilled") return n;
    const list = x.value as { currentStep?: string | null }[];
    return n + (i === 3 && admin ? list.filter((a) => a.currentStep !== "MANAGER").length : list.length);
  }, 0);
}

/** 오늘 원장대행 중인 지점 — 직원이 대행자로 지정되면 결재 메뉴를 보여 준다(2026-10-07). 실패하면 빈 배열 */
export async function getMyDelegateBranches(): Promise<string[]> {
  try {
    const res = await axios.get(`${API_URL}/me/delegate`, { headers: await authHeaders() });
    return Array.isArray(res.data?.branches) ? res.data.branches : [];
  } catch {
    return [];
  }
}
