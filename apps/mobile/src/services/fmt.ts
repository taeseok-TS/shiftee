// 날짜 · 색 공통 규칙(2026-10-23 본부 요청 ■4) — 카드 「10월 31일 (토)」, 좁은 칸 「10/31 (토)」, 해가 바뀌는 기간만 연도.
// 한 주 = 월~일. 토 · 일은 회색 글자(빨강 · 파랑 아님). 대기 = 주황 알약, 실행 = 인디고, 초록은 쓰지 않는다.

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export const C = {
  ind: "#4f46e5", indBg: "#eef2ff", indBd: "#c7d2fe", indInk: "#3730a3",
  amb: "#b45309", ambBg: "#fffbeb", ambBd: "#fde68a",
  red: "#be123c", redBg: "#fff1f2", redBd: "#fecdd3",
  blue: "#1d4ed8", blueInk: "#1e40af", blueBg: "#dbeafe",
  vio: "#5b21b6", vioBg: "#ede9fe",
  gray: "#475569", grayBg: "#f1f5f9",
  ink: "#0f172a", sub: "#475569", muted: "#64748b", line: "#e2e8f0", bg: "#f1f4f9",
  weekend: "#64748b",
};

/** "YYYY-MM-DD…"(ISO 포함) → "YYYY-MM-DD". @db.Date 는 UTC 자정으로 와서 앞 10글자가 그 날짜다 */
export const ymd = (v: string | Date | null | undefined): string => {
  if (!v) return "";
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
};
export const dateOfYmd = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const addDaysYmd = (s: string, n: number) => { const d = dateOfYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const todayYmd = () => ymd(new Date());
/** 그 날짜가 든 주(월~일) */
export const weekOfYmd = (s: string) => { const d = dateOfYmd(s); const back = (d.getDay() + 6) % 7; const start = addDaysYmd(s, -back); return { start, end: addDaysYmd(start, 6) }; };
export const dowOf = (s: string) => dateOfYmd(s).getDay();
export const isWeekend = (s: string) => { const w = dowOf(s); return w === 0 || w === 6; };
export const wd = (s: string) => WEEKDAYS[dowOf(s)];

/** 「10월 31일 (토)」 — withYear 면 앞에 「2026년 」 */
export const fmtDay = (s: string, withYear = false) => {
  const d = dateOfYmd(s);
  return `${withYear ? `${d.getFullYear()}년 ` : ""}${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
};
/** 좁은 칸 「10/31 (토)」 */
export const fmtShort = (s: string) => { const d = dateOfYmd(s); return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`; };

/** 기간 — 하루면 「10월 31일 (토)」, 같은 달 「10월 5일 (월) ~ 7일 (수)」, 같은 해 「10월 26일 (월) ~ 11월 30일 (월)」,
 *  해가 바뀌면 「2026년 8월 4일 (화) ~ 2027년 6월 30일 (수)」 */
export const fmtRange = (start: string, end?: string | null) => {
  const a = ymd(start), b = ymd(end || start);
  if (!b || a === b) return fmtDay(a);
  const da = dateOfYmd(a), db = dateOfYmd(b);
  if (da.getFullYear() !== db.getFullYear()) return `${fmtDay(a, true)} ~ ${fmtDay(b, true)}`;
  if (da.getMonth() === db.getMonth()) return `${fmtDay(a)} ~ ${db.getDate()}일 (${WEEKDAYS[db.getDay()]})`;
  return `${fmtDay(a)} ~ ${fmtDay(b)}`;
};

/** 시간 「13:00–22:00」 */
export const fmtTime = (s?: string | null, e?: string | null) => (s && e ? `${s}–${e}` : s || "");

/** 근무 시간 종류 이름에서 시간 괄호를 뺀다 — 「학기중(13:00~22:00) (13:00~22:00)」처럼 두 번 붙어 저장된 이름이 있다 */
export const stripTimes = (name?: string | null) =>
  String(name || "").replace(/\s*\(\s*\d{1,2}:\d{2}\s*[~\-–]\s*\d{1,2}:\d{2}\s*\)/g, "").replace(/직접설정/g, "직접 입력").trim();
