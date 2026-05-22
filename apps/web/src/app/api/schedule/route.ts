import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eachDayOfInterval, format, startOfDay } from "date-fns";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const year  = parseInt(searchParams.get("year")  || String(new Date().getFullYear()));
  const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));

  const startDate = new Date(year, month - 1, 1);
  const endDate   = new Date(year, month, 0, 23, 59, 59, 999);

  // 지점 필터 (MANAGER는 자기 지점만)
  const branchUserWhere = session.role === "MANAGER" ? { branch: session.branch } : {};
  const branchRelWhere  = session.role === "MANAGER" ? { user: { branch: session.branch } } : {};

  // 지점 내 활성 직원 ID 목록 (집계 기준)
  const branchUserIds = session.role === "MANAGER"
    ? (await prisma.user.findMany({ where: { isActive: true, ...branchUserWhere }, select: { id: true } })).map(u => u.id)
    : null; // null = 전체

  const userIdFilter = branchUserIds ? { userId: { in: branchUserIds } } : {};

  // 병렬 조회: 일정 / 출퇴근 / 승인된 휴가 / 전체 직원 수
  const [schedules, attendances, leaves, totalEmployees] = await Promise.all([
    prisma.schedule.findMany({
      where: { date: { gte: startDate, lte: endDate }, ...userIdFilter },
      select: { userId: true, date: true, type: true },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: startDate, lte: endDate }, ...userIdFilter },
      select: { userId: true, date: true, status: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        startDate: { lte: endDate },
        endDate: { gte: startDate },
        ...userIdFilter,
      },
      select: { userId: true, startDate: true, endDate: true },
    }),
    prisma.user.count({ where: { isActive: true, ...branchUserWhere } }),
  ]);

  // 날짜별 집계
  const days = eachDayOfInterval({ start: startDate, end: new Date(year, month, 0) });

  const monthData = days.map(day => {
    const dayStr  = format(day, "yyyy-MM-dd");
    const dayMidnight = startOfDay(day);

    const daySched = schedules.filter(s => format(new Date(s.date), "yyyy-MM-dd") === dayStr);
    const dayAtt   = attendances.filter(a => format(new Date(a.date), "yyyy-MM-dd") === dayStr);
    const dayLeave = leaves.filter(l => {
      const ls = startOfDay(new Date(l.startDate));
      const le = startOfDay(new Date(l.endDate));
      return ls <= dayMidnight && le >= dayMidnight;
    });

    const ct = (type: string)   => daySched.filter(s => s.type === type).length;
    const cs = (status: string) => dayAtt.filter(a => a.status === status).length;

    return {
      date:       dayStr,
      work:       ct("WORK"),
      off:        ct("OFF"),
      holiday:    ct("HOLIDAY"),
      checkedIn:  dayAtt.filter(a => a.status !== "ABSENT").length,
      late:       cs("LATE"),
      earlyLeave: cs("EARLY_LEAVE"),
      absent:     cs("ABSENT"),
      leave:      dayLeave.length,
    };
  });

  return NextResponse.json({ monthData, totalEmployees });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { userId, date, startTime, endTime, type, note } = await request.json();

  if (!userId || !date || !startTime || !endTime) {
    return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
  }

  // 같은 날짜+직원 일정이 있으면 upsert
  const existing = await prisma.schedule.findFirst({
    where: { userId, date: new Date(date) },
    select: { id: true },
  });

  const schedule = await prisma.schedule.upsert({
    where: { id: existing?.id ?? "new" },
    create: { userId, date: new Date(date), startTime, endTime, type: type || "WORK", note },
    update: { startTime, endTime, type: type || "WORK", note },
  });

  return NextResponse.json({ success: true, schedule });
}
