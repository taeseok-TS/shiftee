/**
 * ============================================
 * 큐브티 Mobile - 일정 부가 서비스
 * (회사 캘린더 조회 + 근무일정 신청)
 * ============================================
 */

import axios from "axios";
import { API_URL } from "../config";
import { getToken } from "./storage";

async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// 회사/지점 전체 일정 (큐브티워크 캘린더와 동일 데이터)
export type WorkCalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  branch: string | null; // null = 전사
  managersOnly?: boolean; // 원장 전용 (서버가 원장·관리자에게만 내려줌)
  color: string | null;
};

export async function getWorkCalendar(year: number, month: number): Promise<WorkCalendarEvent[]> {
  const res = await axios.get(`${API_URL}/work/calendar`, {
    params: { year, month },
    headers: await authHeaders(),
  });
  return (res.data?.events as WorkCalendarEvent[]) || [];
}

// 공휴일 목록 (연도별 — 관리자 > 공휴일 관리에서 등록된 데이터)
export type Holiday = { id: string; date: string; name: string };
export async function getHolidays(year: number): Promise<Holiday[]> {
  const res = await axios.get(`${API_URL}/holidays`, {
    params: { year },
    headers: await authHeaders(),
  });
  return (res.data?.holidays as Holiday[]) || [];
}

// 근무일정 신청 (웹 신청 페이지와 동일한 서버 계약 — 결재라인은 서버 정책이 자동 구성)
export async function createScheduleRequest(payload: {
  templateId: string;
  templateName: string;
  startDate: string;
  endDate: string;
  scheduleData: { date: string; startTime: string; endTime: string }[];
  totalHours: number;
}) {
  await axios.post(`${API_URL}/schedule-requests`, payload, { headers: await authHeaders() });
}
