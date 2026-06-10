import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 관리자 대시보드 통계 (오늘 근무 현황 + 대기 결재 + 직원 수)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 조회할 수 있습니다." }, { status: 403 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 재직 중인 직원 (관리자 제외)
  const employeeWhere = {
    role: { not: "ADMIN" as const },
    isActive: true,
    deletedAt: null,
    employmentStatus: "ACTIVE" as const,
  };

  const [totalEmployees, todayRecords, onLeave, pendingLeave, pendingSchedule, pendingLeaveItems, pendingScheduleItems, missingRecords] =
    await Promise.all([
      prisma.user.count({ where: employeeWhere }),

      // 오늘 출퇴근 기록
      prisma.attendance.findMany({
        where: { date: today, user: employeeWhere },
      }),

      // 오늘 휴가 중 (승인된 휴가)
      prisma.leaveRequest.count({
        where: {
          status: "APPROVED",
          startDate: { lte: today },
          endDate: { gte: today },
          user: employeeWhere,
        },
      }),

      // 대기 중인 휴가/근무일정 결재
      prisma.leaveRequest.count({ where: { status: "PENDING" } }),
      prisma.scheduleRequest.count({ where: { status: "PENDING" } }),

      // 승인 대기 항목 목록 (최근순 5건씩)
      prisma.leaveRequest.findMany({
        where: { status: "PENDING" },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.scheduleRequest.findMany({
        where: { status: "PENDING" },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),

      // 최근 7일 출퇴근 누락 (입실 또는 퇴실 누락)
      prisma.attendance.findMany({
        where: {
          date: { gte: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000), lt: today },
          OR: [{ clockIn: null }, { clockOut: null }],
        },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { date: "desc" },
        take: 10,
      }),
    ]);

  const present = todayRecords.filter((r) => r.clockIn).length;
  const late = todayRecords.filter((r) => r.status === "LATE").length;
  const earlyLeave = todayRecords.filter((r) => r.status === "EARLY_LEAVE").length;
  const absent = Math.max(totalEmployees - present - onLeave, 0);

  const LEAVE_TYPE_LABEL: Record<string, string> = {
    ANNUAL: "연차", HALF_AM: "오전반차", HALF_PM: "오후반차",
    QUARTER_AM: "오전반반차", QUARTER_PM: "오후반반차",
    COMPENSATORY: "대체휴무", SICK: "병가", SPECIAL: "특별휴가",
  };
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

  const pendingItems = [
    ...pendingLeaveItems.map((r) => ({
      id: r.id,
      type: "leave" as const,
      title: `${LEAVE_TYPE_LABEL[r.type] ?? r.type} ${fmt(r.startDate)}~${fmt(r.endDate)} (${r.days}일)`,
      requester: r.user.name,
      requestedAt: r.createdAt,
    })),
    ...pendingScheduleItems.map((r) => ({
      id: r.id,
      type: "schedule" as const,
      title: `근무일정 ${r.templateName ?? ""} ${fmt(r.startDate)}~${fmt(r.endDate)}`,
      requester: r.user.name,
      requestedAt: r.createdAt,
    })),
  ].sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());

  const missingAttendance = missingRecords.map((r) => ({
    id: r.id,
    name: r.user.name,
    email: r.user.email,
    date: r.date,
    type: !r.clockIn ? "입실 누락" : "퇴실 누락",
  }));

  return NextResponse.json({
    totalEmployees,
    attendance: { present, late, absent, earlyLeave, onLeave },
    pending: { leave: pendingLeave, schedule: pendingSchedule },
    pendingItems,
    missingAttendance,
  });
}
