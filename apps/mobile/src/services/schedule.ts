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
  startTime?: string | null; // "HH:MM" — 없으면 종일(#221, 옛 서버는 안 보냄)
  endTime?: string | null;
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

/** 내 근무일정 — 기간(YYYY-MM-DD, 주·일 보기 #81). 달 경계를 넘는 주도 한 번에 */
export type MyShift = { id: string; userId: string; date: string; startTime: string; endTime: string; type: string; note: string | null; branch: string | null };
export async function getMySchedulesRange(start: string, end: string): Promise<MyShift[]> {
  const res = await axios.get(`${API_URL}/schedule`, { params: { scope: "self", start, end }, headers: await authHeaders() });
  return (res.data?.schedules as MyShift[]) || [];
}

/** 지점 하루 현황(원장 · 관리자, 2026-10-23 조혜련 원장 문의) — 웹 원장 근무일정 · 대시보드와 같은 GET /api/schedule/day.
 *  원장은 담당 지점 직원, 관리자는 전체. 「원장 출퇴근 열람」이 꺼지면 attendanceHidden=true 로 출퇴근 시각 · 상태 없이 일정 · 휴가만 온다.
 *  2026-10-23 ■0-11: 출퇴근 시각 · 근무시간은 본부만 — 원장 · 직원에게는 서버가 clockIn/clockOut 을 빼고 상태만 준다.
 *  앱은 시각 없이 상태(status)만으로 그린다. 서버가 hasClockIn / hasClockOut(찍었는지 여부만)을 주면 근무 중 · 퇴근 · 퇴근 누락을 가른다 */
export type BranchDayRow = {
  id: string; name: string; position: string; branch: string | null;
  scheduleType: string | null; startTime: string | null; endTime: string | null; note: string | null;
  clockIn?: string | null; clockOut?: string | null; leaveType: string | null;
  hasClockIn?: boolean; hasClockOut?: boolean;   // 시각 없이 찍었는지만(■0-11 뒤 서버) — 없으면 시각 유무로 본다
  phone?: string | null;                          // 미출근 「전화」(서버가 주면)
  status: string;   // LEAVE · NO_SCHEDULE · OFF · HOLIDAY · WORK(열람 꺼짐) · NORMAL · LATE · EARLY_LEAVE · ABSENT · NOT_YET
};
// timesHidden = 서버가 시각을 뺐는지(본부 · 「출퇴근 시각 보기」 켠 원장은 false). 옛 서버면 undefined — 화면은 역할로 가린다
export type BranchDay = { date: string; employees: BranchDayRow[]; attendanceHidden: boolean; timesHidden?: boolean };
export async function getBranchDay(date: string): Promise<BranchDay> {
  const res = await axios.get(`${API_URL}/schedule/day`, { params: { date }, headers: await authHeaders() });
  // 근무 유형은 DB 값(WORK · OFF · HOLIDAY) 그대로 온다 — 앱의 다른 일정(/schedule 은 소문자)과 맞춰 소문자로(검증 1)
  const employees = ((res.data?.employees as BranchDayRow[]) || []).map((r) => ({ ...r, scheduleType: r.scheduleType ? r.scheduleType.toLowerCase() : null }));
  return { date, employees, attendanceHidden: !!res.data?.attendanceHidden, timesHidden: typeof res.data?.timesHidden === "boolean" ? res.data.timesHidden : undefined };
}

export { isPartialLeave } from "./leaveLabels";   // 반나절 휴가(유형 단위 기준 — 코드 글자로 추측하지 않는다, 검증 N2)

/** 찍었는지 — 서버 플래그가 있으면 그것, 없으면 시각 유무. 모르면 undefined */
export const clockedIn = (r: BranchDayRow): boolean | undefined => (typeof r.hasClockIn === "boolean" ? r.hasClockIn : r.clockIn ? true : undefined);
export const clockedOut = (r: BranchDayRow): boolean | undefined => (typeof r.hasClockOut === "boolean" ? r.hasClockOut : r.clockOut ? true : r.clockIn ? false : undefined);
const ATTENDED = ["NORMAL", "LATE", "EARLY_LEAVE"];

/** 한 사람의 지금 상태 — 홈 「오늘 근태」와 지점 일정 목록이 같은 말을 쓴다 */
export type NowKind = "working" | "done" | "in" | "notYet" | "missing" | "absent" | "leave" | "off" | "none" | "planned" | "noRecord" | "unclosed" | "worked";   // 뒤 넷은 지난날 보기용
/** nowHHmm(오늘 볼 때 지금 시각) — 근무 시작 시각이 지났는데 출근 기록이 없으면 「미출근」(시프티 앱과 같게, 검증 5) */
export function nowKindOf(r: BranchDayRow, nowHHmm?: string): NowKind {
  const cin = clockedIn(r), cout = clockedOut(r);
  // 휴가라도 출근을 찍었으면(반차 뒤 출근) 지금은 근무 중 · 퇴근으로 센다(검증 6)
  if (r.status === "LEAVE") return cin ? (cout ? "done" : cout === false ? "working" : "in") : "leave";
  if (r.status === "NO_SCHEDULE") return cin ? (cout ? "done" : cout === false ? "working" : "in") : "none";   // 일정 없이 찍은 사람도 근무 중으로
  if (r.status === "OFF" || r.status === "HOLIDAY") return "off";
  if (r.status === "WORK") return "planned";
  if (r.status === "ABSENT") return "absent";
  if (r.status === "NOT_YET") return nowHHmm && r.startTime && nowHHmm > r.startTime ? "missing" : "notYet";
  // 출근 기록이 있는 상태(정상 · 지각 · 조퇴) — 시각이 없어도 출근은 한 것(■0-11 뒤에는 상태만 온다)
  if (ATTENDED.includes(r.status) || cin) return cout ? "done" : cout === false ? "working" : "in";
  return "notYet";
}
export const NOW_LABEL: Record<NowKind, string> = {
  working: "근무 중", done: "퇴근", in: "출근", notYet: "출근 전", missing: "미출근", absent: "미출근", leave: "휴가", off: "휴무", none: "일정 없음", planned: "근무 예정", noRecord: "기록 없음", unclosed: "퇴근 누락", worked: "근무",
};

/** 달력 보기 단위(월·주·일) — 사람마다 서버 저장, 웹 「근무일정」과 같은 값을 본다(#81) */
export type CalendarUnit = "month" | "week" | "day";
export async function getMyCalendarUnit(): Promise<CalendarUnit> {
  try {
    const res = await axios.get(`${API_URL}/me/prefs`, { headers: await authHeaders() });
    const u = res.data?.prefs?.myCalendar?.unit;
    return u === "month" || u === "day" ? u : "week";   // 저장한 적 없으면 주 보기(10/23 시안 S1-3 「처음엔 주 보기」)
  } catch { return "week"; }
}
export async function setMyCalendarUnit(unit: CalendarUnit): Promise<void> {
  try { await axios.put(`${API_URL}/me/prefs`, { myCalendar: { unit } }, { headers: await authHeaders() }); } catch { /* 저장 못 해도 이번 화면은 바뀐다 */ }
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

/** 근무일정 템플릿(본부 관리, 2026-10-07 QA #10) — 전사 공통 + 내 지점 전용 */
export type ScheduleTemplate = { id: string; name: string; startTime: string; endTime: string; hours: number };
export async function getScheduleTemplates(): Promise<ScheduleTemplate[]> {
  const res = await axios.get(`${API_URL}/schedule-templates`, { headers: await authHeaders() });
  return ((res.data?.templates ?? []) as { id: string; name: string; startTime: string; endTime: string }[]).map((t) => {
    const [sh, sm] = t.startTime.split(":").map(Number), [eh, em] = t.endTime.split(":").map(Number);
    // 이름에 시간이 이미 들어 있으면(「학기중(13:00~22:00)」) 다시 붙이지 않는다 — 「(13:00~22:00) (13:00~22:00)」로 두 번 보였다(10/23 앱 2)
    const has = /\d{1,2}:\d{2}\s*[~\-–]\s*\d{1,2}:\d{2}/.test(t.name);
    return { id: t.id, name: has ? t.name : `${t.name} (${t.startTime}–${t.endTime})`, startTime: t.startTime, endTime: t.endTime, hours: Math.round(((eh * 60 + em) - (sh * 60 + sm)) / 6) / 10 };
  });
}

// 근무일정 신청 (웹 신청 페이지와 동일한 서버 계약 — 결재라인은 서버 정책이 자동 구성)
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
