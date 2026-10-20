// 출퇴근 정책 (2026-09-07 디렉터 지시)
//
// 퇴근 가능 시각을 관리자가 정한다. 두 가지를 함께 저장한다:
//  · 사용 여부(체크) — 끄면 시각 제한이 없다
//  · 마감 시각("HH:mm", KST) — 이 시각을 넘으면 그날 퇴근을 찍을 수 없다
//
// 왜 필요한가: 종전에는 자정을 넘기면 퇴근이 **"출근 기록이 없습니다"** 로 막혔다.
// 퇴근할 때 그 순간의 날짜로 출근 기록을 찾는데 자정을 넘기면 날짜가 갈라지기 때문이다.
// 막히는 것 자체는 의도대로지만(디렉터 판단: 자정 넘기면 못 찍는 게 맞다), 메시지가
// 사실과 달라 직원이 무엇을 해야 할지 알 수 없었다. 이제 이유를 정확히 말한다.
import { prisma } from "@/lib/db";
import { hhmmToMin, calcStatus, workWindowFor, isEarlyLeaveAt } from "@/lib/attendance-status";
import { isHoliday } from "@/lib/holidays";

export const CLOCKOUT_LIMIT_KEY = "attendance.clockOutLimit";

/**
 * 평일 근무 상한 — 이 시간을 넘기면 직원이 앱에서 퇴근을 못 찍는다(주 52시간 방어).
 * 자동 마감(autoCloseTime)도 이 상한을 넘겨 적지 않는다 — 넘으면 `출근 + 상한` 으로 자른다.
 *
 * ⚠ 차단 기준과 자동 마감의 상한은 **반드시 같은 상수**여야 한다. 다르면 마감한 기록이
 *   여전히 상한을 넘어 있게 된다.
 *   (2026-10-16 #219-4 전: 「전일 미마감」은 언제나 출근 + 10.5시간으로 마감했다.)
 */
export const WEEKDAY_CAP_HOURS = 10.5;
export const WEEKDAY_CAP_MS = WEEKDAY_CAP_HOURS * 60 * 60 * 1000;

/**
 * 근무일정 없는 날의 보정 시간 (2026-09-07 디렉터 지시) — 관리자가 **30분 단위**로 정한다(기본 9시간).
 * 종전에는 9시간이 코드에 박혀 있어 바꾸려면 배포가 필요했다.
 *
 * 2026-10-16 #219-4 (디렉터 결정): 자동 마감·보정은 **그날 근무일정 시각**이 기준이다(autoCloseTime·autoOpenTime).
 * 이 값은 **근무일정이 없는 날**(또는 일정 시각을 쓸 수 없는 날)의 대체값으로만 쓴다:
 *   출근만 있으면 `출근 + 이 시간` 을 퇴근으로, 퇴근만 있으면 `퇴근 - 이 시간` 을 출근으로.
 */
export const AUTOFILL_HOURS_KEY = "attendance.autoFillHours";
export const DEFAULT_AUTOFILL_HOURS = 9;
/** 30분 단위, 4~12시간 */
export const AUTOFILL_HOUR_OPTIONS = [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12] as const;

export function isValidAutoFillHours(v: unknown): v is number {
  return typeof v === "number" && (AUTOFILL_HOUR_OPTIONS as readonly number[]).includes(v);
}

export async function readAutoFillHours(): Promise<number> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: AUTOFILL_HOURS_KEY } });
    const n = row?.value != null ? Number(row.value) : NaN;
    return isValidAutoFillHours(n) ? n : DEFAULT_AUTOFILL_HOURS;
  } catch {
    return DEFAULT_AUTOFILL_HOURS;
  }
}

export async function saveAutoFillHours(hours: number): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: AUTOFILL_HOURS_KEY },
    create: { key: AUTOFILL_HOURS_KEY, value: String(hours) },
    update: { value: String(hours) },
  });
}

// ─── 근태 규칙: 퇴근 기록이 없는 날 처리 (2026-10-20 본부 박정인 시안 v2 7번 · 디렉터 「추천대로」) ─────────
//
// 설정 › 「근태 규칙」에서 하나만 고른다. 아래 autoCloseTime 이 이 값을 읽으므로 대시보드 누락 보정·출퇴근 관리 전일 미마감·
// 직원 앱 「어제 퇴근 기록이 없어요」 본인 동의가 모두 같은 규칙을 쓴다(근로시간 리포트는 그렇게 마감된 기록을 센다).
//   FIXED_2200  — 22:00 퇴근(본부 안, 기본값). 다음 출근 때 본인이 동의하면 22:00 으로 기록, 22시가 아니면 보정 요청
//   SCHEDULE    — 그날 근무일정 퇴근 시각(없으면 출근 + 보정 시간) — 2026-10-17 디렉터 결정 방식
//   IN_10_5     — 출근 + 10시간 30분(평일 상한과 같은 시간)
//   IN_FALLBACK — 출근 + 보정 시간(환경설정, 기본 9시간)
// 어느 규칙이든 상한(평일 10.5시간 / 주말·공휴일 승인 근무 + 45분)과 퇴근 가능 시각·23:59 자르기는 그대로다.
export const MISSING_OUT_RULE_KEY = "attendance.missingOutRule";
export type MissingOutRule = "FIXED_2200" | "SCHEDULE" | "IN_10_5" | "IN_FALLBACK";
export const MISSING_OUT_RULES: readonly MissingOutRule[] = ["FIXED_2200", "SCHEDULE", "IN_10_5", "IN_FALLBACK"];
export const DEFAULT_MISSING_OUT_RULE: MissingOutRule = "FIXED_2200";
export const FIXED_CLOSE_HHMM = "22:00";

export function isMissingOutRule(v: unknown): v is MissingOutRule {
  return typeof v === "string" && (MISSING_OUT_RULES as readonly string[]).includes(v);
}

export async function readMissingOutRule(): Promise<MissingOutRule> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: MISSING_OUT_RULE_KEY } });
    return isMissingOutRule(row?.value) ? row!.value as MissingOutRule : DEFAULT_MISSING_OUT_RULE;
  } catch {
    return DEFAULT_MISSING_OUT_RULE;
  }
}

export async function saveMissingOutRule(rule: MissingOutRule): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: MISSING_OUT_RULE_KEY },
    create: { key: MISSING_OUT_RULE_KEY, value: rule },
    update: { value: rule },
  });
}

// ─── 자동 마감·보정 시각 — 단일 기준 (2026-10-16 #219-4, 디렉터 결정 · 10-17 보완 · 10-20 근태 규칙) ─────────
//
// 종전에는 기준이 셋이었다: 관리자 대시보드 누락 보정 = 설정 시간(9h, 화면 문구는 「9시간」 고정),
// 출퇴근 관리 「전일 미마감」 = 출근 + 10.5시간, 앱 「퇴근 기록이 없어요」 동의 = 22:00 고정. 셋 다 근무일정을 보지 않아,
// 13:00~22:00 일정 직원이 13:20 출근 후 퇴근을 못 찍으면 「23:50 퇴근」이 기록됐다 — 실제로 일하지 않은
// 밤 시간이 야간근로·49시간 경고·급여 자료에 들어간다(이예지 #219-4).
//
// 이제 네 곳(대시보드 누락 보정 api/attendance/[id]/auto-fill, 전일 미마감 api/admin/attendance/unclosed,
// 직원 본인 동의 api/attendance-requests/missed-out(+consent), 화면 안내 문구)이 모두 아래 함수 하나를 쓴다:
//   1) 그날 근무일정(WORK)의 퇴근 시각(endTime). 퇴근 시각 ≤ 출근 시각인 일정(22:00~06:00 같은 야간)은 다음 날로 본다.
//   2) 일정이 없거나, 일정 퇴근이 실제 출근보다 앞이면(늦게 와서 일정이 이미 끝난 경우 등) → 출근 + 보정 시간(기본 9시간).
//   3) 퇴근 상한(평일 10.5시간 / 주말·공휴일 승인 근무시간 + 45분, clock-out 과 같은 규칙)을 넘기면 상한으로 자른다.
//   4) 그날 퇴근 가능 시각(앱 퇴근 차단 readClockOutLimit, 켜져 있을 때)과 23:59 중 이른 시각을 넘기면 거기서 자른다
//      (10-17 디렉터 결정 — 기록 날짜를 넘기는 퇴근이 자동으로 생기지 않게, 앱 퇴근 차단을 우회하지 않게. 검증 F1).
// 3)·4) 로 잘리면 basis = "CAP" — 시스템이 자른 시각이라 「조퇴」로 판정하지 않는다(statusForAutoFill, 검증 F4).
// 출근이 빠진 기록(퇴근만 있음)은 거울처럼: 일정 출근 시각 → 없으면 퇴근 − 보정 시간 → 상한 → 그날 00:00 보다 앞이면 00:00(검증 P4).

export type AutoFillBasis = "SCHEDULE" | "FALLBACK" | "CAP" | "RULE";
export type AutoFillResult = {
  /** 채워 넣을 시각 */
  at: Date;
  /** SCHEDULE=근무일정 시각, FALLBACK=일정 없음(보정 시간), RULE=근태 규칙 고정값(22:00·출근+10.5h), CAP=상한·퇴근 가능 시각·날짜 경계로 자름 */
  basis: AutoFillBasis;
  /** 그날 근무일정 "HH:mm~HH:mm" (없으면 null) — 화면·감사 기록용 */
  schedule: string | null;
  /** 대체값에 쓴 보정 시간(시간) */
  fallbackHours: number;
  /** 사람이 읽는 기준 설명 — 화면·감사 기록에 그대로 쓴다 */
  label: string;
};

const HOUR_MS = 60 * 60 * 1000;

/** "YYYY-MM-DD"(KST) + "HH:mm" → 그 KST 시각 */
function kstAt(ymd: string, hhmm: string): Date {
  return new Date(`${ymd}T${hhmm.padStart(5, "0")}:00+09:00`);
}

type DaySched = { start: string | null; end: string | null; startMin: number | null; endMin: number | null };

async function workScheduleOf(userId: string, ymd: string): Promise<DaySched | null> {
  const row = await prisma.schedule.findFirst({
    where: { userId, date: new Date(`${ymd}T00:00:00Z`), type: "WORK" },   // @db.Date = UTC 자정
    select: { startTime: true, endTime: true },
  });
  if (!row) return null;
  const startMin = hhmmToMin(row.startTime), endMin = hhmmToMin(row.endTime);
  return {
    start: startMin != null ? row.startTime.trim() : null,
    end: endMin != null ? row.endTime.trim() : null,
    startMin, endMin,
  };
}

/** 그날 근무 상한(ms) — api/attendance/clock-out 의 차단 규칙과 같다 */
async function capMsOf(ymd: string, sched: DaySched | null): Promise<number> {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();   // ymd 는 KST 날짜 — UTC 자정으로 만들면 요일이 그대로
  if (dow === 0 || dow === 6 || (await isHoliday(ymd))) {
    if (sched?.startMin != null && sched.endMin != null) {
      const workMin = sched.endMin - sched.startMin;
      if (workMin > 0) return (workMin + 30 + 15) * 60 * 1000;   // 승인 근무시간 + 휴게 30분 + 조기출근 여유 15분
    }
  }
  return WEEKDAY_CAP_MS;
}

/** 그날 자동 퇴근의 마지막 시각 "HH:mm" — 퇴근 가능 시각(켜져 있을 때)과 23:59 중 이른 것 */
async function lastOutHhmm(): Promise<string> {
  const limit = await readClockOutLimit();
  const m = limit.enabled ? parseHhmm(limit.time) : null;
  return m != null && m < 23 * 60 + 59 ? limit.time.trim() : "23:59";   // 앞뒤 공백이 있으면 시각 계산이 조용히 꺼졌다(재검증 N4)
}

/** 분 → 「9시간」·「4시간 45분」·「30분」 (검증 F4 — 종전 「상한 4.8시간」) */
export function fmtHourMin(totalMin: number): string {
  const m = Math.round(totalMin);
  const h = Math.floor(m / 60), r = m % 60;
  return h && r ? `${h}시간 ${r}분` : h ? `${h}시간` : `${r}분`;
}
const fbText = (hours: number) => fmtHourMin(hours * 60);
const schedText = (s: DaySched | null) => (s?.start && s.end ? `${s.start}~${s.end}` : null);

/**
 * 퇴근이 빠진 기록의 자동 마감 시각(단일 기준). dateYmd = 근무일(KST, Attendance.date).
 * fallbackHours·lastOut 을 주면 설정을 다시 읽지 않는다(목록에서 여러 건을 계산할 때).
 */
export async function autoCloseTime(
  userId: string, dateYmd: string, clockIn: Date, opts: { fallbackHours?: number; lastOut?: string; rule?: MissingOutRule } = {},
): Promise<AutoFillResult> {
  const fallbackHours = opts.fallbackHours ?? (await readAutoFillHours());
  const rule = opts.rule ?? (await readMissingOutRule());
  const sched = await workScheduleOf(userId, dateYmd).catch(() => null);
  let at: Date | null = null;
  let basis: AutoFillBasis = "FALLBACK";
  let label = `근무일정 없음 → 출근 + ${fbText(fallbackHours)}`;
  if (rule === "FIXED_2200") {
    const fixed = kstAt(dateYmd, FIXED_CLOSE_HHMM);
    if (fixed.getTime() > clockIn.getTime()) {
      at = fixed; basis = "RULE"; label = `근태 규칙 ${FIXED_CLOSE_HHMM} 퇴근`;
    } else {
      label = `출근이 ${FIXED_CLOSE_HHMM} 이후 → 출근 + ${fbText(fallbackHours)}`;
    }
  } else if (rule === "IN_10_5") {
    at = new Date(clockIn.getTime() + WEEKDAY_CAP_MS); basis = "RULE"; label = `근태 규칙 출근 + ${fmtHourMin(WEEKDAY_CAP_HOURS * 60)}`;
  } else if (rule === "IN_FALLBACK") {
    // 규칙이 정한 시각이라 RULE(조퇴로 보지 않음 — 재검증 지적). 일정 없는 날의 대체값(FALLBACK)과 구분한다
    at = new Date(clockIn.getTime() + fallbackHours * HOUR_MS); basis = "RULE"; label = `근태 규칙 출근 + ${fbText(fallbackHours)}`;
  } else if (sched?.end) {
    let end = kstAt(dateYmd, sched.end);
    // 야간 일정(퇴근 ≤ 출근 시각, 예: 22:00~06:00)은 다음 날 퇴근이다
    if (sched.startMin != null && sched.endMin != null && sched.endMin <= sched.startMin) end = new Date(end.getTime() + 24 * HOUR_MS);
    if (end.getTime() > clockIn.getTime()) {
      at = end; basis = "SCHEDULE"; label = `근무일정 퇴근 ${sched.end}`;
    } else {
      label = `일정 퇴근(${sched.end})이 출근보다 앞 → 출근 + ${fbText(fallbackHours)}`;
    }
  }
  if (!at) at = new Date(clockIn.getTime() + fallbackHours * HOUR_MS);
  // 3) 근무 상한
  const capMs = await capMsOf(dateYmd, sched).catch(() => WEEKDAY_CAP_MS);
  if (at.getTime() - clockIn.getTime() > capMs) {
    at = new Date(clockIn.getTime() + capMs); basis = "CAP"; label = `${label} → 상한 ${fmtHourMin(capMs / 60000)}으로 자름`;
  }
  // 4) 퇴근 가능 시각·23:59 — 그 날을 넘기지 않는다. 출근이 그보다 늦으면 출근 시각(0분 — 통계에서 「확인 필요」)
  const lastOut = opts.lastOut ?? (await lastOutHhmm().catch(() => "23:59"));
  const lastAt = kstAt(dateYmd, lastOut);
  if (at.getTime() > lastAt.getTime()) {
    at = lastAt.getTime() > clockIn.getTime() ? lastAt : clockIn;
    basis = "CAP"; label = `${label} → 퇴근 가능 시각 ${lastOut}에서 자름`;
  }
  return { at, basis, schedule: schedText(sched), fallbackHours, label };
}

/** 출근이 빠진 기록(퇴근만 있음)의 자동 보정 출근 시각 — autoCloseTime 의 거울 */
export async function autoOpenTime(
  userId: string, dateYmd: string, clockOut: Date, opts: { fallbackHours?: number } = {},
): Promise<AutoFillResult> {
  const fallbackHours = opts.fallbackHours ?? (await readAutoFillHours());
  const sched = await workScheduleOf(userId, dateYmd).catch(() => null);
  let at: Date | null = null;
  let basis: AutoFillBasis = "FALLBACK";
  let label = `근무일정 없음 → 퇴근 − ${fbText(fallbackHours)}`;
  if (sched?.start) {
    const start = kstAt(dateYmd, sched.start);
    if (start.getTime() < clockOut.getTime()) {
      at = start; basis = "SCHEDULE"; label = `근무일정 출근 ${sched.start}`;
    } else {
      label = `일정 출근(${sched.start})이 퇴근보다 뒤 → 퇴근 − ${fbText(fallbackHours)}`;
    }
  }
  if (!at) at = new Date(clockOut.getTime() - fallbackHours * HOUR_MS);
  const capMs = await capMsOf(dateYmd, sched).catch(() => WEEKDAY_CAP_MS);
  if (clockOut.getTime() - at.getTime() > capMs) {
    at = new Date(clockOut.getTime() - capMs); basis = "CAP"; label = `${label} → 상한 ${fmtHourMin(capMs / 60000)}으로 자름`;
  }
  // 그 날 00:00 보다 앞으로 넘기지 않는다(검증 P4) — 전날 근무로 보이는 출근이 생기지 않게
  const dayStart = kstAt(dateYmd, "00:00");
  if (at.getTime() < dayStart.getTime()) {
    at = dayStart.getTime() < clockOut.getTime() ? dayStart : clockOut;
    basis = "CAP"; label = `${label} → 그날 00:00에서 자름`;
  }
  return { at, basis, schedule: schedText(sched), fallbackHours, label };
}

/** 목록에서 여러 건을 계산할 때 한 번만 읽는다 — autoCloseTime 의 opts 로 넘긴다 */
export async function autoFillSettings(): Promise<{ fallbackHours: number; lastOut: string; rule: MissingOutRule }> {
  return { fallbackHours: await readAutoFillHours(), lastOut: await lastOutHhmm().catch(() => "23:59"), rule: await readMissingOutRule() };
}

/**
 * 자동으로 채운 기록의 상태. 시스템이 잘라 넣은 시각(basis = CAP)·근태 규칙 고정 시각(RULE)으로는 판정하지 않는다(검증 F4):
 *  · 퇴근을 잘라 넣었으면 「조퇴」가 아니다(지각이었으면 지각은 그대로)
 *  · 출근을 잘라 넣었으면 「지각」이 아니다(조퇴 여부만 본다)
 */
export async function statusForAutoFill(
  clockIn: Date, clockOut: Date, dateYmd: string, userId: string, filled: "in" | "out", basis: AutoFillBasis,
): Promise<"NORMAL" | "LATE" | "EARLY_LEAVE"> {
  const status = await calcStatus(clockIn, clockOut, dateYmd, userId);
  // RULE(근태 규칙 고정 시각) 도 시스템이 정한 시각이라 CAP 과 같이 본다(2026-10-20 검증 — 22:00 규칙 + 23:00 일정이 「조퇴」로 찍혔다)
  if (basis !== "CAP" && basis !== "RULE") return status;
  if (filled === "out") return status === "EARLY_LEAVE" ? "NORMAL" : status;
  if (status !== "LATE") return status;
  const { endMin } = await workWindowFor(userId, dateYmd);
  return isEarlyLeaveAt(clockOut, endMin) ? "EARLY_LEAVE" : "NORMAL";   // calcStatus 가 LATE 면 공휴일이 아니다
}

export type ClockOutLimit = {
  /** 켜져 있을 때만 시각 제한이 걸린다 */
  enabled: boolean;
  /** "HH:mm" (KST). 이 시각을 **지나면** 퇴근 불가 */
  time: string;
};

/** 값이 없거나 깨졌을 때의 기본값 — 자정 직전까지 허용(= 자정 넘기면 못 찍는다) */
export const DEFAULT_CLOCKOUT_LIMIT: ClockOutLimit = { enabled: true, time: "23:59" };

/** "HH:mm" 형식인지 확인하고 분 단위 값으로. 아니면 null. */
export function parseHhmm(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export async function readClockOutLimit(): Promise<ClockOutLimit> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: CLOCKOUT_LIMIT_KEY } });
    if (!row?.value) return DEFAULT_CLOCKOUT_LIMIT;
    const v = JSON.parse(row.value) as Partial<ClockOutLimit>;
    const time = parseHhmm(v.time) != null ? (v.time as string) : DEFAULT_CLOCKOUT_LIMIT.time;
    return { enabled: v.enabled !== false, time };
  } catch {
    // ⚠ 읽기 실패를 "제한 없음"으로 흘리면 안 된다. 정책이 깨졌을 때 조용히 풀리는 쪽이
    //   더 나쁘다 — 기본값(자정 마감)으로 되돌아간다.
    return DEFAULT_CLOCKOUT_LIMIT;
  }
}

export async function saveClockOutLimit(v: ClockOutLimit): Promise<void> {
  const value = JSON.stringify({ enabled: !!v.enabled, time: v.time });
  await prisma.appSetting.upsert({
    where: { key: CLOCKOUT_LIMIT_KEY },
    create: { key: CLOCKOUT_LIMIT_KEY, value },
    update: { value },
  });
}
