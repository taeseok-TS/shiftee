import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter,
  startOfYear, endOfYear,
  eachDayOfInterval, format, subDays,
  subWeeks, subMonths, subQuarters, subYears,
} from "date-fns";

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

  const { searchParams } = new URL(request.url);
  const period = (searchParams.get("period") || "monthly") as Period;
  const userId = searchParams.get("userId") || session.userId;
  const branchParam = searchParams.get("branch"); // 지점별 집계
  const dateParam = searchParams.get("date");
  const baseDate = dateParam ? new Date(dateParam) : new Date();

  // 접근 범위 결정
  let userWhere: Record<string, unknown>;
  if (session.role === "EMPLOYEE") {
    userWhere = { userId: session.userId };
  } else if (session.role === "MANAGER") {
    // 원장: 항상 자기 지점 한정. 지점별 조회면 지점 전체, 아니면 지정 직원(자기 지점일 때만)
    if (branchParam) {
      userWhere = { user: { branch: session.branch } };
    } else {
      const target = await prisma.user.findUnique({ where: { id: userId }, select: { branch: true } });
      userWhere = (target && target.branch === session.branch) ? { userId } : { user: { branch: session.branch } };
    }
  } else {
    // 관리자: 지점별 조회 우선, 없으면 지정 직원
    userWhere = branchParam
      ? { user: { branch: branchParam, role: { not: "ADMIN" } } }
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

  // 누적 통계 계산
  const calcStats = (recs: typeof records) => {
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

  const current = calcStats(records);
  const previous = calcStats(prevRecords);

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
      clockIn: rec?.clockIn ? format(rec.clockIn, "HH:mm") : null,
      clockOut: rec?.clockOut ? format(rec.clockOut, "HH:mm") : null,
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
      status: r.status,
      minutes: r.clockIn && r.clockOut
        ? Math.round((r.clockOut.getTime() - r.clockIn.getTime()) / 60000)
        : 0,
    })),
  });
}
