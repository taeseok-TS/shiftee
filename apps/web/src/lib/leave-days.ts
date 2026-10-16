import type { Prisma } from "@prisma/client";
import { getHolidaySet } from "@/lib/holidays";
import type { LeaveUnit } from "@/lib/leave-catalog";

// ─── 휴가 일수 = 근무일정 기준(2026-10-16 #219 10·12, 디렉터 결정 (d)) ─────────────────────────
// 휴가 일수를 세는 곳은 **여기 한 곳**이다 — 서버 신청 검사(api/leave POST)와 신청 창 미리보기(api/leave/days)가 같이 쓴다.
// 종전에는 서버는 공휴일을 빼고 웹 신청 창 두 곳((dashboard)/leave, admin/leave)은 주말만 빼서, 화면은 「3일」인데
// 실제 차감은 2일이었다(#219-10, 10/05 대체공휴일·12/25 성탄절). 화면은 이제 서버가 센 값을 받아서만 보여 준다.
// 규칙:
//  · 그날 그 사람의 근무일정(Schedule, 사람·날짜 1행)이 있으면 그것을 따른다 — WORK = 근무일(센다), OFF·HOLIDAY = 안 셈.
//    주말 근무자(주말 학습실장·토요일 근무 매니저)는 근무일정이 있는 토·일을 연차로 쓸 수 있고(#219-12),
//    공휴일에 근무가 잡힌 날도 센다.
//  · 일정이 없는 날은 종전대로 평일이면서 공휴일(Holiday 표 — 공휴일의 단일 원천)이 아닌 날만 센다.
// 반차·반반차(하루짜리 유형)는 일수가 고정(0.5·0.25)이고, 그날이 위 규칙의 근무일이어야 한다.

type Db = Prisma.TransactionClient;
export type DaySchedule = "WORK" | "OFF" | "HOLIDAY";

export const NO_WORKDAY_MSG = "선택한 기간에 근무일이 없습니다. (근무일정의 휴무·공휴일, 일정 없는 주말·공휴일은 빠집니다)";
export const OFF_DAY_MSG = "근무일이 아닌 날에는 반차·반반차를 신청할 수 없습니다. (근무일정의 휴무·공휴일, 일정 없는 주말·공휴일)";

/** 그날이 휴가 일수로 세는 근무일인가 — 순수 규칙(위 설명). ymd = "YYYY-MM-DD" */
export function isLeaveWorkday(ymd: string, sched: DaySchedule | undefined, holidays: Set<string>): boolean {
  if (sched === "WORK") return true;
  if (sched === "OFF" || sched === "HOLIDAY") return false;
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.has(ymd);
}

/** "YYYY-MM-DD" 두 날짜 사이(양끝 포함)의 날짜 목록 — UTC 자정 기준(@db.Date 저장 규칙과 같다) */
export function ymdRange(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const end = new Date(`${endYmd}T00:00:00Z`).getTime();
  for (let t = new Date(`${startYmd}T00:00:00Z`).getTime(); t <= end; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** 그 사람의 기간 안 근무일(위 규칙) 목록 */
export async function leaveWorkdaysIn(db: Db, userId: string, startYmd: string, endYmd: string): Promise<string[]> {
  const start = new Date(`${startYmd}T00:00:00Z`);
  const end = new Date(`${endYmd}T00:00:00Z`);
  const [holidays, schedules] = await Promise.all([
    getHolidaySet(start, end),
    db.schedule.findMany({ where: { userId, date: { gte: start, lte: end } }, select: { date: true, type: true } }),
  ]);
  const byDay = new Map<string, DaySchedule>(schedules.map((s) => [s.date.toISOString().slice(0, 10), s.type as DaySchedule]));
  return ymdRange(startYmd, endYmd).filter((d) => isLeaveWorkday(d, byDay.get(d), holidays));
}

/** error 가 있으면 신청할 수 없다(days 0) */
export type LeaveDaysResult = { days: number; workdays: string[]; error: string | null };

/**
 * 신청 일수 — 유형 단위(FULL = 기간의 근무일 수, HALF = 0.5, QUARTER = 0.25)로 센다.
 * 근무일이 없으면(공휴일·휴무만 골랐거나 반차 날이 근무일이 아니면) days 0 과 안내 문구(error). 날짜 모양 검사는 호출부가 먼저 한다.
 */
export async function countLeaveDays(db: Db, userId: string, unit: LeaveUnit, startYmd: string, endYmd: string): Promise<LeaveDaysResult> {
  if (unit !== "FULL") {
    const workdays = await leaveWorkdaysIn(db, userId, startYmd, startYmd);
    if (workdays.length === 0) return { days: 0, workdays, error: OFF_DAY_MSG };
    return { days: unit === "HALF" ? 0.5 : 0.25, workdays, error: null };
  }
  const workdays = await leaveWorkdaysIn(db, userId, startYmd, endYmd);
  if (workdays.length === 0) return { days: 0, workdays, error: NO_WORKDAY_MSG };
  return { days: workdays.length, workdays, error: null };
}
