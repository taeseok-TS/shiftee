import {
  addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format,
  startOfDay, startOfMonth, startOfWeek, subDays, subMonths, subWeeks,
} from "date-fns";
import { ko } from "date-fns/locale";
import { breakHours } from "@/lib/schedule-payload";

/**
 * 근무일정 보기 전환(2026-10-12 QA #71) — 본부 근무일정·원장 팀 근무일정이 같이 쓰는 순수 계산.
 *  · 보기 단위: 일 · 주 · 월. 보기 모양: 달력형(표) · 목록형.
 *  · 주의 시작 요일은 #73 에서 설정으로 열어 둔다(지금은 월요일). 주 49시간 합계(서버)는 법정 기준이라 늘 월~일로 센다.
 *  · 날짜 계산은 전부 **브라우저 달력 날짜**(로컬)로 한다 — 서버와 주고받을 때만 yyyy-MM-dd 문자열
 */
export type ViewUnit = "day" | "week" | "month";
export type ViewLayout = "grid" | "list";
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type DateRange = { start: Date; end: Date };

export const UNIT_LABEL: Record<ViewUnit, string> = { day: "일", week: "주", month: "월" };
export const LAYOUT_LABEL: Record<ViewLayout, string> = { grid: "달력형", list: "목록형" };
export const VIEW_UNITS: ViewUnit[] = ["day", "week", "month"];
export const VIEW_LAYOUTS: ViewLayout[] = ["grid", "list"];

export const ymd = (d: Date) => format(d, "yyyy-MM-dd");
export const isViewUnit = (v: unknown): v is ViewUnit => v === "day" || v === "week" || v === "month";
export const isViewLayout = (v: unknown): v is ViewLayout => v === "grid" || v === "list";

/** 기준 날짜가 속한 기간 */
export function rangeOf(anchor: Date, unit: ViewUnit, weekStartsOn: WeekStart = 1): DateRange {
  if (unit === "day") { const s = startOfDay(anchor); return { start: s, end: s }; }
  if (unit === "week") return { start: startOfWeek(anchor, { weekStartsOn }), end: endOfWeek(anchor, { weekStartsOn }) };
  return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
}

export const daysOf = (range: DateRange): Date[] => eachDayOfInterval({ start: range.start, end: range.end });

/** 앞·뒤 기간으로 */
export function shiftAnchor(anchor: Date, unit: ViewUnit, delta: 1 | -1): Date {
  if (unit === "day") return delta > 0 ? addDays(anchor, 1) : subDays(anchor, 1);
  if (unit === "week") return delta > 0 ? addWeeks(anchor, 1) : subWeeks(anchor, 1);
  return delta > 0 ? addMonths(anchor, 1) : subMonths(anchor, 1);
}

/** 기간 제목 — 일: 「2026년 10월 12일 (월)」, 주: 「2026년 10월 12일 - 18일」(달이 바뀌면 「- 11월 1일」), 월: 「2026년 10월」 */
export function rangeTitle(range: DateRange, unit: ViewUnit): string {
  if (unit === "day") return format(range.start, "yyyy년 M월 d일 (EEE)", { locale: ko });
  if (unit === "month") return format(range.start, "yyyy년 M월", { locale: ko });
  const sameMonth = range.start.getMonth() === range.end.getMonth();
  return `${format(range.start, "yyyy년 M월 d일", { locale: ko })} - ${format(range.end, sameMonth ? "d일" : "M월 d일", { locale: ko })}`;
}

/** 기간에 걸친 연도 목록(공휴일 조회용 — 연말·연초 주는 두 해에 걸친다) */
export function yearsOf(range: DateRange): number[] {
  const a = range.start.getFullYear(), b = range.end.getFullYear();
  const out: number[] = [];
  for (let y = a; y <= b; y++) out.push(y);
  return out;
}

const toMin = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export { toMin as timeToMin };

/** 근무일정 한 건의 근로시간(분, 휴게 제외) — 서버 lib/weekly-hours 의 netMin 과 같은 규칙 */
export function netMinutes(startTime: string, endTime: string): number {
  const s = toMin(startTime), e = toMin(endTime);
  if (s == null || e == null || e <= s) return 0;
  const span = e - s;
  return Math.max(span - Math.round(breakHours(span / 60) * 60), 0);
}

export const fmtHours = (min: number) => `${Math.round(min / 6) / 10}h`;

/** 월간 칸처럼 좁은 곳에 쓰는 시간 — 「10:00」→「10」, 「10:30」→「10:30」 */
export function compactTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return hhmm;
  return m[2] === "00" ? String(Number(m[1])) : `${Number(m[1])}:${m[2]}`;
}

/** 일간 시간축 — 기본 08~23시, 그날 일정이 그 밖이면 넓힌다 */
export function timeAxis(times: { startTime: string; endTime: string }[]): { fromH: number; toH: number } {
  let fromH = 8, toH = 23;
  for (const t of times) {
    const s = toMin(t.startTime), e = toMin(t.endTime);
    if (s != null) fromH = Math.min(fromH, Math.floor(s / 60));
    if (e != null) toH = Math.max(toH, Math.ceil(e / 60));
  }
  return { fromH: Math.max(0, fromH), toH: Math.min(24, Math.max(toH, fromH + 1)) };
}
