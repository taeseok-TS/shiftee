// 루트코스 기수 일정표 — 신규입사 근로계약서의 교육평가 기간 기준(2026-10-21 이예지 대리 확인, 근로계약서 제3조 ①1·2호·제8조 ④⑤).
//  · 교육평가 = 입과일(= 입사일) ~ 그 기수의 루트코스 **수료일(일정표 값)** — 「입과일 + 17일」 고정 계산은 공휴일이 끼면 하루씩 밀린다(208·210·211기)
//  · 실무평가 = 수료일 다음 날 ~ 입사일 + 3개월 − 1일(3개월 뒤 달에 같은 날이 없으면 그 달 말일 — 8/31 입사 → 11/30)
//  · 일정표에 없는 입과일은 자동으로 채우지 않는다 — 빈칸(빨간 줄)으로 두어 본부가 직접 넣는다
// 일정표는 AppSetting(routeCourse.schedule) 하나 — 본부가 「루트코스 일정」 화면에서 다음 해 기수를 더한다. 저장된 값이 없으면 아래 2026 확정 일정.
// 화면(작성 폼)과 서버가 함께 쓰는 순수 모듈이다(서버 전용 코드를 넣지 말 것).

export type Cohort = { no: string; start: string; end: string };
export const ROUTE_COURSE_KEY = "routeCourse.schedule";

/** 2026 확정 일정(이예지 대리 10/21 팀즈) */
export const DEFAULT_COHORTS: Cohort[] = [
  { no: "204", start: "2026-01-05", end: "2026-01-22" },
  { no: "205", start: "2026-01-27", end: "2026-02-13" },
  { no: "206", start: "2026-03-09", end: "2026-03-26" },
  { no: "207", start: "2026-04-06", end: "2026-04-23" },
  { no: "208", start: "2026-05-11", end: "2026-05-29" },
  { no: "209", start: "2026-06-08", end: "2026-06-25" },
  { no: "210", start: "2026-07-06", end: "2026-07-24" },
  { no: "211", start: "2026-08-03", end: "2026-08-21" },
  { no: "212", start: "2026-08-31", end: "2026-09-17" },
  { no: "213", start: "2026-10-12", end: "2026-10-29" },
  { no: "214", start: "2026-11-09", end: "2026-11-26" },
  { no: "215", start: "2026-12-07", end: "2026-12-24" },
];

const fmt = (d: Date) => d.toISOString().slice(0, 10);
/** 달력에 있는 날짜(YYYY-MM-DD)인가 */
export function isRealDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && fmt(d) === v;
}

/** 저장값 → 일정표. 모양이 틀린 줄은 버리고, 입과일 순으로, 같은 입과일은 하나만. 수료일은 입과일과 같거나 뒤, 60일 안 */
export function parseCohorts(raw: unknown): Cohort[] {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  const out: Cohort[] = [];
  const seen = new Set<string>();
  for (const x of v.slice(0, 300)) {
    if (!x || typeof x !== "object") continue;
    const { no, start, end } = x as Record<string, unknown>;
    const n = typeof no === "string" || typeof no === "number" ? String(no).trim().slice(0, 12) : "";
    if (!n || !isRealDate(start) || !isRealDate(end) || end < start || seen.has(start)) continue;
    if ((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 > 60) continue;
    seen.add(start);
    out.push({ no: n, start, end });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** 그 입과일의 기수(없으면 null) */
export const cohortOf = (start: string, cohorts: Cohort[]) => cohorts.find((c) => c.start === start) ?? null;

/** 입사일 + 3개월 − 1일(3개월 뒤 달에 같은 날이 없으면 그 달 말일) */
export function practiceEnd(start: string): string | null {
  if (!isRealDate(start)) return null;
  const [y, m, day] = start.split("-").map(Number);
  const lastOfTarget = new Date(Date.UTC(y, m - 1 + 3 + 1, 0)).getUTCDate();
  const p3 = day > lastOfTarget ? new Date(Date.UTC(y, m - 1 + 3, lastOfTarget)) : new Date(Date.UTC(y, m - 1 + 3, day - 1));
  return fmt(p3);
}

/** 교육·실무평가 날짜 — 일정표에 그 입과일이 없으면 null(자동으로 채우지 않는다) */
export function evalPeriodsFor(start: string, cohorts: Cohort[]): Record<"교육평가시작" | "교육평가종료" | "실무평가시작" | "실무평가종료", string> | null {
  if (!isRealDate(start)) return null;
  const c = cohortOf(start, cohorts);
  const pEnd = practiceEnd(start);
  if (!c || !pEnd) return null;
  const next = new Date(`${c.end}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { 교육평가시작: start, 교육평가종료: c.end, 실무평가시작: fmt(next), 실무평가종료: pEnd };
}
