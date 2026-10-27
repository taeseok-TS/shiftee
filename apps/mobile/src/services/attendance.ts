/**
 * ============================================
 * 큐브티 Mobile - 출퇴근 서비스
 * 서버 에러 메시지를 그대로 노출하기 위해 직접 axios 사용(Bearer 토큰).
 * ============================================
 */

import axios from "axios";
import { API_URL } from "../config";
import { getToken } from "./storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getDeviceId } from "./device";

async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// 출퇴근 전용: 기기 검증 헤더 포함 (서버가 등록 기기와 대조) + OS · 앱 버전(위치 판정 시도 기록용, 2026-10-27 — 본부가 기기 쪽 원인을 가려 볼 수 있게)
// runtimeVersion 은 app.json 에서 { policy: "appVersion" } 객체라 version 과 같다 — version 만 쓴다(String(객체) 는 "[object Object]", 10/27 검증)
const APP_VERSION = String(Constants.expoConfig?.version ?? "?");
async function clockHeaders() {
  return { ...(await authHeaders()), "x-device-id": await getDeviceId(), "x-platform": Platform.OS, "x-app-version": APP_VERSION };
}

export type TodayStatus = {
  clockedIn: boolean;
  clockedOut: boolean;
  clockInAt: string | null;
  clockOutAt: string | null;
  pendingIn?: boolean;    // 지점 밖·사진·본부 처리 출근 요청이 승인 대기 중(2026-10-07)
  pendingOut?: boolean;
  pendingInClockedOut?: boolean;   // 출근 요청 승인 대기 중에 퇴근까지 찍음(승인 때 함께 기록)
  timesHidden?: boolean;   // 시각이 빠졌는지(직원 · 원장). false 면 clockInAt · clockOutAt 이 온다
};

export async function getTodayStatus(): Promise<TodayStatus> {
  const res = await axios.get(`${API_URL}/attendance/today`, { headers: await authHeaders() });
  return res.data as TodayStatus;
}

// accuracy = 폰이 알려 준 위치 오차 반경(m) — 서버가 판정 시도 기록에 남기고, 지점 밖이면 응답에 되돌려 준다(2026-10-27)
export async function clockIn(latitude: number, longitude: number, accuracy?: number | null) {
  const res = await axios.post(
    `${API_URL}/attendance/clock-in`,
    { latitude, longitude, accuracy: accuracy ?? undefined },
    { headers: await clockHeaders() }
  );
  return res.data;
}

export async function clockOut(latitude: number, longitude: number, accuracy?: number | null) {
  const res = await axios.post(
    `${API_URL}/attendance/clock-out`,
    { latitude, longitude, accuracy: accuracy ?? undefined },
    { headers: await clockHeaders() }
  );
  return res.data;
}

// ─── 출퇴근 요청(2026-10-07 QA #9 #13 #15) ────────────────────────────
// 지점 밖·사진·본부 처리·기록 수정·퇴근 누락. 결재는 원장(원장 본인은 본부), 본부 처리는 본부.

// RECORD = 출퇴근 기록 요청(2026-10-23 ■0-11) — 찍은 시각은 본부만 보므로, 기록이 필요하면 기간을 골라 본부에 요청한다(기록은 안 바뀐다)
export type RequestKind = "OUTSIDE" | "PHOTO" | "HQ" | "CORRECTION" | "MISSED_OUT" | "DEVICE" | "RECORD";

export type AttendanceRequestRow = {
  id: string; userId: string; userName: string; userBranch: string | null; userPosition: string | null;
  kind: RequestKind; kindLabel: string; action: "IN" | "OUT" | null; workDate: string; summary: string;
  reason: string | null; memo: string | null; hasPhoto: boolean; deviceName: string | null; platform: string | null;
  approverLabel: string; status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; decidedByName: string | null;
  rejectReason: string | null;
  createdAt: string | null;   // 시각을 숨긴 줄(직원 · 원장)은 null — 날짜는 createdDate(KST "YYYY-MM-DD")
  createdDate?: string;
  // 2026-10-23 ■0-11 — 출퇴근 수정은 「지점 원장 → 본부」 두 단계. 서버가 줄마다 싣는다(옛 서버면 없음)
  currentStep?: "MANAGER" | "HQ" | null;   // 지금 차례(대기 중일 때만)
  nextStep?: "HQ" | null;                  // 이 단계를 승인하면 넘어갈 차례
  step1?: { name: string; at: string } | null;   // 1차(원장) 승인한 사람 · 시각
  recordState?: string | null;             // 그날 기록 상태 「출근 · 퇴근 누락」(시각 없이)
  timesHidden?: boolean;                   // 이 줄에서 시각이 빠졌는지(직원 · 원장)
  // 지점 밖 · 사진 · 본부 요청의 판정 근거(2026-10-27) — 찍힌 위치 ↔ 소속 지점 거리 · 폰 위치 오차 · 인정 거리(m). 좌표 숫자는 오지 않는다
  distanceM?: number | null; accuracyM?: number | null; radiusM?: number | null; nearBranch?: string | null;
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

/** 처리 — 응답 step: "HQ" = 원장 1차 승인(본부 최종 대기), "DONE" = 끝. message 는 띠 · 안내에 그대로 쓴다 */
export async function decideAttendanceRequest(id: string, action: "approve" | "reject", reason?: string): Promise<{ step?: "HQ" | "DONE"; message?: string }> {
  const res = await axios.post(`${API_URL}/attendance-requests/${id}`, { action, reason }, { headers: await authHeaders() });
  return (res.data ?? {}) as { step?: "HQ" | "DONE"; message?: string };
}

/** 출퇴근 기록 요청(RECORD) — 기간(from~to, 오늘까지) · 쓰는 곳(선택). 본부가 받아 기록을 내준다. 기기 검증 없음 */
export async function createRecordRequest(from: string, to: string, reason?: string) {
  const res = await axios.post(`${API_URL}/attendance-requests`, { kind: "RECORD", from, to, reason: reason || undefined }, { headers: await authHeaders() });
  return res.data as { success: true; id: string; approverLabel: string };
}

/** 사진 요청의 지점 사진 주소 — 이미지에 Authorization 헤더를 붙여 연다 */
export async function attendanceRequestPhotoSource(id: string) {
  return { uri: `${API_URL}/attendance-requests/${id}/photo`, headers: (await authHeaders()) as Record<string, string> };
}

/** 퇴근 누락 안내 — 최근 7일 중 출근만 있고 퇴근이 없는 날.
 *  closeAt/closeHhmm/closeLabel = 본인 동의로 기록될 퇴근 시각과 기준(서버가 근무일정 퇴근 시각으로 계산, 2026-10-17 #219-4) */
export type MissedOut = {
  date: string; clockIn: string;
  canConsent?: boolean; consentReason?: string | null;
  closeAt?: string; closeHhmm?: string; closeLabel?: string;
  can22?: boolean; can22Reason?: string | null;   // 구버전 호환(서버가 계속 준다)
};
export async function getMissedOut(): Promise<MissedOut | null> {
  const res = await axios.get(`${API_URL}/attendance-requests/missed-out`, { headers: await authHeaders() });
  return res.data?.missed ?? null;
}

/** 전날 퇴근 누락 → 서버가 알려 준 퇴근 시각(근무일정 기준)으로 처리하는 데 동의(#215-4·#219-4). 동의한 사람·시각·기준이 기록된다.
 *  expectAt = 화면에 보여 준 시각 — 그 사이 바뀌었으면 서버가 409 로 돌려보낸다 */
export async function consentMissedOut(date: string, expectAt: string) {
  const res = await axios.post(`${API_URL}/attendance-requests/missed-out/consent`, { date, agree: true, expectAt }, { headers: await clockHeaders() });   // 출퇴근과 같은 기기 검증
  return res.data as { success: boolean; clockOut: string; closeHhmm?: string; closeLabel?: string };
}

/** 내 지난 출퇴근 — 날짜별 상태 알약용(2026-10-23 앱 4 · ■0-11: 시각 없이 상태만 그린다).
 *  서버 GET /api/attendance?year&month. 본부 권한 설정 「본인 출퇴근 기록 열람」이 꺼져 있으면 403 → null(화면은 퇴근 누락 안내만).
 *  hasClockIn / hasClockOut(찍었는지 여부만)을 서버가 주면 그것을, 없으면 시각 유무를 본다 */
// imported = 시프티에서 옮겨 온 기록(서버 importBatch) — 이 앱에서 고치지 않는다(수정 요청 버튼을 그리지 않음)
// inAt · outAt — 서버가 시각을 풀어 준 날만 온다(본부 · 승인된 「출퇴근 기록 요청」 기간, 2026-10-27 ⑦). 그 밖에는 undefined
export type MyDayRecord = { date: string; status: string; hasIn: boolean | undefined; hasOut: boolean | undefined; imported: boolean; inAt?: string; outAt?: string; granted?: boolean };
/** myUserId 를 주면 그 사람 줄만 남긴다 — 원장은 서버가 지점 사람 기록까지 함께 줄 수 있다(지점 출퇴근 기록 열람이 켜져 있으면) */
export async function getMyAttendanceMonth(year: number, month: number, myUserId?: string): Promise<MyDayRecord[] | null> {
  try {
    const res = await axios.get(`${API_URL}/attendance`, { params: { year, month, ...(myUserId ? { userId: myUserId } : {}) }, headers: await authHeaders() });
    type Raw = { userId?: string; date: string; status: string; clockIn?: string | null; clockOut?: string | null; hasClockIn?: boolean; hasClockOut?: boolean; importBatch?: string | null; timesGranted?: boolean };
    const rows = ((res.data?.records ?? []) as Raw[]).filter((r) => !myUserId || !r.userId || r.userId === myUserId);
    return rows.map((r) => {
      const hasIn = typeof r.hasClockIn === "boolean" ? r.hasClockIn : r.clockIn ? true : undefined;
      const hasOut = typeof r.hasClockOut === "boolean" ? r.hasClockOut : r.clockOut ? true : r.clockIn ? false : undefined;
      return { date: String(r.date).slice(0, 10), status: r.status, hasIn, hasOut, imported: !!r.importBatch, inAt: r.clockIn || undefined, outAt: r.clockOut || undefined, granted: !!r.timesGranted };
    });
  } catch (e: any) {
    if (e?.response?.status === 403) return null;
    throw e;
  }
}
