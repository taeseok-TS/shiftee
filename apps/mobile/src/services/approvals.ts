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

export async function decideLeave(id: string, action: "approve" | "reject", reason?: string) {
  await axios.post(`${API_URL}/leave/${id}/approve`, { action, reason }, { headers: await authHeaders() });
}

export async function decideSchedule(id: string, action: "approve" | "reject", reason?: string) {
  await axios.post(`${API_URL}/schedule-requests/${id}/approve`, { action, reason }, { headers: await authHeaders() });
}

// 단계 라벨: 역할기반 단계는 승인 전 approver가 null → 역할명 표시
export function stepLabel(s: InboxStepInfo): string {
  if (s.approver) return s.approver.name;
  if (s.approverRole === "MANAGER") return `${s.branch ? `[${s.branch}] ` : ""}원장`;
  if (s.approverRole === "ADMIN") return "관리자";
  return "결재자";
}
