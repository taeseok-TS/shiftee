import { isAllowed } from "@/lib/permission-settings";

// ─── 출퇴근 시각 · 근무시간은 본부만(2026-10-23 본부 요청 ■0-11, 디렉터 결정) ─────────────────
// 직원 · 원장에게 가는 응답에는 출퇴근 **상태**만 싣는다(출근 · 지각 · 퇴근 · 퇴근 누락 · 미출근 · 휴가).
// 찍은 시각 · 일한 시간 · 주 근무시간 숫자는 본부(ADMIN)에게만. 기록 자체는 그대로 남긴다(지우거나 덜 남기지 않는다).
//  · 원장은 권한 설정 「출퇴근 시각 보기」(manager.viewClockTimes, 기본 끔)를 켜면 예전처럼 시각 · 일한 시간을 본다
//    (근로시간 리포트는 켜도 본부만). 「지점 출퇴근 기록 열람」(manager.viewAttendance)은 상태를 볼지, 이 설정은 시각까지 볼지.
//  · 직원은 늘 상태만(본인 것도). 「본인 출퇴근 기록 열람(웹)」은 웹 「내 출퇴근」 메뉴 · 화면을 열어 줄지만 정한다 —
//    앱(출퇴근 화면 · 지난 기록 · 일정)은 꺼져 있어도 본인 상태를 받는다(■0-11 「날짜별 상태 알약」, 시각은 늘 빠지므로).
// 시각을 뺀 응답은 시각 칸을 null 로 두고 clockedIn · clockedOut(= hasClockIn · hasClockOut, 찍었는지)과 timesHidden: true 를 함께 준다 —
// 시각이 있는지로 출근 여부를 가리던 화면이 「출근 전」으로 잘못 읽지 않게.

/** 이 역할에게 출퇴근 찍은 시각 · 일한 시간 · 주 근무시간 숫자를 보여도 되나 */
export async function canSeeClockTimes(role: string | null | undefined): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role === "MANAGER") return isAllowed("manager.viewClockTimes");
  return false;
}

/**
 * 장소 글자에서 시각을 지운다(10/23 검증 B) — 퇴근 누락 본인 동의는 장소에 「22:00 퇴근 처리(…) · 본인 동의 2026-10-23 22:05」를 남긴다.
 * 시각을 숨기는 응답에는 「퇴근 처리(…) · 본인 동의」만. 날짜+시각 · 시각(HH:MM, H시 MM분) 모양을 지운다.
 * 시각 범위(「13:00~22:00」 「9시–18시」)는 사이 기호까지 한 번에 지운다. 「10시간 30분」 같은 길이는 시각이 아니라 그대로 둔다(10/23 검증 M1).
 */
const HHMM = String.raw`(?:(?:오전|오후)\s*)?(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)`;
const HSI = String.raw`(?:(?:오전|오후)\s*)?(?<!\d)\d{1,2}\s*시(?!간)(?:\s*\d{1,2}\s*분)?`;
const ONE_TIME = `(?:${HHMM}|${HSI})`;
const DATE_TIME_RE = new RegExp(String.raw`\d{4}-\d{2}-\d{2}[ T]` + `${ONE_TIME}(?:` + String.raw`\s*[~–-]\s*` + `${ONE_TIME})?`, "g");
const MD_TIME_RE = new RegExp(String.raw`(?<!\d)\d{1,2}/\d{1,2}\s*` + `${ONE_TIME}(?:` + String.raw`\s*[~–-]\s*` + `${ONE_TIME})?`, "g");
const TIME_RANGE_RE = new RegExp(`${ONE_TIME}` + String.raw`\s*[~–-]\s*` + `${ONE_TIME}`, "g");
const ONE_TIME_RE = new RegExp(ONE_TIME, "g");
export function placeWithoutTime(place: string | null | undefined): string | null {
  if (place == null) return null;
  // 지점 밖 사유는 직원이 쓴 자유 글이라 시각을 다 못 긁는다 — 종류 문구만 남긴다(10/23 재검증 3, lib/attendance-request placeLabel)
  const outside = /^지점 밖 · .* \(([^()]*)\)$/.exec(String(place));
  if (outside) return `지점 밖 (${outside[1]})`;
  const s = String(place)
    .replace(DATE_TIME_RE, "")
    .replace(MD_TIME_RE, "")
    .replace(TIME_RANGE_RE, "")
    .replace(ONE_TIME_RE, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s·,]+|[\s·,]+$/g, "")
    .trim();
  return s || null;
}

/** 시각이 든 칼럼 — 시각을 숨길 때 null 로 바꾼다(createdAt = 출근 누른 시각 · updatedAt = 퇴근 누른 시각, 10/23 검증 A) */
const TIME_KEYS = ["clockIn", "clockOut", "createdAt", "updatedAt", "requestedAt", "decidedAt"] as const;
/** 시각이 글자로 들어갈 수 있는 칼럼 — 시각 부분만 지운다 */
const PLACE_KEYS = ["clockInPlace", "clockOutPlace", "inPlace", "outPlace"] as const;
/** 통째로 빼는 칼럼 — 고친 이력(전 · 후 시각이 든다) */
const DROP_KEYS = ["edits"] as const;

/** 출퇴근 기록 한 줄에서 시각을 뺀다(찍었는지는 남긴다). show=true 면 그대로 */
/** clockedIn · clockedOut 과 같은 값을 hasClockIn · hasClockOut 이름으로도 싣는다(앱이 읽는 이름, 10/23 앱 작업분) */
export function maskClock<T extends { clockIn?: unknown; clockOut?: unknown }>(row: T, show: boolean): T & { clockedIn: boolean; clockedOut: boolean; hasClockIn: boolean; hasClockOut: boolean } {
  const clockedIn = row.clockIn != null && row.clockIn !== "";
  const clockedOut = row.clockOut != null && row.clockOut !== "";
  const flags = { clockedIn, clockedOut, hasClockIn: clockedIn, hasClockOut: clockedOut };
  if (show) return { ...row, ...flags };
  // 있는 칼럼만 손댄다(없는 칼럼을 새로 만들지 않는다)
  const out: Record<string, unknown> = { ...row };
  for (const k of TIME_KEYS) if (k in out) out[k] = null;
  for (const k of PLACE_KEYS) if (k in out) out[k] = placeWithoutTime(out[k] as string | null);
  for (const k of DROP_KEYS) if (k in out) delete out[k];
  return { ...(out as T), ...flags };
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
/** @db.Date(UTC 자정) 또는 "YYYY-MM-DD" → 「10월 23일 (금)」 */
export function dayLabel(d: Date | string): string {
  const ymd = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const [y, m, day] = ymd.split("-").map(Number);
  return `${m}월 ${day}일 (${WEEK[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]})`;
}
