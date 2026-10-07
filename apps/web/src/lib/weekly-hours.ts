import { prisma } from "@/lib/db";
import { breakHours } from "@/lib/schedule-payload";

// ─── 주 근로시간 49시간 경고(2026-10-07 QA #38, 본부 답변 #13) ─────────────────
//  · 49시간을 **넘으면** 경고만 한다(막지 않는다)
//  · 근무일정과 실제 출퇴근 둘 다 본다. 주는 월요일에 시작, 휴게(4.5h↑ 30분, 9h↑ 1시간)는 뺀다
//  · 휴가일은 뺀다 — 근무일정 기준에서 승인된 하루짜리 휴가가 있는 날은 세지 않는다(실제 출근했으면 실제 기준에는 들어간다)

export const WEEK_LIMIT_MIN = 49 * 60;

const dateOf = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
const toMin = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const netMin = (spanMin: number) => Math.max(spanMin - Math.round(breakHours(spanMin / 60) * 60), 0);

/** 그 날짜가 든 주의 월요일 */
export function mondayOf(ymd: string): string {
  const d = dateOf(ymd);
  const back = (d.getUTCDay() + 6) % 7;   // 월=0 … 일=6
  d.setUTCDate(d.getUTCDate() - back);
  return ymdOf(d);
}
const plusDays = (ymd: string, n: number) => { const d = dateOf(ymd); d.setUTCDate(d.getUTCDate() + n); return ymdOf(d); };

type Proposed = Map<string, Map<string, { start: string; end: string } | null>>;   // userId → date → 바뀔 일정(null 이면 삭제)

/**
 * 사람·주별 근로시간(분). proposed 를 주면 아직 저장 전인 일정(신청)을 반영해 계산한다.
 * 반환 키: `${userId}|${월요일}`
 */
export async function weeklyMinutes(userIds: string[], mondays: string[], proposed?: Proposed) {
  const out = new Map<string, { sched: number; actual: number }>();
  if (!userIds.length || !mondays.length) return out;
  const weeks = [...new Set(mondays)].sort();
  const from = dateOf(weeks[0]), to = dateOf(plusDays(weeks[weeks.length - 1], 6));

  const [schedules, atts, leaves] = await Promise.all([
    prisma.schedule.findMany({ where: { userId: { in: userIds }, date: { gte: from, lte: to }, type: "WORK" }, select: { userId: true, date: true, startTime: true, endTime: true } }),
    prisma.attendance.findMany({ where: { userId: { in: userIds }, date: { gte: from, lte: to }, clockIn: { not: null }, clockOut: { not: null } }, select: { userId: true, date: true, clockIn: true, clockOut: true } }),
    prisma.leaveRequest.findMany({ where: { userId: { in: userIds }, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } }, select: { userId: true, startDate: true, endDate: true, days: true } }),
  ]);
  // 하루를 다 쉬는 날만 뺀다 — 하루짜리 휴가, 또는 같은 날 반차 두 건(오전+오후)처럼 합이 하루가 되는 날.
  // 여러 날짜 휴가는 토·일을 건너뛴다(휴가 일수도 그날을 빼고 센다)
  const leaveFrac = new Map<string, number>();
  for (const l of leaves) {
    const multi = l.endDate > l.startDate;
    const f = l.days >= 1 || multi ? 1 : l.days;
    for (let d = new Date(l.startDate); d <= l.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      if (multi && (d.getUTCDay() === 0 || d.getUTCDay() === 6)) continue;
      const k = `${l.userId}|${ymdOf(d)}`;
      leaveFrac.set(k, (leaveFrac.get(k) ?? 0) + f);
    }
  }
  const leaveDays = new Set([...leaveFrac].filter(([, f]) => f >= 1).map(([k]) => k));

  // 일정: 저장된 것 위에 바뀔 것(proposed)을 덮는다
  const sched = new Map<string, { start: string; end: string }>();
  for (const s of schedules) sched.set(`${s.userId}|${ymdOf(s.date)}`, { start: s.startTime, end: s.endTime });
  if (proposed) for (const [u, days] of proposed) for (const [d, v] of days) {
    if (v) sched.set(`${u}|${d}`, v); else sched.delete(`${u}|${d}`);
  }

  const add = (u: string, ymd: string, k: "sched" | "actual", min: number) => {
    const key = `${u}|${mondayOf(ymd)}`;
    const cur = out.get(key) ?? { sched: 0, actual: 0 };
    cur[k] += min;
    out.set(key, cur);
  };
  for (const [key, v] of sched) {
    const [u, d] = key.split("|");
    if (leaveDays.has(key)) continue;   // 휴가일은 근무일정 기준에서 뺀다
    const s = toMin(v.start), e = toMin(v.end);
    if (s == null || e == null || e <= s) continue;
    add(u, d, "sched", netMin(e - s));
  }
  for (const a of atts) {
    if (!a.clockIn || !a.clockOut || a.clockOut <= a.clockIn) continue;
    add(a.userId, ymdOf(a.date), "actual", netMin(Math.round((a.clockOut.getTime() - a.clockIn.getTime()) / 60000)));   // 초 단위 기록 → 분
  }
  return out;
}

/**
 * 저장(또는 신청)한 날짜가 든 주가 49시간을 넘으면 경고 문구를 돌려준다(빈 배열이면 문제없음).
 * entries: 이번에 바뀐 사람·날짜, proposed: 아직 저장 전이면 그 내용
 */
export async function over49Warnings(entries: { userId: string; date: string }[], proposed?: Proposed): Promise<string[]> {
  if (!entries.length) return [];
  const userIds = [...new Set(entries.map((e) => e.userId))];
  const mondays = [...new Set(entries.map((e) => mondayOf(e.date)))];
  const mins = await weeklyMinutes(userIds, mondays, proposed);
  const names = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const pairs = new Set(entries.map((e) => `${e.userId}|${mondayOf(e.date)}`));
  const h = (raw: number) => { const m = Math.round(raw); return `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`; };
  const out: string[] = [];
  for (const key of pairs) {
    const v = mins.get(key);
    if (!v || (v.sched <= WEEK_LIMIT_MIN && v.actual <= WEEK_LIMIT_MIN)) continue;
    const [u, mon] = key.split("|");
    const span = `${mon.slice(5).replace("-", "/")}~${plusDays(mon, 6).slice(5).replace("-", "/")}`;
    const parts = [v.sched > WEEK_LIMIT_MIN ? `근무일정 ${h(v.sched)}` : "", v.actual > WEEK_LIMIT_MIN ? `실제 ${h(v.actual)}` : ""].filter(Boolean);
    out.push(`${names.get(u) ?? "직원"} · ${span} 주 ${parts.join(", ")} — 주 49시간을 넘습니다`);
  }
  return out;
}
