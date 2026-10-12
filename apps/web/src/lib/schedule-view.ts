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

// ── 정렬·표시 항목·주 시작 요일(#73) — 사람마다 저장(/api/me/prefs, 키 schedule) ──
export type SortKey = "name" | "empNo" | "branch" | "jobGroup" | "hireDate";
export const SORT_KEYS: SortKey[] = ["name", "empNo", "branch", "jobGroup", "hireDate"];
export const SORT_LABEL: Record<SortKey, string> = { name: "이름", empNo: "사번", branch: "지점 → 이름", jobGroup: "직무 → 이름", hireDate: "입사일(오래된 순)" };
export type ShowKey = "empNo" | "subline" | "time" | "typeBadge" | "note" | "leave" | "total";
export const SHOW_KEYS: ShowKey[] = ["time", "typeBadge", "note", "leave", "empNo", "subline", "total"];
export const SHOW_LABEL: Record<ShowKey, string> = {
  time: "근무 시간", typeBadge: "유형(근무·휴무)", note: "메모", leave: "승인된 휴가", empNo: "사번", subline: "직무·지점", total: "합계 열(주·월)",
};
export const WEEK_START_OPTIONS: { value: WeekStart; label: string }[] = [{ value: 1, label: "월요일" }, { value: 0, label: "일요일" }, { value: 6, label: "토요일" }];
export type SchedulePrefs = { unit: ViewUnit; layout: ViewLayout; weekStart: WeekStart; sort: SortKey; show: Record<ShowKey, boolean> };
export const SCHEDULE_PREFS_DEFAULT: SchedulePrefs = {
  unit: "week", layout: "grid", weekStart: 1, sort: "name",
  show: { time: true, typeBadge: true, note: true, leave: true, empNo: true, subline: true, total: true },
};
/** 저장소에 뭐가 있어도 화면이 안 깨지게 — 모르는 값은 기본값으로 */
export function cleanSchedulePrefs(raw: unknown): SchedulePrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const show = (r.show && typeof r.show === "object" ? r.show : {}) as Record<string, unknown>;
  const ws = r.weekStart;
  return {
    unit: isViewUnit(r.unit) ? r.unit : SCHEDULE_PREFS_DEFAULT.unit,
    layout: isViewLayout(r.layout) ? r.layout : SCHEDULE_PREFS_DEFAULT.layout,
    weekStart: WEEK_START_OPTIONS.some((o) => o.value === ws) ? (ws as WeekStart) : SCHEDULE_PREFS_DEFAULT.weekStart,
    sort: SORT_KEYS.includes(r.sort as SortKey) ? (r.sort as SortKey) : SCHEDULE_PREFS_DEFAULT.sort,
    show: Object.fromEntries(SHOW_KEYS.map((k) => [k, typeof show[k] === "boolean" ? show[k] : SCHEDULE_PREFS_DEFAULT.show[k]])) as Record<ShowKey, boolean>,
  };
}

type Sortable = { name: string; empNo?: number | null; branch: string | null; jobGroup?: string | null; position?: string | null; hireDate?: string | null };
const ko_ = (a: string, b: string) => a.localeCompare(b, "ko");
/** 직원 정렬(#73). 값이 없는 사람은 뒤로, 같으면 이름순 */
export function sortEmployees<T extends Sortable>(list: T[], sort: SortKey): T[] {
  const byName = (a: T, b: T) => ko_(a.name, b.name);
  const nullsLast = (a: string | null | undefined, b: string | null | undefined) => (a ? 0 : 1) - (b ? 0 : 1);
  const cmp: Record<SortKey, (a: T, b: T) => number> = {
    name: byName,
    empNo: (a, b) => ((a.empNo ?? Number.MAX_SAFE_INTEGER) - (b.empNo ?? Number.MAX_SAFE_INTEGER)) || byName(a, b),
    branch: (a, b) => nullsLast(a.branch, b.branch) || ko_(a.branch ?? "", b.branch ?? "") || byName(a, b),
    jobGroup: (a, b) => nullsLast(a.jobGroup || a.position, b.jobGroup || b.position) || ko_(a.jobGroup || a.position || "", b.jobGroup || b.position || "") || byName(a, b),
    hireDate: (a, b) => nullsLast(a.hireDate, b.hireDate) || (a.hireDate ?? "").localeCompare(b.hireDate ?? "") || byName(a, b),
  };
  return [...list].sort(cmp[sort]);
}

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
