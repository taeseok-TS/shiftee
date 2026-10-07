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
/** 근무일정 템플릿(본부 관리, 2026-10-07 QA #10) — 전사 공통 + 내 지점 전용 */
export type ScheduleTemplate = { id: string; name: string; startTime: string; endTime: string; hours: number };
export async function getScheduleTemplates(): Promise<ScheduleTemplate[]> {
  const res = await axios.get(`${API_URL}/schedule-templates`, { headers: await authHeaders() });
  return ((res.data?.templates ?? []) as { id: string; name: string; startTime: string; endTime: string }[]).map((t) => {
    const [sh, sm] = t.startTime.split(":").map(Number), [eh, em] = t.endTime.split(":").map(Number);
    return { id: t.id, name: `${t.name} (${t.startTime}~${t.endTime})`, startTime: t.startTime, endTime: t.endTime, hours: Math.round(((eh * 60 + em) - (sh * 60 + sm)) / 6) / 10 };
  });
}

export async function createScheduleRequest(payload: {
  kind?: "CREATE" | "UPDATE" | "DELETE";   // 2026-10-07 #49 — 기존 일정 수정·삭제 요청
  templateId: string;
  templateName: string;
  startDate: string;
  endDate: string;
  scheduleData: { date: string; startTime: string; endTime: string }[];
  totalHours: number;
}) {
  const res = await axios.post(`${API_URL}/schedule-requests`, payload, { headers: await authHeaders() });
  return { warnings: (res.data?.warnings ?? []) as string[] };   // 주 49시간 초과 경고(#38)
}

/**
 * 본인이 낸 근무일정 신청을 **취소**한다(대기 중인 건만 — 서버가 다시 확인).
 * 반려와 다르다: 반려는 "안 된다"는 결재 결과로 기록에 남고, 취소는 신청 자체를 거둔다.
 * 웹과 같은 계약이다(DELETE).
 */
export async function cancelMyScheduleRequest(id: string): Promise<void> {
  await axios.delete(`${API_URL}/schedule-requests/${id}`, { headers: await authHeaders() });
}
