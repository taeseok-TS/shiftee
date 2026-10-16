// 연차 발생 계산 — 회계연도(1/1) 기준과 입사일 기준(2026-10-16 이예지 QA #31·#57~#60, 포털 「퇴사자 연차수당 계산」 계산식 그대로).
// 순수 함수만 둔다(DB 없음) — 화면·서버·시험이 같이 쓴다. 날짜는 모두 "YYYY-MM-DD"(KST 달력 날짜) 문자열.
//
// 회계연도 기준(재직자, 큐브티 연차의 단일 기준 — 「다른 계산 옵션을 두지 말 것」):
//  - 월차: 입사일부터 만 1개월이 될 때마다 1일, 최대 11일(그 날짜에 발생)
//  - 첫 부여: 입사 1주년이 속한 해의 1/1 에 비례분 = 15 × (그해 12/31 − 1주년일 + 1) ÷ 365, 소수 첫째 자리 반올림
//  - 그다음 해부터 매년 1/1: 15 + 내림((N − 1) ÷ 2), 최대 25. N = 그해 1/1 기준 만 근속연수(최소 1)
//  - 1년 미만자는 해가 바뀌어도 15일을 미리 넣지 않는다(월차만 쌓인다)
// 입사일 기준(퇴사자 정산에만): 월차(최대 11) + 입사기념일마다 15 + 내림((k − 1) ÷ 2)일(k = 근속 k년째, 최대 25)
// 정산(소수 둘째 자리, 올림 없음):
//  - 재직자 연차수당 일수 = 그해 회계 기준 발생 − 그해 사용
//  - 퇴사자 정산 일수 = 입사일 기준 총 발생 − 회계 기준 전년도까지 누적 발생 − 당해 사용

export type AccrualKind = "월차" | "첫 부여(비례)" | "정기 부여";
export type AccrualEvent = { date: string; days: number; kind: AccrualKind; note: string };

const MAX_MONTHLY = 11;
const MAX_ANNUAL = 25;

function parse(d: string): { y: number; m: number; day: number } {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day };
}
function fmt(y: number, m: number, day: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** n 개월 뒤 같은 날(없는 날이면 그달 말일 — 1/31 입사 → 2/28) */
export function addMonthsDate(d: string, n: number): string {
  const { y, m, day } = parse(d);
  const t = (m - 1) + n;
  const ny = y + Math.floor(t / 12), nm = (t % 12 + 12) % 12 + 1;
  return fmt(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}
function dayNumber(d: string): number {
  const { y, m, day } = parse(d);
  return Math.round(Date.UTC(y, m - 1, day) / 86400000);
}
/** 만 근속연수(그 날짜 기준, 내림) */
export function fullYears(hire: string, asOf: string): number {
  const h = parse(hire), a = parse(asOf);
  let n = a.y - h.y;
  if (a.m < h.m || (a.m === h.m && a.day < h.day)) n -= 1;
  return Math.max(0, n);
}
/** 소수 자리 반올림(부동소수 오차 보정) */
export function roundTo(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round((v + Number.EPSILON) * f) / f;
}
/** 정기 부여 일수 — 근속 n년째(n ≥ 1) */
export function annualGrantDays(n: number): number {
  return Math.min(MAX_ANNUAL, 15 + Math.floor((Math.max(1, n) - 1) / 2));
}

/** 월차 발생 날짜들(최대 11개) — upTo 이하만 */
export function monthlyEvents(hire: string, upTo: string): AccrualEvent[] {
  const out: AccrualEvent[] = [];
  for (let k = 1; k <= MAX_MONTHLY; k++) {
    const date = addMonthsDate(hire, k);
    if (date > upTo) break;
    out.push({ date, days: 1, kind: "월차", note: `입사 ${k}개월` });
  }
  return out;
}

/** 회계연도 기준 발생 내역 — upTo 이하에 발생한 것 전부(오래된 순) */
export function fiscalEvents(hire: string, upTo: string): AccrualEvent[] {
  const ev = monthlyEvents(hire, upTo);
  const anniv1 = addMonthsDate(hire, 12);
  const y1 = parse(anniv1).y;
  const first = fmt(y1, 1, 1);
  if (first <= upTo) {
    const span = dayNumber(fmt(y1, 12, 31)) - dayNumber(anniv1) + 1;
    const days = roundTo((15 * span) / 365, 1);
    ev.push({ date: first, days, kind: "첫 부여(비례)", note: `15 × ${span}일 ÷ 365 (1주년 ${anniv1})` });
  }
  for (let y = y1 + 1; fmt(y, 1, 1) <= upTo; y++) {
    const jan1 = fmt(y, 1, 1);
    const n = Math.max(1, fullYears(hire, jan1));
    ev.push({ date: jan1, days: annualGrantDays(n), kind: "정기 부여", note: `${y}-01-01 기준 근속 ${n}년` });
  }
  return ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 그해(회계연도) 발생 — asOf 까지 발생한 것만(월차는 날짜가 와야 생긴다) */
export function fiscalYearAccrued(hire: string, year: number, asOf: string): { days: number; events: AccrualEvent[] } {
  const upTo = asOf < fmt(year, 12, 31) ? asOf : fmt(year, 12, 31);
  const events = fiscalEvents(hire, upTo).filter((e) => parse(e.date).y === year);
  return { days: roundTo(events.reduce((s, e) => s + e.days, 0), 2), events };
}

/** 회계연도 기준 누적 발생 — upTo 까지 전부 */
export function fiscalCumulative(hire: string, upTo: string): number {
  return roundTo(fiscalEvents(hire, upTo).reduce((s, e) => s + e.days, 0), 2);
}

/** 입사일 기준 발생 내역 — 월차 + 입사기념일마다 정기 부여 */
export function hireBasisEvents(hire: string, upTo: string): AccrualEvent[] {
  const ev = monthlyEvents(hire, upTo);
  for (let k = 1; ; k++) {
    const date = addMonthsDate(hire, 12 * k);
    if (date > upTo) break;
    ev.push({ date, days: annualGrantDays(k), kind: "정기 부여", note: `입사 ${k}주년` });
  }
  return ev;
}
export function hireBasisTotal(hire: string, upTo: string): number {
  return roundTo(hireBasisEvents(hire, upTo).reduce((s, e) => s + e.days, 0), 2);
}

/** 사용 일수 = 휴가 시간 ÷ 8, 소수 둘째 자리 반올림 */
export function usedDaysFromHours(hours: number): number {
  return roundTo(hours / 8, 2);
}

/** 재직자 연차수당 정산 일수 = 그해 회계 기준 발생 − 그해 사용(소수 둘째 자리) */
export function activeSettlementDays(hire: string, year: number, usedThisYear: number, asOf: string): number {
  return roundTo(fiscalYearAccrued(hire, year, asOf).days - usedThisYear, 2);
}

/** 퇴사자 정산 일수 = 입사일 기준 총 발생 − 회계 기준 전년도까지 누적 − 당해 사용(소수 둘째 자리) */
export function resignSettlement(hire: string, resign: string, usedThisYear: number): {
  hireBasis: number; fiscalBeforeYear: number; used: number; days: number;
} {
  const y = parse(resign).y;
  const hireBasis = hireBasisTotal(hire, resign);
  const fiscalBeforeYear = fiscalCumulative(hire, fmt(y - 1, 12, 31));
  return { hireBasis, fiscalBeforeYear, used: usedThisYear, days: roundTo(hireBasis - fiscalBeforeYear - usedThisYear, 2) };
}

/** Date(@db 날짜·UTC 자정 또는 KST 자정 저장 모두) → KST 달력 날짜 */
export function kstDate(d: Date | string): string {
  return new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 오늘 날짜(KST) */
export function kstToday(): string {
  return kstDate(new Date());
}

/** 그해 연차 행 기준일 — 올해 = 오늘, 내년(12월에 미리 만드는 행) = 1/1, 지난해 = 12/31. 퇴사일이 더 이르면 퇴사일(그 뒤 발생 없음) */
export function accrualAsOf(year: number, today: string = kstToday(), resign?: string | null): string {
  const y = Number(today.slice(0, 4));
  let asOf = year > y ? `${year}-01-01` : year < y ? `${year}-12-31` : today;
  if (resign && resign < asOf) asOf = resign;
  return asOf;
}

/**
 * 그해 연차 행의 총연차로 쓸 값 — 회계연도 기준 「그 기준일까지 발생한 것」(accrualAsOf).
 * 행을 만들거나 다시 맞추는 곳과 매시 자동 맞춤(lib/leave-accrual-run)이 같은 값을 쓴다 — 자동으로 들어간 몫은 행의 accruedAuto 에 남겨
 * 차이만 더하므로 몇 번을 돌려도 같다(본부가 손으로 맞춘 몫은 그대로 남는다).
 */
export function yearTotalAsOf(hire: string, year: number, today: string = kstToday(), resign?: string | null): number {
  return fiscalYearAccrued(hire, year, accrualAsOf(year, today, resign)).days;
}

/** 화면용 산정 근거 한 줄 — 예) 「첫 부여(비례) 13.1일(…) + 월차 1일 = 14.1일 · 연말까지 14.1일 예정」 */
export function accrualBasisText(hire: string, year: number, today: string = kstToday(), resign?: string | null): string {
  const now = fiscalYearAccrued(hire, year, accrualAsOf(year, today, resign));
  const end = fiscalYearAccrued(hire, year, resign && resign < `${year}-12-31` ? resign : `${year}-12-31`);
  const parts: string[] = [];
  const monthly = now.events.filter((e) => e.kind === "월차").length;
  for (const e of now.events) if (e.kind !== "월차") parts.push(`${e.kind} ${e.days}일(${e.note})`);
  if (monthly) parts.push(`월차 ${monthly}일`);
  const head = parts.length ? `${parts.join(" + ")} = ${now.days}일` : `${year}년 발생 없음`;
  const tail = resign && resign <= `${year}-12-31` ? ` (퇴사일 ${resign}까지)` : "";
  return (end.days !== now.days ? `${head} · 연말까지 ${end.days}일 예정` : head) + tail;
}
