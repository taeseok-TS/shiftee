/**
 * ============================================
 * 큐브티 Mobile - 출퇴근 서비스
 * 서버 에러 메시지를 그대로 노출하기 위해 직접 axios 사용(Bearer 토큰).
 * ============================================
 */

import axios from "axios";
import { API_URL } from "../config";
import { getToken } from "./storage";
import { getDeviceId } from "./device";

async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// 출퇴근 전용: 기기 검증 헤더 포함 (서버가 등록 기기와 대조)
async function clockHeaders() {
  return { ...(await authHeaders()), "x-device-id": await getDeviceId() };
}

export type TodayStatus = {
  clockedIn: boolean;
  clockedOut: boolean;
  clockInAt: string | null;
  clockOutAt: string | null;
  pendingIn?: boolean;    // 지점 밖·사진·본부 처리 출근 요청이 승인 대기 중(2026-10-07)
  pendingOut?: boolean;
  pendingInClockedOut?: boolean;   // 출근 요청 승인 대기 중에 퇴근까지 찍음(승인 때 함께 기록)
};

export async function getTodayStatus(): Promise<TodayStatus> {
  const res = await axios.get(`${API_URL}/attendance/today`, { headers: await authHeaders() });
  return res.data as TodayStatus;
}

export async function clockIn(latitude: number, longitude: number) {
  const res = await axios.post(
    `${API_URL}/attendance/clock-in`,
    { latitude, longitude },
    { headers: await clockHeaders() }
  );
  return res.data;
}

export async function clockOut(latitude: number, longitude: number) {
  const res = await axios.post(
    `${API_URL}/attendance/clock-out`,
    { latitude, longitude },
    { headers: await clockHeaders() }
  );
  return res.data;
}

// ─── 출퇴근 요청(2026-10-07 QA #9 #13 #15) ────────────────────────────
// 지점 밖·사진·본부 처리·기록 수정·퇴근 누락. 결재는 원장(원장 본인은 본부), 본부 처리는 본부.

export type RequestKind = "OUTSIDE" | "PHOTO" | "HQ" | "CORRECTION" | "MISSED_OUT" | "DEVICE";

export type AttendanceRequestRow = {
  id: string; userId: string; userName: string; userBranch: string | null; userPosition: string | null;
  kind: RequestKind; kindLabel: string; action: "IN" | "OUT" | null; workDate: string; summary: string;
  reason: string | null; memo: string | null; hasPhoto: boolean; deviceName: string | null; platform: string | null;
  approverLabel: string; status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; decidedByName: string | null;
  rejectReason: string | null; createdAt: string;
};

/** 지점 밖·본부 처리·기록 수정·퇴근 누락 요청(JSON). 출퇴근 대신인 것은 기기 헤더를 붙인다 */
export async function createAttendanceRequest(body: Record<string, unknown>) {
  const res = await axios.post(`${API_URL}/attendance-requests`, body, { headers: await clockHeaders() });
  return res.data as { success: true; id: string; approverLabel: string };
}

/**
 * 사진 출퇴근 요청 — 지점 사진 + 칸들(multipart).
 * ⚠ Content-Type 을 직접 넣지 않는다 — 경계(boundary)가 빠져 서버가 못 읽는다(work.ts uploadFile 과 같은 관례).
 *   fetch 가 FormData 를 보고 알아서 붙인다. 실패하면 axios 오류처럼 response.data.error 를 실어 던진다(화면 처리 공용).
 */
export async function createPhotoRequest(
  photo: { uri: string; name: string; mimeType?: string | null },
  fields: Record<string, string>,
) {
  const form = new FormData();
  form.append("file", { uri: photo.uri, name: photo.name, type: photo.mimeType || "image/jpeg" } as any);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(`${API_URL}/attendance-requests`, {
      method: "POST", body: form as any, headers: (await clockHeaders()) as Record<string, string>, signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error || "보내지 못했어요"), { response: { status: res.status, data } });
    return data as { success: true; id: string; approverLabel: string };
  } finally {
    clearTimeout(timer);
  }
}

export async function getMyAttendanceRequests(): Promise<AttendanceRequestRow[]> {
  const res = await axios.get(`${API_URL}/attendance-requests?scope=mine`, { headers: await authHeaders() });
  return res.data?.requests || [];
}

export async function cancelAttendanceRequest(id: string) {
  await axios.delete(`${API_URL}/attendance-requests/${id}`, { headers: await authHeaders() });
}

/** 결재함 — 내가 처리할 출퇴근 요청 */
export async function getAttendanceRequestInbox(): Promise<AttendanceRequestRow[]> {
  const res = await axios.get(`${API_URL}/attendance-requests?scope=inbox`, { headers: await authHeaders() });
  return res.data?.requests || [];
}

export async function decideAttendanceRequest(id: string, action: "approve" | "reject", reason?: string) {
  await axios.post(`${API_URL}/attendance-requests/${id}`, { action, reason }, { headers: await authHeaders() });
}

/** 사진 요청의 지점 사진 주소 — 이미지에 Authorization 헤더를 붙여 연다 */
export async function attendanceRequestPhotoSource(id: string) {
  return { uri: `${API_URL}/attendance-requests/${id}/photo`, headers: (await authHeaders()) as Record<string, string> };
}

/** 퇴근 누락 안내 — 최근 7일 중 출근만 있고 퇴근이 없는 날 */
export async function getMissedOut(): Promise<{ date: string; clockIn: string; can22?: boolean; can22Reason?: string | null } | null> {
  const res = await axios.get(`${API_URL}/attendance-requests/missed-out`, { headers: await authHeaders() });
  return res.data?.missed ?? null;
}

/** 전날 퇴근 누락 → 22:00 퇴근으로 처리하는 데 동의(#215-4). 동의한 사람·시각이 기록된다 */
export async function consentMissedOut22(date: string) {
  const res = await axios.post(`${API_URL}/attendance-requests/missed-out/consent`, { date, agree: true }, { headers: await clockHeaders() });   // 출퇴근과 같은 기기 검증
  return res.data as { success: boolean; clockOut: string };
}
