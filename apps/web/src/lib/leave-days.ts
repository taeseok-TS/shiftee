import type { Prisma } from "@prisma/client";
import { getHolidaySet } from "@/lib/holidays";
import { countsCalendarDays, type LeaveUnit } from "@/lib/leave-catalog";

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
  return workdaysFrom(startYmd, endYmd, byDay, holidays);
}

/** 기간 안 근무일(위 규칙) — 순수 함수. byDay = 그 사람의 날짜별 근무일정 */
export function workdaysFrom(startYmd: string, endYmd: string, byDay: Map<string, DaySchedule>, holidays: Set<string>): string[] {
  return ymdRange(startYmd, endYmd).filter((d) => isLeaveWorkday(d, byDay.get(d), holidays));
}

/** error 가 있으면 신청할 수 없다(days 0) */
export type LeaveDaysResult = { days: number; workdays: string[]; error: string | null };

/**
 * 신청 일수 — 유형 단위(FULL = 기간의 근무일 수, HALF = 0.5, QUARTER = 0.25)로 센다.
 * 근무일이 없으면(공휴일·휴무만 골랐거나 반차 날이 근무일이 아니면) days 0 과 안내 문구(error). 날짜 모양 검사는 호출부가 먼저 한다.
 * calendar = 주말·공휴일 포함 달력 날짜로 센다(경조휴가(조사), lib/leave-catalog calendarDays — FULL 만)
 */
export async function countLeaveDays(db: Db, userId: string, unit: LeaveUnit, startYmd: string, endYmd: string, calendar = false): Promise<LeaveDaysResult> {
  if (unit === "FULL" && calendar) {
    const days = ymdRange(startYmd, endYmd);
    return { days: days.length, workdays: days, error: days.length ? null : NO_WORKDAY_MSG };
  }
  if (unit !== "FULL") {
    const workdays = await leaveWorkdaysIn(db, userId, startYmd, startYmd);
    if (workdays.length === 0) return { days: 0, workdays, error: OFF_DAY_MSG };
    return { days: unit === "HALF" ? 0.5 : 0.25, workdays, error: null };
  }
  const workdays = await leaveWorkdaysIn(db, userId, startYmd, endYmd);
  if (workdays.length === 0) return { days: 0, workdays, error: NO_WORKDAY_MSG };
  return { days: workdays.length, workdays, error: null };
}

// ─── 연도를 걸친 휴가는 날짜별로 그 해에 넣는다(2026-10-19 본부 이예지 대리 답, 디렉터 「그렇게 진행해」) ─────────────
// 회계연도 기준이라 12/31~1/2 휴가는 12/31 몫은 그해 연차, 1/2 몫은 다음 해 연차에서 차감한다. 차감·복구(lib/leave-balance),
// 잔여 판정(lib/leave-limit), 연차 대장(lib/leave-ledger), 연차 정산(api/leave/settlement), 휴가 리포트(api/leave/report)가
// **모두 아래 함수**로 해마다(날마다) 몫을 나눈다. 종전에는 시작일 연도에 통째로 넣었다(9/11 「휴가를 쓰는 해」).
// 나누는 원칙:
//  · 근무일 판정은 휴가 일수 계산과 **같은 규칙**(위 isLeaveWorkday — 근무일정 → 없으면 평일·비공휴일).
//  · 근무일 하루 = 1일. 합이 저장된 days 와 다르면(근무일정·공휴일이 신청 뒤에 바뀜, 시프티 가져오기 일수가 파일 값 등)
//    **저장값을 기준**으로 맞춘다 — 차이는 마지막 근무일(= 마지막 해)에서 더하거나 뺀다. 뺄 때는 뒤에서부터 0 까지만 깎고
//    모자라면 그 앞 날로 넘긴다. 그래서 몫의 합은 언제나 저장된 days 와 같다(차감한 만큼만 복구된다).
//  · 근무일이 하루도 안 남으면(그 사이 일정이 전부 휴무로 바뀜) 종전처럼 시작일에 통째로 넣는다.
//  · 반차·반반차(하루짜리)는 그날 하나라 나눌 일이 없다 — 시작일에 저장된 0.5·0.25.
//  · 한 해 안의 휴가는 DB 를 보지 않고 {그 해: days} — 종전 계산과 똑같다(회귀 없음).
// 승인 때 실제로 차감한 해마다 몫은 휴가에 저장한다(LeaveRequest.deductedByYear — lib/leave-balance deductLeave).
// **승인된 휴가**의 몫이 필요한 곳(복구·연차 대장·정산·리포트)은 저장값을 먼저 쓴다(approvedDaysByYear) — 그 뒤 근무일정이
// 바뀌어도 차감한 만큼만 복구되고 대장·정산이 잔여 행과 맞는다. 저장값이 없는 옛 휴가는 **옛 규칙**(시작 해에 days 통째로 —
// 그때 그렇게 차감했다). 대기·미승인 휴가의 미리보기·잔여 판정은 그때그때 나눈다(leaveDaysByYear).

// 반올림하지 않는다(2026-10-19 재검증) — 한 해 안 휴가는 저장된 days 를 **그대로** 차감·저장하고(종전과 같다),
// 걸친 휴가는 해마다 몫의 합이 days 와 정확히 같게 **마지막 해에서** 맞춘다(fixYearSum). c9 는 부동소수 찌꺼기만 지운다(표시·비교용).
const EPS = 1e-9;
const c9 = (n: number) => Math.round(n * 1e9) / 1e9;

/** 휴가 하루하루의 몫(일) — 순수 함수. 합 = storedDays(마지막 날에서 정확히 맞춘다). workdays 는 "YYYY-MM-DD" */
export function leaveDayWeights(workdays: string[], storedDays: number, startYmd: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!(storedDays > 0)) return out;
  if (workdays.length === 0) { out.set(startYmd, storedDays); return out; }
  const days = [...new Set(workdays)].sort();
  for (const d of days) out.set(d, 1);
  let diff = storedDays - days.length;
  if (diff < -EPS) {
    // 남으면 뒤에서부터 0 까지 깎는다
    for (let i = days.length - 1; i >= 0 && diff < -EPS; i--) {
      const cur = out.get(days[i])!;
      const take = Math.min(cur, -diff);
      out.set(days[i], cur - take);
      diff += take;
    }
  }
  for (const [d, w] of out) if (w <= EPS) out.delete(d);
  // 마지막 날 = storedDays − 나머지 합(모자라면 여기에 더해지고, 깎다 생긴 소수 오차도 여기서 없어진다)
  const keys = [...out.keys()].sort();
  const last = keys[keys.length - 1];
  const others = keys.slice(0, -1).reduce((a, d) => a + out.get(d)!, 0);
  out.set(last, storedDays - others);
  return out;
}

/** 날짜별 몫 → 해마다 몫 {2026: 1, 2027: 1}(반올림 없음) */
export function weightsByYear(weights: Map<string, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [d, w] of weights) { const y = Number(d.slice(0, 4)); out.set(y, (out.get(y) ?? 0) + w); }
  return out;
}

/** 해마다 몫의 합을 days 와 정확히 같게 — 마지막 해 = days − 앞 해들의 합 */
export function fixYearSum(m: Map<number, number>, days: number): Map<number, number> {
  const years = [...m.keys()].sort((a, b) => a - b);
  if (!years.length) return m;
  const others = years.slice(0, -1).reduce((a, y) => a + m.get(y)!, 0);
  const out = new Map(years.map((y) => [y, m.get(y)!] as [number, number]));
  out.set(years[years.length - 1], days - others);
  return out;
}

/** 날짜별 몫 중 [from, to] 안의 합 */
export function weightsIn(weights: Map<string, number>, fromYmd: string, toYmd: string): number {
  let n = 0;
  for (const [d, w] of weights) if (d >= fromYmd && d <= toYmd) n += w;
  return c9(n);
}

/** 신청 때 센 근무일(countLeaveDays 의 workdays)로 바로 해마다 몫 — 신청·미리보기가 DB 를 다시 보지 않게. 한 해 안이면 {그 해: days} 그대로 */
export function splitWorkdaysByYear(workdays: string[], storedDays: number, startYmd: string): Map<number, number> {
  const m = weightsByYear(leaveDayWeights(workdays, storedDays, startYmd));
  if (m.size <= 1) return new Map(storedDays > 0 ? [[m.size ? [...m.keys()][0] : Number(startYmd.slice(0, 4)), storedDays]] : []);
  return fixYearSum(m, storedDays);
}

/** type 이 있으면 달력 날짜 유형(경조휴가(조사))은 주말·공휴일까지 날짜 몫을 준다 — 일수를 그렇게 셌으니(검증 C1) */
export type LeaveSpan = { userId: string; startDate: Date; endDate: Date; days: number; type?: string };
const ymdOfDate = (d: Date) => d.toISOString().slice(0, 10);

/** 한 휴가의 날짜별 몫 — 하루짜리·같은 날 휴가는 DB 를 보지 않는다 */
export async function leaveDayWeightsOf(db: Db, leave: LeaveSpan): Promise<Map<string, number>> {
  const s = ymdOfDate(leave.startDate), e = ymdOfDate(leave.endDate);
  if (s >= e) return leaveDayWeights([s], leave.days, s);
  if (leave.type && countsCalendarDays(leave.type)) return leaveDayWeights(ymdRange(s, e), leave.days, s);
  return leaveDayWeights(await leaveWorkdaysIn(db, leave.userId, s, e), leave.days, s);
}

/**
 * **한 휴가의 해마다 몫** — {2026: 1, 2027: 1}. 차감·복구·잔여·대장·정산이 이것 하나를 쓴다.
 * 한 해 안의 휴가는 DB 를 보지 않고 {시작일 연도: days}(종전과 같다).
 */
export async function leaveDaysByYear(db: Db, leave: LeaveSpan): Promise<Map<number, number>> {
  const sy = leave.startDate.getUTCFullYear(), ey = leave.endDate.getUTCFullYear();
  if (sy === ey) return new Map(leave.days > 0 ? [[sy, leave.days]] : []);   // 한 해 안 — days 그대로(반올림 없음)
  const m = weightsByYear(await leaveDayWeightsOf(db, leave));
  if (m.size <= 1) return new Map(leave.days > 0 ? [[m.size ? [...m.keys()][0] : sy, leave.days]] : []);
  return fixYearSum(m, leave.days);
}

/** 그 해 몫만 */
export async function leaveDaysInYear(db: Db, leave: LeaveSpan, year: number): Promise<number> {
  return (await leaveDaysByYear(db, leave)).get(year) ?? 0;
}

/**
 * 여러 휴가의 날짜별 몫을 한 번에(리포트처럼 건수가 많은 곳) — 근무일정·공휴일을 한 번씩만 읽는다. key = 휴가 id.
 * 하루짜리 휴가는 DB 없이 시작일에 저장 days.
 */
export async function leaveDayWeightsMany(db: Db, leaves: (LeaveSpan & { id: string })[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const multi = leaves.filter((l) => ymdOfDate(l.startDate) < ymdOfDate(l.endDate));
  for (const l of leaves) if (!multi.includes(l)) out.set(l.id, leaveDayWeights([ymdOfDate(l.startDate)], l.days, ymdOfDate(l.startDate)));
  if (!multi.length) return out;
  const minS = new Date(Math.min(...multi.map((l) => l.startDate.getTime())));
  const maxE = new Date(Math.max(...multi.map((l) => l.endDate.getTime())));
  const holidays = await getHolidaySet(minS, maxE);
  const byUser = new Map<string, Map<string, DaySchedule>>();
  // 근무일정은 그 휴가 기간만 — 200건씩 나눠 읽는다
  for (let i = 0; i < multi.length; i += 200) {
    const chunk = multi.slice(i, i + 200);
    const rows = await db.schedule.findMany({
      where: { OR: chunk.map((l) => ({ userId: l.userId, date: { gte: l.startDate, lte: l.endDate } })) },
      select: { userId: true, date: true, type: true },
    });
    for (const r of rows) {
      let m = byUser.get(r.userId);
      if (!m) { m = new Map(); byUser.set(r.userId, m); }
      m.set(ymdOfDate(r.date), r.type as DaySchedule);
    }
  }
  for (const l of multi) {
    const s = ymdOfDate(l.startDate), e = ymdOfDate(l.endDate);
    const days = l.type && countsCalendarDays(l.type) ? ymdRange(s, e) : workdaysFrom(s, e, byUser.get(l.userId) ?? new Map(), holidays);
    out.set(l.id, leaveDayWeights(days, l.days, s));
  }
  return out;
}

// ─── 승인된 휴가의 해마다 몫 — 저장값(deductedByYear) 우선 ───

/** 해마다 몫 → 저장 모양 {"2026":1,"2027":1}(값 그대로) */
export function byYearToJson(m: Map<number, number>): Record<string, number> {
  return Object.fromEntries([...m].sort((a, b) => a[0] - b[0]).filter(([, d]) => d > 0).map(([y, d]) => [String(y), d]));
}

/**
 * 저장값 읽기 — 하나라도 어긋나면 null(→ 옛 규칙). 키는 4자리 연도("2026")만, 값은 유한한 0 이상 숫자만,
 * 합이 그 휴가의 days 와 (부동소수 오차 1e-9 안에서) 같아야 한다. 0 인 해는 몫에서 뺀다.
 */
export function parseByYear(v: unknown, days: number): Map<number, number> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out = new Map<number, number>();
  let sum = 0;
  for (const [k, d] of Object.entries(v as Record<string, unknown>)) {
    if (!/^\d{4}$/.test(k) || typeof d !== "number" || !Number.isFinite(d) || d < 0) return null;
    sum += d;
    if (d > 0) out.set(Number(k), d);
  }
  if (Math.abs(sum - days) > EPS) return null;
  return out;
}

export type ApprovedSpan = { startDate: Date; days: number; deductedByYear?: unknown };

/**
 * **승인된 연차 차감 휴가의 해마다 몫**(순수 함수, DB 없음) — 차감 때 저장한 값(deductedByYear). 없거나 깨졌으면 옛 규칙
 * {시작 해: days}(한 해 안 휴가는 원래 그렇고, 저장 전에 승인된 걸친 휴가는 그때 시작 해에 통째로 차감됐다 — 이중 계산 없게).
 * ⚠ 연차를 차감하지 않는 유형(무급·예비군·대체휴일 등)은 deductLeave 를 거치지 않아 저장값이 없다 — 그런 휴가에 이 함수를
 *   쓰지 말고 날짜 몫(leaveDaysByYear·leaveDayWeights — 근무일정 기준)을 그대로 쓴다.
 */
export function approvedDaysByYear(leave: ApprovedSpan): Map<number, number> {
  return parseByYear(leave.deductedByYear, leave.days) ?? new Map(leave.days > 0 ? [[leave.startDate.getUTCFullYear(), leave.days]] : []);
}

/**
 * 날짜별 몫(그때 나눈 것)을 해마다 몫(저장값)에 맞춘다 — 리포트처럼 기간을 날짜로 자르는 곳용(연차 차감 유형만). 해마다 합 = byYear.
 * 그 해 날짜 몫의 비율대로 늘리거나 줄이고(그 해 마지막 날에서 합을 정확히 맞춘다), 그 해에 몫이 있는 날이 없으면
 * 그 해 휴가 첫날(시작일이 그 해면 시작일)에 둔다.
 */
export function alignWeightsToYears(weights: Map<string, number>, byYear: Map<number, number>, startYmd: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [y, want] of byYear) {
    if (!(want > 0)) continue;
    const mine = [...weights].filter(([d]) => d.startsWith(`${y}-`)).sort((a, b) => a[0].localeCompare(b[0]));
    const have = mine.reduce((a, [, w]) => a + w, 0);
    if (have <= EPS) { out.set(startYmd.startsWith(`${y}-`) ? startYmd : `${y}-01-01`, want); continue; }
    if (Math.abs(have - want) <= EPS) { for (const [d, w] of mine) out.set(d, w); continue; }   // 이미 맞음 — 그대로
    let used = 0;
    mine.forEach(([d, w], i) => {
      const v = i === mine.length - 1 ? want - used : (w * want) / have;
      used += v;
      if (v > EPS) out.set(d, v);
    });
  }
  return out;
}
