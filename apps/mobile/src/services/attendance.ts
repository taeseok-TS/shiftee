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
