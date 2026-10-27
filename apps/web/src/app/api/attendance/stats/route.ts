import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { attendanceEditViews, type AttendanceEditView } from "@/lib/attendance-edit";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAllowed } from "@/lib/permission-settings";
import {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter,
  startOfYear, endOfYear,
  eachDayOfInterval, format, subDays,
  subWeeks, subMonths, subQuarters, subYears,
} from "date-fns";
import { getManagerBranches } from "@/lib/manager-branches";
import { kstTodayYmd, getHolidaySet } from "@/lib/holidays";
import { countsCalendarDays } from "@/lib/leave-catalog";
import { pastDayStatus } from "@/lib/attendance-day";
import { showTestRows, testAccountWhere } from "@/lib/employee-scope";
import { kstHhmm } from "@/lib/missed-out";

type Period = "daily" | "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";

function getDateRange(period: Period, baseDate: Date) {
  switch (period) {
    case "daily":
      return { start: startOfDay(baseDate), end: endOfDay(baseDate) };
    case "weekly":
      return { start: startOfWeek(baseDate, { weekStartsOn: 1 }), end: endOfWeek(baseDate, { weekStartsOn: 1 }) };
    case "monthly":
      return { start: startOfMonth(baseDate), end: endOfMonth(baseDate) };
    case "quarterly":
      return { start: startOfQuarter(baseDate), end: endOfQuarter(baseDate) };
    case "semiannual": {
      const month = baseDate.getMonth();
      const year = baseDate.getFullYear();
      if (month < 6) {
        return { start: new Date(year, 0, 1), end: new Date(year, 5, 30, 23, 59, 59) };
      } else {
        return { start: new Date(year, 6, 1), end: new Date(year, 11, 31, 23, 59, 59) };
      }
    }
    case "annual":
      return { start: startOfYear(baseDate), end: endOfYear(baseDate) };
    default:
      return { start: startOfMonth(baseDate), end: endOfMonth(baseDate) };
  }
}

function getPrevDateRange(period: Period, baseDate: Date) {
  switch (period) {
    case "daily": return getDateRange(period, subDays(baseDate, 1));
    case "weekly": return getDateRange(period, subWeeks(baseDate, 1));
    case "monthly": return getDateRange(period, subMonths(baseDate, 1));
    case "quarterly": return getDateRange(period, subQuarters(baseDate, 1));
    case "semiannual": return getDateRange(period, subMonths(baseDate, 6));
    case "annual": return getDateRange(period, subYears(baseDate, 1));
    default: return getDateRange("monthly", subMonths(baseDate, 1));
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  // 직원은 「본인 출퇴근 기록 열람」이 꺼져 있으면 통계도 못 본다(2026-10-17 #219 검증 P1). 앱은 이 API 를 쓰지 않는다.
  if (session.role === "EMPLOYEE" && !(await isAllowed("employee.viewOwnAttendance")))
    return NextResponse.json({ error: "출퇴근 기록 열람 권한이 없습니다." }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const period = (searchParams.get("period") || "monthly") as Period;
  const userId = searchParams.get("userId") || session.userId;
  const branchParam = searchParams.get("branch"); // 지점별 집계
  const dateParam = searchParams.get("date");
  const baseDate = dateParam ? new Date(dateParam) : new Date();

  // 접근 범위 결정 — 여러 사람(지점 · 담당 지점)을 묶어 셀 때는 테스트 계정을 뺀다(2026-10-23 검증 I). 한 사람을 지정하면 그대로
  // 보는 사람이 테스트 계정이거나(원장 검증 계정 kim@ 등) 고른 지점이 모두 테스트지점이면 테스트 계정도 넣는다(출퇴근 현황 board 와 같은 showTestRows, 10/23 검증 M3)
  const notTestFor = async (branches: string[] | null) =>
    (await showTestRows(session, { branches })) ? {} : { NOT: await testAccountWhere() };
  let userWhere: Record<string, unknown>;
  if (session.role === "EMPLOYEE") {
    userWhere = { userId: session.userId };
  } else if (session.role === "MANAGER" && !(await isAllowed("manager.viewAttendance"))) {
    userWhere = { userId: session.userId };   // 「지점 출퇴근 기록 열람」이 꺼지면 원장도 본인 통계만(권한 설정 #39)
  } else if (session.role === "MANAGER") {
    // 원장: 항상 담당 지점(대표+겸직) 한정. 지점별 조회면 지점 전체, 아니면 지정 직원(담당 지점일 때만)
    const myBranches = await getManagerBranches(session.userId);
    const notTest = await notTestFor(myBranches);
    if (branchParam) {
      userWhere = { user: { branch: { in: myBranches }, role: { not: "ADMIN" }, ...notTest } };
    } else {
      const target = await prisma.user.findUnique({ where: { id: userId }, select: { branch: true } });
      userWhere = (target && !!target.branch && myBranches.includes(target.branch))
        ? { userId }
        : { user: { branch: { in: myBranches }, role: { not: "ADMIN" }, ...notTest } };
    }
  } else {
    // 관리자: 지점별 조회 우선, 없으면 지정 직원
    userWhere = branchParam
      ? { user: { branch: branchParam, role: { not: "ADMIN" }, ...(await notTestFor([branchParam])) } }
      : { userId };
  }

  const { start, end } = getDateRange(period, baseDate);
  const { start: prevStart, end: prevEnd } = getPrevDateRange(period, baseDate);

  const [records, prevRecords] = await Promise.all([
    prisma.attendance.findMany({
      where: { ...userWhere, date: { gte: start, lte: end } },
      include: { user: { select: { name: true, branch: true } } },
      orderBy: { date: "asc" },
    }),
    prisma.attendance.findMany({
      where: { ...userWhere, date: { gte: prevStart, lte: prevEnd } },
      orderBy: { date: "asc" },
    }),
  ]);

  // 출근율·결근·누락·확인 필요 (2026-10-16 #219-6, 이예지 QA — 종전 출근율 = 정상 ÷ 전체라 지각 1일이면 0%)
  //  · 출근한 날   = 출근 또는 퇴근 기록이 있는 날. 단 0분 기록(출근 = 퇴근)은 빼고 「확인 필요」로 따로 센다
  //  · 누락       = 지난 날 출근·퇴근 중 한쪽만 있는 날(출근한 날에도 들어간다)
  //  · 결근       = 지난 날 기록이 하나도 없는데 근무일정(WORK)이 있고 휴가·공휴일·휴직·임시휴무가 아니며 입사일~퇴사일 안인 날.
  //                 출근·퇴근 요청이 결재 대기인 날은 세지 않는다
  //    → 누락·결근 판정은 근로시간 리포트(lib/work-report)와 **같은 함수** lib/attendance-day pastDayStatus (2026-10-17 검증 F2)
  //  · 근무해야 할 날 = 출근한 날 + 결근한 날,  출근율 = 출근한 날 ÷ 근무해야 할 날 (확인 필요인 날은 분자·분모 모두에서 뺀다)
  //  여러 사람(지점 조회)이면 「사람 × 날」 단위로 센다.
  const todayYmd = kstTodayYmd();
  const ymdOf = (d: Date) => d.toISOString().slice(0, 10);   // @db.Date = UTC 자정
  const isZeroMin = (r: { clockIn: Date | null; clockOut: Date | null }) =>
    !!r.clockIn && !!r.clockOut && Math.round((r.clockOut.getTime() - r.clockIn.getTime()) / 60000) === 0;
  const calcDays = async (
    recs: { userId: string; date: Date; clockIn: Date | null; clockOut: Date | null }[],
    from: Date, to: Date,
  ) => {
    const [scheds, leaves, holidays] = await Promise.all([
      prisma.schedule.findMany({
        where: { ...userWhere, date: { gte: from, lte: to }, type: "WORK" },
        select: { userId: true, date: true },
      }),
      prisma.leaveRequest.findMany({
        where: { ...userWhere, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } },
        select: { userId: true, startDate: true, endDate: true, type: true },
      }),
      getHolidaySet(from, to),
    ]);
    const ids = [...new Set([...recs.map((r) => r.userId), ...scheds.map((s) => s.userId)])];
    const [users, pendings] = ids.length ? await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, hireDate: true, resignDate: true, employmentStatus: true } }),
      // 근로시간 리포트와 같은 조건 — 출근·퇴근 요청(지점 밖·사진·본부) 결재 대기
      prisma.attendanceRequest.findMany({
        where: { userId: { in: ids }, workDate: { gte: from, lte: to }, status: "PENDING", action: { in: ["IN", "OUT"] } },
        select: { userId: true, workDate: true },
      }),
    ]) : [[], []];
    const userOf = new Map(users.map((u) => [u.id, u]));
    const pending = new Set(pendings.map((p) => `${p.userId}:${ymdOf(p.workDate)}`));

    const attended = new Set<string>();
    const needsCheck = new Set<string>();
    const attOf = new Map<string, { in: boolean; out: boolean }>();
    for (const r of recs) {
      if (!r.clockIn && !r.clockOut) continue;
      const k = `${r.userId}:${ymdOf(r.date)}`;
      if (isZeroMin(r)) { needsCheck.add(k); continue; }
      attended.add(k);
      attOf.set(k, { in: !!r.clockIn, out: !!r.clockOut });
    }
    // 휴가 날 — 근로시간 리포트와 같은 규칙(며칠짜리는 주말·공휴일을 건너뛴다)
    const onLeave = new Set<string>();
    for (const l of leaves) {
      const multi = l.endDate > l.startDate;
      const s = Math.max(l.startDate.getTime(), from.getTime()), e = Math.min(l.endDate.getTime(), to.getTime());
      for (let t = s; t <= e; t += 86400_000) {
        const d = new Date(t), y = ymdOf(d);
        if (multi && !countsCalendarDays(l.type) && (d.getUTCDay() === 0 || d.getUTCDay() === 6 || holidays.has(y))) continue;   // 조사는 주말도 휴가
        onLeave.add(`${l.userId}:${y}`);
      }
    }
    const scheduled = new Set(scheds.map((s) => `${s.userId}:${ymdOf(s.date)}`));
    let missing = 0;
    const absent = new Set<string>();
    for (const k of new Set([...scheduled, ...attOf.keys()])) {
      const [uid, y] = k.split(":");
      if (y >= todayYmd || needsCheck.has(k)) continue;   // 오늘·앞날은 아직 판정하지 않는다(오늘 출근했으면 attended 에 이미 있다)
      const u = userOf.get(uid);
      const st = pastDayStatus({
        ymd: y, pending: pending.has(k), att: attOf.get(k), scheduled: scheduled.has(k), onLeave: onLeave.has(k),
        holiday: holidays.has(y), employmentStatus: u?.employmentStatus ?? null,
        hireYmd: u?.hireDate ? ymdOf(u.hireDate) : null, resignYmd: u?.resignDate ? ymdOf(u.resignDate) : null,
      });
      if (st === "MISSING") missing++;
      else if (st === "ABSENT") absent.add(k);
    }
    const requiredDays = attended.size + absent.size;
    return {
      attendDays: attended.size,
      requiredDays,
      missedDays: absent.size,
      missingDays: missing,
      needsCheck: needsCheck.size,
      attendRate: requiredDays > 0 ? Math.round((attended.size / requiredDays) * 100) : null,
    };
  };

  // 누적 통계 계산
  // 이 함수는 status/clockIn/clockOut 만 본다. `typeof records`(user 포함)를 요구하면
  // user 없이 조회한 prevRecords 를 못 넘긴다 — 실제로 쓰는 것만 받는다.
  const calcStats = (recs: { status: string; clockIn: Date | null; clockOut: Date | null }[]) => {
    const totalMinutes = recs.reduce((acc: number, r: any) => {
      if (r.clockIn && r.clockOut) {
        return acc + Math.round((r.clockOut.getTime() - r.clockIn.getTime()) / 60000);
      }
      return acc;
    }, 0);

    return {
      total: recs.length,
      normal: recs.filter((r: any) => r.status === "NORMAL").length,
      late: recs.filter((r: any) => r.status === "LATE").length,
      earlyLeave: recs.filter((r: any) => r.status === "EARLY_LEAVE").length,
      absent: recs.filter((r: any) => r.status === "ABSENT").length,
      totalMinutes,
      avgMinutes: recs.length > 0 ? Math.round(totalMinutes / recs.filter((r: any) => r.clockIn).length || 0) : 0,
    };
  };

  const [curDays, prevDays, edits] = await Promise.all([
    calcDays(records, start, end), calcDays(prevRecords, prevStart, prevEnd),
    // 수정 이력 요약(#219-15) — 표가 아직 없는 서버(DDL 전)에서도 통계는 열린다
    attendanceEditViews({ attendance: { ...(userWhere as Prisma.AttendanceWhereInput), date: { gte: start, lte: end } } })
      .catch(() => new Map<string, AttendanceEditView>()),
  ]);
  const current = { ...calcStats(records), ...curDays };
  const previous = { ...calcStats(prevRecords), ...prevDays };

  // 일별 차트 데이터 (기간 내 각 날짜별 근무시간)
  const allDays = eachDayOfInterval({ start, end: end > new Date() ? new Date() : end });
  const chartData = allDays.map(day => {
    const dayStr = format(day, "yyyy-MM-dd");
    const rec = records.find((r: any) => format(new Date(r.date), "yyyy-MM-dd") === dayStr);
    const minutes = rec?.clockIn && rec?.clockOut
      ? Math.round((rec.clockOut.getTime() - rec.clockIn.getTime()) / 60000)
      : 0;
    return {
      date: format(day, period === "annual" ? "MM월" : period === "quarterly" || period === "semiannual" ? "MM/dd" : "dd일"),
      fullDate: dayStr,
      minutes,
      hours: Math.round(minutes / 60 * 10) / 10,
      status: rec?.status || null,
      // 한국 시각으로 — 서버가 UTC 라 format(…, "HH:mm") 이면 9시간 이르게 나왔다(10/23 검증 덤)
      clockIn: rec?.clockIn ? kstHhmm(rec.clockIn) : null,
      clockOut: rec?.clockOut ? kstHhmm(rec.clockOut) : null,
    };
  });

  // 월별 집계 (분기/반기/연간용)
  const monthlyData = period === "quarterly" || period === "semiannual" || period === "annual"
    ? Object.values(
        records.reduce((acc: any, r: any) => {
          const monthKey = format(new Date(r.date), "yyyy-MM");
          const monthLabel = format(new Date(r.date), "MM월");
          if (!acc[monthKey]) acc[monthKey] = { date: monthLabel, count: 0, minutes: 0, hours: 0 };
          acc[monthKey].count += 1;
          if (r.clockIn && r.clockOut) {
            const m = Math.round((r.clockOut.getTime() - r.clockIn.getTime()) / 60000);
            acc[monthKey].minutes += m;
            acc[monthKey].hours = Math.round(acc[monthKey].minutes / 60 * 10) / 10;
          }
          return acc;
        }, {} as Record<string, { date: string; count: number; minutes: number; hours: number }>)
      )
    : [];

  // 찍은 시각 · 일한 시간은 본부만(■0-11) — 직원 · 원장(「출퇴근 시각 보기」 끔)에게는 날짜별 상태와 출근일 · 지각 · 누락 수만
  const { canSeeClockTimes, maskClock } = await import("@/lib/attendance-visibility");
  if (!(await canSeeClockTimes(session.role))) {
    const noHours = <T extends { totalMinutes: number; avgMinutes: number }>(st: T): T => ({ ...st, totalMinutes: 0, avgMinutes: 0 });
    // 본부가 승인한 「출퇴근 기록 요청」 기간의 날짜는 시각을 푼다(2026-10-27 이예지 ⑦, lib/record-grants) — api/attendance GET 과 같은 규칙
    const { recordGrantDays, isGranted } = await import("@/lib/record-grants");
    const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
    const grants = records.length ? await recordGrantDays([...new Set(records.map((r) => r.userId))], ymdOf(start), ymdOf(end)) : new Map<string, Set<string>>();
    return NextResponse.json({
      period,
      range: { start: start.toISOString(), end: end.toISOString() },
      current: noHours(current),
      previous: noHours(previous),
      chartData: [],
      timesHidden: true,
      records: records.map(r => ({
        ...maskClock({ clockIn: r.clockIn, clockOut: r.clockOut }, isGranted(grants, r.userId, ymdOf(r.date))),
        ...(isGranted(grants, r.userId, ymdOf(r.date)) ? { timesGranted: true } : {}),
        id: r.id,
        date: r.date,
        status: r.status,
        userName: r.user.name,
        userBranch: r.user.branch,
        edit: null,
        minutes: 0,
        zeroMinutes: isZeroMin(r),   // 출근 = 퇴근(0분) 기록 — 시각 없이 「확인 필요」만 보이게
      })),
    });
  }

  return NextResponse.json({
    period,
    range: { start: start.toISOString(), end: end.toISOString() },
    current,
    previous,
    chartData: period === "quarterly" || period === "semiannual" || period === "annual" ? monthlyData : chartData,
    records: records.map(r => ({
      id: r.id,
      date: r.date,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      clockInPlace: r.clockInPlace,    // 출근·퇴근 장소(2026-10-07 #36)
      clockOutPlace: r.clockOutPlace,
      status: r.status,
      userName: r.user.name,
      userBranch: r.user.branch,
      edit: edits.get(r.id) ?? null,   // 수정됨 표시·원래 시각·사유·수정/승인자(#219-15)
      minutes: r.clockIn && r.clockOut
        ? Math.round((r.clockOut.getTime() - r.clockIn.getTime()) / 60000)
        : 0,
    })),
  });
}
