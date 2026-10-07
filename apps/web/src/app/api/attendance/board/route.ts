import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { excludedBranchNames } from "@/lib/employee-scope";
import { getHolidaySet } from "@/lib/holidays";
import { breakHours, isRealDate } from "@/lib/schedule-payload";
import { LEAVE_TYPE_LABEL } from "@/lib/leave-cancel-flow";
import { kstTodayDateUTC } from "@/lib/kst";

export const dynamic = "force-dynamic";

// 전 직원 출퇴근 보드(2026-10-07 QA #27 #28 #17 #52 #68 #82) — 달력형·목록형이 같은 데이터를 쓴다.
//  · 본부: 전 지점(통계 제외 지점은 고르지 않으면 뺀다), 원장: 담당 지점만(보기만 — 수정은 요청 승인으로)
//  · 칸: 근무일정, 출퇴근 시각·장소, 휴가, 공휴일, 지각·누락·결근 표시(조퇴는 표시하지 않는다 — #52)
//  · 결근 = 근무일정이 있는 지난 날에 출근·퇴근 기록이 모두 없고 휴가도 아님(일정 없는 날은 결근으로 보지 않는다 — 본부 답변 #12)
//  · 누락 = 지난 날에 출근 또는 퇴근 한쪽만 있음
//  · 휴게·총 시간 = 실제 출퇴근 간격에서 근무일정과 같은 휴게 규칙(4.5h↑ 30분, 9h↑ 1시간)을 뺀 값

const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const kstHHmm = (t: Date) => new Date(t.getTime() + 9 * 3600_000).toISOString().slice(11, 16);

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGER") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  if (!isRealDate(from) || !isRealDate(to) || from > to) return NextResponse.json({ error: "기간을 확인해 주세요." }, { status: 400 });
  if (dateOf(to).getTime() - dateOf(from).getTime() > 62 * 86400_000) return NextResponse.json({ error: "한 번에 62일까지 볼 수 있습니다." }, { status: 400 });
  const emp = sp.get("emp") === "resigned" ? "resigned" : sp.get("emp") === "all" ? "all" : "active";
  const wanted = (sp.get("branches") || "").split(",").map((s) => s.trim()).filter(Boolean);

  // 볼 수 있는 지점
  let branches: string[] | null;
  if (session.role === "MANAGER") {
    const own = await getManagerBranches(session.userId);
    branches = wanted.length ? wanted.filter((b) => own.includes(b)) : own;
    if (branches.length === 0) return NextResponse.json({ error: "담당 지점이 없습니다." }, { status: 403 });
  } else {
    branches = wanted.length ? wanted : null;
  }
  const excluded = branches ? [] : await excludedBranchNames();

  const today = kstTodayDateUTC();
  const fromD = dateOf(from), toD = dateOf(to);
  // 재직 = 퇴사일이 없거나 오늘 이후(퇴사일 다음 날부터 퇴사자 — #68). 퇴사자는 기간 안에 다녔던 사람만
  const activeCond = { isActive: true, OR: [{ resignDate: null }, { resignDate: { gte: today } }] };
  const resignedCond = { resignDate: { lt: today, gte: fromD } };
  const empWhere = emp === "active" ? activeCond : emp === "resigned" ? resignedCond : { OR: [activeCond, resignedCond] };

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      role: { not: "ADMIN" },
      ...(branches ? { branch: { in: branches } } : excluded.length ? { OR: [{ branch: null }, { branch: { notIn: excluded } }] } : {}),
      AND: [empWhere],
    },
    select: { id: true, name: true, empNo: true, branch: true, position: true, jobGroup: true, role: true, resignDate: true, hireDate: true, employmentStatus: true },
    orderBy: [{ branch: "asc" }, { name: "asc" }],
    take: 1001,
  });
  const truncated = users.length > 1000;   // 1000명을 넘으면 잘렸다고 알린다
  if (truncated) users.pop();
  const ids = users.map((u) => u.id);

  const [schedules, atts, leaves, holidays, pendings] = await Promise.all([
    prisma.schedule.findMany({ where: { userId: { in: ids }, date: { gte: fromD, lte: toD }, type: "WORK" }, select: { userId: true, date: true, startTime: true, endTime: true } }),
    prisma.attendance.findMany({
      where: { userId: { in: ids }, date: { gte: fromD, lte: toD } },
      select: { id: true, userId: true, date: true, clockIn: true, clockOut: true, status: true, clockInPlace: true, clockOutPlace: true },
    }),
    prisma.leaveRequest.findMany({
      where: { userId: { in: ids }, status: "APPROVED", startDate: { lte: toD }, endDate: { gte: fromD } },
      select: { userId: true, type: true, startDate: true, endDate: true, days: true },
    }),
    getHolidaySet(fromD, toD),
    // 승인 대기 중인 지점 밖·사진·본부 출퇴근 요청 — 결근·누락 대신 「승인 대기」로 보인다
    prisma.attendanceRequest.findMany({
      where: { userId: { in: ids }, workDate: { gte: fromD, lte: toD }, status: "PENDING", action: { in: ["IN", "OUT"] } },
      select: { userId: true, workDate: true, action: true, clockOut: true },
    }),
  ]);

  const days: string[] = [];
  for (let d = new Date(fromD); d <= toD; d.setUTCDate(d.getUTCDate() + 1)) days.push(ymdOf(d));

  type Cell = {
    sched?: string; in?: string; out?: string; inPlace?: string | null; outPlace?: string | null; attId?: string;
    leave?: string; leaveAm?: boolean; late?: boolean; missing?: boolean; absent?: boolean; pending?: boolean; workMin?: number; breakMin?: number;
  };
  const cells: Record<string, Record<string, Cell>> = {};
  const cell = (u: string, d: string) => ((cells[u] ??= {})[d] ??= {});

  for (const s of schedules) cell(s.userId, ymdOf(s.date)).sched = `${s.startTime}-${s.endTime}`;
  for (const l of leaves) {
    const multi = l.endDate > l.startDate;
    for (let d = new Date(l.startDate); d <= l.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      const y = ymdOf(d);
      if (y < from || y > to) continue;
      // 며칠짜리 휴가는 토·일·공휴일 칸에 찍지 않는다(휴가 일수도 그날을 빼고 센다)
      if (multi && (d.getUTCDay() === 0 || d.getUTCDay() === 6 || holidays.has(y))) continue;
      const c = cell(l.userId, y);
      const label = LEAVE_TYPE_LABEL[l.type] ?? l.type;
      c.leave = c.leave ? `${c.leave}·${label}` : label;   // 같은 날 두 건(오전·오후 반차)도 함께
      if (l.type === "HALF_AM" || l.type === "QUARTER_AM") c.leaveAm = true;
    }
  }
  const todayYmd = ymdOf(today);
  for (const a of atts) {
    const c = cell(a.userId, ymdOf(a.date));
    c.attId = a.id;
    if (a.clockIn) c.in = kstHHmm(a.clockIn);
    if (a.clockOut) c.out = kstHHmm(a.clockOut);
    c.inPlace = a.clockInPlace;
    c.outPlace = a.clockOutPlace;
    c.late = a.status === "LATE";
    if (a.clockIn && a.clockOut && a.clockOut > a.clockIn) {
      const span = (a.clockOut.getTime() - a.clockIn.getTime()) / 60000;
      const br = Math.round(breakHours(span / 60) * 60);
      c.breakMin = br;
      c.workMin = Math.max(Math.round(span) - br, 0);
    }
  }
  for (const p of pendings) {
    const c = cell(p.userId, ymdOf(p.workDate));
    c.pending = true;
  }
  // 누락·결근은 지난 날만 판정한다(오늘은 아직 진행 중).
  // 결근은 근무일정이 있는 날만 — 공휴일·휴직(임시휴무)·입사 전·퇴사일 다음 날부터는 결근으로 보지 않는다.
  // 승인 대기 중인 출퇴근 요청이 있는 날은 결근·누락 대신 「승인 대기」.
  // 오전 반차(반반차)가 있는 날은 늦게 출근해도 지각으로 보이지 않는다(저장된 상태는 휴가를 모른다).
  for (const u of users) {
    const row = cells[u.id];
    if (!row) continue;
    const hire = u.hireDate ? ymdOf(u.hireDate) : null;
    const resign = u.resignDate ? ymdOf(u.resignDate) : null;
    for (const [d, c] of Object.entries(row)) {
      if (c.leaveAm) c.late = false;
      if (d >= todayYmd || c.pending) continue;
      const hasIn = !!c.in, hasOut = !!c.out;
      if (hasIn !== hasOut) c.missing = true;
      else if (!hasIn && !hasOut && c.sched && !c.leave && !holidays.has(d)
        && u.employmentStatus !== "ON_LEAVE" && u.employmentStatus !== "TEMPORARY"
        && (!hire || d >= hire) && (!resign || d <= resign)) c.absent = true;
    }
  }

  const holidayMap: Record<string, true> = {};
  for (const h of holidays) holidayMap[h] = true;

  return NextResponse.json({
    from, to, days, holidays: holidayMap,
    users: users.map((u) => ({
      id: u.id, name: u.name, empNo: u.empNo, branch: u.branch, position: u.position, jobGroup: u.jobGroup, role: u.role,
      resigned: !!u.resignDate && u.resignDate < today,
      workDays: Object.values(cells[u.id] ?? {}).filter((c) => c.in).length,   // 출근일(출근 기록이 있는 날)
    })),
    cells,
    truncated,
    canEdit: session.role === "ADMIN",   // 원장은 보기만 — 수정은 출퇴근기록 수정 요청 승인으로(#53)
  });
}
