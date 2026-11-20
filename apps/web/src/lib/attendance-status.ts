import { kstHour, kstMinute } from "@/lib/kst";
import { isHoliday } from "@/lib/holidays";
import { prisma } from "@/lib/db";
import { breakHours } from "@/lib/schedule-payload";

// 출퇴근 상태 판정 — 한국시간 기준.
// 우선순위: LATE > EARLY_LEAVE (지각+조퇴면 LATE).
// dateYmd("YYYY-MM-DD")가 공휴일이면 지각/조퇴 판정을 하지 않는다 (공휴일 정책).
//
// ⚠ 기준 시각은 **본인이 승인받은 근무일정(Schedule)** 을 따른다 (2026-09-07 디렉터 지시).
//   종전에는 09:00/18:00 이 하드코딩이라, 오후 1시 출근이 정상인 근무자(승인 템플릿에
//   `1-10 (1PM-10PM)` 이 실제로 있다)가 **매일 지각으로 찍혔다.** 실측으로 40건 중
//   정상이 3건뿐이었다 — 그 상태의 근태 통계는 읽을 가치가 없다.
//
// ⚠ 근무일정이 없는 날은 **지각·조퇴를 판정하지 않는다** (2026-10-16 #219-2, 본부 10/7 답변 12번
//   「일정 없는 평일 출근은 출근으로 인정, 지각 판정 안 함」). 종전에는 09:00/18:00 기본값으로
//   판정해 일정 없는 날 17:05 출근이 「지각」으로 찍혔다. 기준이 없으면 판정도 없다 → 「정상」.
//   시각 형식이 깨진 일정도 그쪽 판정만 건너뛴다(엉뚱한 기본값으로 지각을 만들지 않는다).
//   ※ 이미 LATE 로 저장된 과거 기록은 다시 계산하지 않는다(관리자가 그 기록을 수정·보정하면 이 규칙으로 다시 매겨진다).

/** "HH:mm" → 분. 형식이 아니면 null(=그쪽은 판정하지 않는다). */
export function hhmmToMin(v: string | null | undefined): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export type WorkWindow = {
  /** 그날 승인된 근무일정(WORK)이 있는가 */
  hasSchedule: boolean;
  /** 근무 시작(분, KST). 일정이 없거나 형식이 깨졌으면 null — 지각 판정 안 함 */
  startMin: number | null;
  /** 근무 종료(분, KST). 일정이 없거나 형식이 깨졌으면 null — 조퇴 판정 안 함 */
  endMin: number | null;
};

const NO_WINDOW: WorkWindow = { hasSchedule: false, startMin: null, endMin: null };

/** 그날 그 사람의 근무 시작·종료 시각(분). 승인된 근무일정(WORK)이 있으면 그것, 없으면 null(판정 안 함). */
export async function workWindowFor(userId: string, dateYmd: string): Promise<WorkWindow> {
  try {
    // Schedule.date 는 @db.Date — clock-in 과 같은 규칙으로 UTC 자정을 만든다.
    const [y, m, d] = dateYmd.split("-").map(Number);
    const sched = await prisma.schedule.findFirst({
      where: { userId, date: new Date(Date.UTC(y, m - 1, d)), type: "WORK" },
      select: { startTime: true, endTime: true },
    });
    if (!sched) return NO_WINDOW;
    return { hasSchedule: true, startMin: hhmmToMin(sched.startTime), endMin: hhmmToMin(sched.endTime) };
  } catch {
    // 조회가 깨져도 판정 자체가 죽으면 안 된다 — 판정 없이(정상) 간다.
    return NO_WINDOW;
  }
}

/** 출근 시각이 지각인가 — 시작 기준이 없으면(일정 없음) 지각이 아니다 */
export function isLateAt(clockIn: Date | null, startMin: number | null): boolean {
  return !!clockIn && startMin != null && kstHour(clockIn) * 60 + kstMinute(clockIn) > startMin;
}

/** 퇴근 시각이 조퇴인가 — 종료 기준이 없으면(일정 없음) 조퇴가 아니다 */
export function isEarlyLeaveAt(clockOut: Date | null, endMin: number | null): boolean {
  return !!clockOut && endMin != null && kstHour(clockOut) * 60 + kstMinute(clockOut) < endMin;
}

// 오전 반차 · 오전 반반차(승인)가 있는 날은 출근 기준 시각을 늦춰 지각을 판정한다(2026-11-20 개선 제안 #247 동탄 안효섭
// 「오전 반차 출근이 지각으로 뜬다 — 반차 출근으로」, 디렉터 「반영해 주자」 · 「17:30(휴게 30분)으로 정해 놓자」).
//  · 기준 = 퇴근 시각 − (남은 근무 + 휴게 30분). 남은 근무 = 그날 근무일정의 실근무(휴게 뺀) − 휴가 시간(반차 4 · 반반차 2).
//    13:00~22:00 → 오전 반차 17:30 · 오전 반반차 15:30, 09:00~18:00 → 오전 반차 13:30(고용노동부 예시와 같다).
//  · 휴게 30분은 근로기준법 54조(4시간 근무 30분 이상)를 지키는 회사 기준 — 남은 근무가 4시간 미만이면 휴게를 넣지 않는다.
//  · 조퇴 판정은 그대로. 시간 단위가 없는 보상 · 대체휴일(반차)은 오전 · 오후를 몰라 넣지 않는다.
export const AM_LEAVE_TYPES = ["HALF_AM", "QUARTER_AM"] as const;
const AM_LEAVE_MIN: Record<string, number> = { HALF_AM: 240, QUARTER_AM: 120 };
const AM_LEAVE_BREAK_MIN = 30;
const ymdToDate = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };

/** 그날 승인된 오전 반차 · 반반차 종류(없으면 null) — 조회가 깨지면 null(종전처럼 판정) */
export async function amLeaveOn(userId: string, dateYmd: string): Promise<string | null> {
  try {
    const d = ymdToDate(dateYmd);
    const l = await prisma.leaveRequest.findFirst({
      where: { userId, status: "APPROVED", type: { in: [...AM_LEAVE_TYPES] }, startDate: { lte: d }, endDate: { gte: d } },
      select: { type: true },
    });
    return l?.type ?? null;
  } catch { return null; }
}

/** 지각 기준 시각(분) — 오전 반차 · 반반차(승인) 날은 늦춘 기준(위 설명), 아니면 근무일정 시작. 기준을 알 수 없으면 null(판정 안 함) */
export async function lateBaseMin(userId: string, dateYmd: string, win: WorkWindow): Promise<number | null> {
  if (win.startMin == null) return null;
  const type = await amLeaveOn(userId, dateYmd);
  if (!type) return win.startMin;
  if (win.endMin == null || win.endMin <= win.startMin) return null;   // 퇴근 시각을 모르거나 자정을 넘는 일정 — 판정하지 않는다
  const span = win.endMin - win.startMin;
  const fullWork = span - Math.round(breakHours(span / 60) * 60);
  const leaveMin = AM_LEAVE_MIN[type] ?? 0;
  // 원장이 그날 근무일정을 이미 반차만큼 줄여 두었으면(예: 17:00~22:00 · 17:30~22:00 · 13:00~18:00) 그 시작이 기준 — 반차를 두 번 빼지 않는다.
  // 휴게 1시간까지 그대로 남겨 시작만 미룬 일정도 줄인 일정으로 본다(검증: 휴게를 뺀 시간으로만 비교하면 17:00~22:00 을 못 알아봐 기준이 21:30 이 됐다)
  if (span <= 480 - leaveMin + 60) return win.startMin;
  const work = Math.max(fullWork - leaveMin, 0);
  const brk = work >= 240 ? AM_LEAVE_BREAK_MIN : 0;
  return Math.max(win.endMin - work - brk, win.startMin);
}

/**
 * 오전 반차 · 반반차가 **나중에** 최종 승인되면, 그 기간에 이미 「지각」으로 저장된 큐브티 출퇴근 기록을 늦춘 기준으로 다시 매긴다
 * (기준 안이면 조퇴 아니면 정상, 기준도 넘겼으면 지각 그대로).
 * 결재 응답을 막지 않게 부르는 쪽은 기다리지 않는다(실패해도 결재는 그대로). 시프티에서 옮겨 온 기록(importBatch)은 건드리지 않는다.
 */
export async function clearLateForAmLeave(leave: { userId: string; type: string; startDate: Date; endDate: Date }): Promise<number> {
  if (!(AM_LEAVE_TYPES as readonly string[]).includes(leave.type)) return 0;
  const rows = await prisma.attendance.findMany({
    where: { userId: leave.userId, status: "LATE", importBatch: null, date: { gte: leave.startDate, lte: leave.endDate } },
    select: { id: true, date: true, clockIn: true, clockOut: true },
  });
  let n = 0;
  for (const r of rows) {
    const ymd = r.date.toISOString().slice(0, 10);
    const win = await workWindowFor(leave.userId, ymd);
    if (isLateAt(r.clockIn, await lateBaseMin(leave.userId, ymd, win))) continue;   // 늦춘 기준도 넘겼다 — 지각 그대로
    const next = isEarlyLeaveAt(r.clockOut, win.endMin) ? "EARLY_LEAVE" : "NORMAL";
    const res = await prisma.attendance.updateMany({ where: { id: r.id, status: "LATE" }, data: { status: next } });
    n += res.count;
  }
  return n;
}

/**
 * 오전 반차 · 반반차가 **없어지면**(취소 결재 최종 승인 · 다른 유형으로 변경) 그 기간 큐브티 출근을 휴가 없이 다시 재서,
 * 원래 시작보다 늦었으면 「지각」으로 되돌린다(2026-11-20 디렉터 「승인한 뒤 취소하거나 반려하면 지각으로 돌아가는 게 맞다」).
 * 부르는 쪽은 휴가 상태가 바뀐 **뒤**(커밋 뒤)에 부른다. 공휴일 · 시프티 이관 기록 · 시스템이 출근 시각을 채운 기록(AUTO_FILL · AUTO_CLOSE)은 건드리지 않는다.
 */
export async function restoreLateAfterAmLeaveRemoved(leave: { userId: string; type: string; startDate: Date; endDate: Date }): Promise<number> {
  if (!(AM_LEAVE_TYPES as readonly string[]).includes(leave.type)) return 0;
  const rows = await prisma.attendance.findMany({
    where: { userId: leave.userId, importBatch: null, clockIn: { not: null }, status: { in: ["NORMAL", "EARLY_LEAVE"] }, date: { gte: leave.startDate, lte: leave.endDate } },
    select: { id: true, date: true, clockIn: true, status: true },
  });
  let n = 0;
  for (const r of rows) {
    const ymd = r.date.toISOString().slice(0, 10);
    if (await isHoliday(ymd)) continue;
    const win = await workWindowFor(leave.userId, ymd);
    if (!isLateAt(r.clockIn, await lateBaseMin(leave.userId, ymd, win))) continue;   // 같은 날 다른 오전 휴가가 남아 있으면 그 기준으로 잰다
    const sys = await prisma.attendanceEdit.findFirst({ where: { attendanceId: r.id, kind: { in: ["AUTO_FILL", "AUTO_CLOSE"] } }, select: { id: true } });
    if (sys) continue;
    const res = await prisma.attendance.updateMany({ where: { id: r.id, status: r.status }, data: { status: "LATE" } });
    n += res.count;
  }
  return n;
}

export async function calcStatus(
  clockIn: Date | null,
  clockOut: Date | null,
  dateYmd: string,
  userId?: string
): Promise<"NORMAL" | "LATE" | "EARLY_LEAVE"> {
  const holiday = await isHoliday(dateYmd);
  if (holiday) return "NORMAL";

  // userId 가 없으면 일정을 알 수 없다 — 판정하지 않는다(#219-2, 종전에는 09:00/18:00 으로 판정)
  const win = userId ? await workWindowFor(userId, dateYmd) : NO_WINDOW;
  const { startMin, endMin } = win;

  // 오전 반차 · 반반차(승인) 날은 늦춘 기준으로 다시 잰다(#247) — 원래 시작보다 늦은 경우에만 휴가를 조회한다
  let isLate = isLateAt(clockIn, startMin);
  if (isLate && userId) isLate = isLateAt(clockIn, await lateBaseMin(userId, dateYmd, win));
  const isEarlyLeave = isEarlyLeaveAt(clockOut, endMin);
  return isLate ? "LATE" : isEarlyLeave ? "EARLY_LEAVE" : "NORMAL";
}
