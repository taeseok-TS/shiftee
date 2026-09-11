/**
 * ============================================
 * 큐브티 Mobile - 결재함 서비스
 * 역할/지점 기반 결재 API 직접 호출 (Bearer 토큰)
 * ============================================
 */

import axios from "axios";
import { API_URL } from "../config";
import { getToken } from "./storage";

async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type InboxUser = { id?: string; name: string; department?: string | null; branch?: string | null };
type InboxStepInfo = {
  id: string;
  order: number;
  status: string;
  approverRole?: string | null;
  branch?: string | null;
  approver?: { id: string; name: string } | null;
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

export async function decideLeave(id: string, action: "approve" | "reject", reason?: string) {
  await axios.post(`${API_URL}/leave/${id}/approve`, { action, reason }, { headers: await authHeaders() });
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
};

export async function getMyLedger(year?: number): Promise<MyLedger> {
  const res = await axios.get(`${API_URL}/leave/ledger`, { params: year ? { year } : {}, headers: await authHeaders() });
  return res.data?.ledger as MyLedger;
}

/**
 * 신청 화면 "N년 잔여" — 내년 날짜를 고르면 그 해 잔여를 따로 보여준다(2026-09-11 디렉터). 서버 신청 검사와 같은
 * 함수의 값이라 그 해 행이 없어도 서버가 검사할 값이 온다. 서버: GET /api/leave/balance?scope=self&forLeave=1&year=
 */
export async function getYearBalance(year: number): Promise<{ total: number; used: number; remaining: number } | null> {
  const res = await axios.get(`${API_URL}/leave/balance`, {
    params: { scope: "self", forLeave: 1, year },
    headers: await authHeaders(),
  });
  return res.data?.balance ?? null;
}

// 단계 라벨: 역할기반 단계는 승인 전 approver가 null → 역할명 표시
export function stepLabel(s: InboxStepInfo): string {
  if (s.approver) return s.approver.name;
  if (s.approverRole === "MANAGER") return `${s.branch ? `[${s.branch}] ` : ""}원장`;
  if (s.approverRole === "ADMIN") return "관리자";
  return "결재자";
}
