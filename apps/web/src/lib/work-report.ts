import { prisma } from "@/lib/db";
import { breakHours } from "@/lib/schedule-payload";
import { getHolidaySet } from "@/lib/holidays";
import { kstTodayDateUTC } from "@/lib/kst";
import { mondayOf } from "@/lib/weekly-hours";
import { leaveInfo } from "@/lib/leave-catalog";
import { excludedBranchNames } from "@/lib/employee-scope";

// ─── 근로시간 리포트(2026-10-08 QA76 #41) ─────────────────────────────────
// 직원별 기간 집계 — 가산수당 근거·주 52시간 관리용. 본부 전 지점, 원장 담당 지점. 엑셀은 화면이 같은 값으로 만든다.
// 숫자의 뜻(법정 기준 그대로 — 본부 미답이라 큐브 기본값, 디렉터·본부 확인 사항):
//  · 실근로 = 실제 출퇴근 간격에서 휴게(근무일정과 같은 규칙: 4.5h↑ 30분, 9h↑ 1시간)를 뺀 시간. 기간 안의 날만
//  · 유급휴가 = 승인된 휴가의 기간 안 날 × 유형별 유급 시간(lib/leave-catalog paidHours, 주말·공휴일 제외)
//  · 휴일근로 = 일요일(주휴일)·공휴일에 한 실근로 전부. 공휴일근로는 그중 공휴일분(휴일근로에 포함)
//  · 연장 = 주(월~일)마다 max(Σ 평일 8시간 초과분, 주 평일 실근로 − 40시간). 토요일은 평일처럼 40시간 초과분에 들어간다(무급휴무일)
//  · 야간 = 22:00~06:00(KST)에 걸친 출퇴근 간격(휴게는 빼지 않는다)
//  · 주 52시간 = 주(월~일) 실근로 전부(휴일근로 포함). 최대 주·52시간 잔여(52 − 최대 주, 음수면 초과)·초과 주 수
//  · 연장·주 52시간은 기간에 걸친 주 **전체**(월~일)로 계산한다 — 기간이 주 중간에서 시작·끝나도 그 주는 통째로 본다
//  · 지각 = 기록 상태 LATE(오전 반차 날은 제외), 누락 = 지난 날 출근·퇴근 한쪽만, 결근 = 지난 날 근무일정이 있는데 기록·휴가 없음
//    (출퇴근 보드와 같은 규칙. 조퇴는 세지 않는다 — #52)
const DAY_MIN = 8 * 60, WEEK_REG_MIN = 40 * 60, WEEK_52_MIN = 52 * 60, KST_MS = 9 * 3600_000;
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const plusDays = (ymd: string, n: number) => { const d = dateOf(ymd); d.setUTCDate(d.getUTCDate() + n); return ymdOf(d); };
const netMin = (inAt: Date, outAt: Date) => { const span = (outAt.getTime() - inAt.getTime()) / 60000; return span > 0 ? Math.max(Math.round(span) - Math.round(breakHours(span / 60) * 60), 0) : 0; };

/** 출퇴근 간격이 22:00~06:00(KST)과 겹치는 분 */
export function nightMinutes(inAt: Date, outAt: Date): number {
  if (outAt <= inAt) return 0;
  const s = inAt.getTime() + KST_MS, e = outAt.getTime() + KST_MS;   // KST 로 옮긴 뒤 UTC 함수로 자정 계산
  const day0 = Math.floor(s / 86400_000) - 1;
  const dayN = Math.floor(e / 86400_000);
  let total = 0;
  for (let d = day0; d <= dayN; d++) {
    const ws = d * 86400_000 + 22 * 3600_000, we = ws + 8 * 3600_000;   // 그날 22:00 ~ 다음날 06:00
    const lo = Math.max(s, ws), hi = Math.min(e, we);
    if (hi > lo) total += hi - lo;
  }
  return Math.round(total / 60000);
}

export type WorkReportRow = {
  userId: string; empNo: number | null; name: string; branch: string | null; position: string | null; jobGroup: string | null; resigned: boolean;
  schedDays: number; workDays: number; workMin: number; leaveHours: number;
  overtimeMin: number; nightMin: number; holidayMin: number; publicHolidayMin: number;
  maxWeekMin: number; over52Weeks: number; remain52Min: number;
  late: number; missing: number; absent: number;
};

export async function workReport(opts: {
  from: string; to: string;
  branches: string[] | null;          // null = 전 지점(통계 제외 지점은 뺀다)
  emp: "active" | "resigned" | "all";
}): Promise<{ rows: WorkReportRow[]; truncated: boolean }> {
  const { from, to } = opts;
  const today = kstTodayDateUTC();
  const fromD = dateOf(from), toD = dateOf(to);
  const extFrom = mondayOf(from), extTo = plusDays(mondayOf(to), 6);
  const extFromD = dateOf(extFrom), extToD = dateOf(extTo);
  const excluded = opts.branches ? [] : await excludedBranchNames();
  const activeCond = { isActive: true, OR: [{ resignDate: null }, { resignDate: { gte: today } }] };
  const resignedCond = { resignDate: { lt: today, gte: fromD } };
  const empWhere = opts.emp === "active" ? activeCond : opts.emp === "resigned" ? resignedCond : { OR: [activeCond, resignedCond] };
  const users = await prisma.user.findMany({
    where: {
      deletedAt: null, role: { not: "ADMIN" },
      ...(opts.branches ? { branch: { in: opts.branches } } : excluded.length ? { OR: [{ branch: null }, { branch: { notIn: excluded } }] } : {}),
      AND: [empWhere],
    },
    select: { id: true, name: true, empNo: true, branch: true, position: true, jobGroup: true, resignDate: true, hireDate: true, employmentStatus: true },
    orderBy: [{ branch: "asc" }, { name: "asc" }],
    take: 1001,
  });
  const truncated = users.length > 1000;
  if (truncated) users.pop();
  const ids = users.map((u) => u.id);

  const [schedules, atts, leaves, holidays, pendings] = await Promise.all([
    prisma.schedule.findMany({ where: { userId: { in: ids }, date: { gte: fromD, lte: toD }, type: "WORK" }, select: { userId: true, date: true } }),
    prisma.attendance.findMany({ where: { userId: { in: ids }, date: { gte: extFromD, lte: extToD } }, select: { userId: true, date: true, clockIn: true, clockOut: true, status: true } }),
    prisma.leaveRequest.findMany({ where: { userId: { in: ids }, status: "APPROVED", startDate: { lte: toD }, endDate: { gte: fromD } }, select: { userId: true, type: true, startDate: true, endDate: true } }),
    getHolidaySet(extFromD, extToD),
    prisma.attendanceRequest.findMany({ where: { userId: { in: ids }, workDate: { gte: fromD, lte: toD }, status: "PENDING", action: { in: ["IN", "OUT"] } }, select: { userId: true, workDate: true } }),
  ]);

  const rows = new Map<string, WorkReportRow>(users.map((u) => [u.id, {
    userId: u.id, empNo: u.empNo, name: u.name, branch: u.branch, position: u.position, jobGroup: u.jobGroup, resigned: !!u.resignDate && u.resignDate < today,
    schedDays: 0, workDays: 0, workMin: 0, leaveHours: 0, overtimeMin: 0, nightMin: 0, holidayMin: 0, publicHolidayMin: 0,
    maxWeekMin: 0, over52Weeks: 0, remain52Min: WEEK_52_MIN, late: 0, missing: 0, absent: 0,
  }]));
  const sched = new Set<string>();
  for (const s of schedules) { sched.add(`${s.userId}|${ymdOf(s.date)}`); rows.get(s.userId)!.schedDays++; }
  const pending = new Set(pendings.map((p) => `${p.userId}|${ymdOf(p.workDate)}`));

  // 휴가 — 기간 안의 날만, 며칠짜리는 주말·공휴일 건너뜀. 휴가가 하나라도 있는 날은 결근이 아니다(출퇴근 보드와 같은 규칙 — 검증 F1), 오전 반차는 지각 제외
  const leaveDay = new Map<string, { frac: number; am: boolean }>();
  for (const l of leaves) {
    const info = leaveInfo(l.type);
    const unit = info?.unit === "HALF" ? 0.5 : info?.unit === "QUARTER" ? 0.25 : 1;
    const multi = l.endDate > l.startDate;
    for (let d = new Date(l.startDate); d <= l.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      const y = ymdOf(d);
      if (y < from || y > to) continue;
      if (multi && (d.getUTCDay() === 0 || d.getUTCDay() === 6 || holidays.has(y))) continue;
      const r = rows.get(l.userId); if (!r) continue;
      r.leaveHours += info?.paidHours ?? 0;
      const k = `${l.userId}|${y}`;
      const cur = leaveDay.get(k) ?? { frac: 0, am: false };
      cur.frac += unit; if (l.type === "HALF_AM" || l.type === "QUARTER_AM") cur.am = true;
      leaveDay.set(k, cur);
    }
  }

  // 출퇴근 — 주 단위 합은 기간에 걸친 주 전체, 그 밖의 합은 기간 안의 날만
  const week = new Map<string, { regular: number; total: number; dailyOT: number }>();   // userId|월요일
  const wk = (u: string, mon: string) => { const k = `${u}|${mon}`; let v = week.get(k); if (!v) { v = { regular: 0, total: 0, dailyOT: 0 }; week.set(k, v); } return v; };
  const todayYmd = ymdOf(today);
  const attDays = new Map<string, { in: boolean; out: boolean }>();
  for (const a of atts) {
    const r = rows.get(a.userId); if (!r) continue;
    const y = ymdOf(a.date);
    const inPeriod = y >= from && y <= to;
    if (inPeriod) {
      attDays.set(`${a.userId}|${y}`, { in: !!a.clockIn, out: !!a.clockOut });
      if (a.clockIn) r.workDays++;
      if (a.status === "LATE" && !leaveDay.get(`${a.userId}|${y}`)?.am) r.late++;
    }
    if (!a.clockIn || !a.clockOut || a.clockOut <= a.clockIn) continue;
    const net = netMin(a.clockIn, a.clockOut);
    const dow = a.date.getUTCDay();
    const isHol = holidays.has(y), isRest = isHol || dow === 0;
    const w = wk(a.userId, mondayOf(y));
    w.total += net;
    if (!isRest) { w.regular += net; w.dailyOT += Math.max(net - DAY_MIN, 0); }
    if (!inPeriod) continue;
    r.workMin += net;
    r.nightMin += nightMinutes(a.clockIn, a.clockOut);
    if (isRest) r.holidayMin += net;
    if (isHol) r.publicHolidayMin += net;
  }
  const firstMon = mondayOf(from);
  for (const [k, v] of week) {
    const [u, mon] = k.split("|");
    if (mon < firstMon || mon > to) continue;
    const r = rows.get(u); if (!r) continue;
    r.overtimeMin += Math.max(v.dailyOT, v.regular - WEEK_REG_MIN);
    if (v.total > r.maxWeekMin) r.maxWeekMin = v.total;
    if (v.total > WEEK_52_MIN) r.over52Weeks++;
  }
  // 누락·결근 — 지난 날만, 승인 대기 중인 날은 제외(출퇴근 보드와 같은 규칙)
  for (const u of users) {
    const r = rows.get(u.id)!;
    r.remain52Min = WEEK_52_MIN - r.maxWeekMin;
    const hire = u.hireDate ? ymdOf(u.hireDate) : null, resign = u.resignDate ? ymdOf(u.resignDate) : null;
    for (let d = new Date(fromD); d <= toD; d.setUTCDate(d.getUTCDate() + 1)) {
      const y = ymdOf(d);
      if (y >= todayYmd) break;
      const k = `${u.id}|${y}`;
      if (pending.has(k)) continue;
      const a = attDays.get(k);
      if (a && a.in !== a.out) { r.missing++; continue; }
      if (!a?.in && !a?.out && sched.has(k) && !leaveDay.has(k) && !holidays.has(y)
        && u.employmentStatus !== "ON_LEAVE" && u.employmentStatus !== "TEMPORARY"
        && (!hire || y >= hire) && (!resign || y <= resign)) r.absent++;
    }
  }
  return { rows: [...rows.values()], truncated };
}
