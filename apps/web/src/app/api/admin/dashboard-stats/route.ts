import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { kstTodayDateUTC } from "@/lib/kst";

// 관리자 대시보드 통계 (오늘 근무 현황 + 대기 결재 + 직원 수)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 조회할 수 있습니다." }, { status: 403 });

  // 오늘 날짜 (UTC 자정 — @db.Date 컬럼과 동일 규칙)
  const nowDate = new Date();
  const today = kstTodayDateUTC();

  // 재직 중인 직원 (관리자 제외). "통계 포함" 꺼진 지점(테스트지점·본부 등) 소속은 카운트 제외
  const excludedBranches = (
    await prisma.branch.findMany({ where: { countInStats: false }, select: { name: true } })
  ).map((b) => b.name);
  const pendingForMe = { status: "PENDING" as const, userId: { not: session.userId } };

  const employeeWhere = {
    role: { not: "ADMIN" as const },
    isActive: true,
    deletedAt: null,
    employmentStatus: "ACTIVE" as const,
    ...(excludedBranches.length > 0
      ? { OR: [{ branch: null }, { branch: { notIn: excludedBranches } }] }
      : {}),
  };

  const [totalEmployees, todayRecords, onLeave, pendingLeave, pendingSchedule, pendingLeaveItems, pendingScheduleItems, missingRecords] =
    // 관리자 결재함(my-approvals)은 **본인 신청을 뺀다.** 대시보드 숫자도 같아야
    // 카드를 눌렀을 때 빈 화면이 되지 않는다.
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

      // 대기 중인 휴가/근무일정 결재 — **결재함과 같은 기준**이어야 한다.
      // ⚠ 종전에는 대기 신청 전체를 셌다(본인 것 포함). 결재함은 본인 신청을 빼므로,
      //   관리자가 자기 신청을 내는 순간 "승인 대기 1건"이 뜨는데 결재함은 비어 있었다
      //   (2026-09-09 검증에서 적발 — 원장 대시보드에서 고친 그 버그의 세 번째 자리).
      prisma.leaveRequest.count({ where: pendingForMe }),
      prisma.scheduleRequest.count({ where: pendingForMe }),

      // 승인 대기 항목 목록 (최근순 5건씩) — 눌러 들어가면 결재함에 있어야 한다
      prisma.leaveRequest.findMany({
        where: pendingForMe,
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.scheduleRequest.findMany({
        where: pendingForMe,
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
    COMPENSATORY: "대체휴무", COMPENSATORY_HALF: "대체휴무반차", SICK: "병가", SPECIAL: "특별휴가",
    CIVIL_DEFENSE: "민방위", RESERVE_FORCES: "예비군훈련", FAMILY_EVENT: "경조사",
    FAMILY_MARRIAGE: "결혼", FAMILY_BIRTH: "출산", FAMILY_BEREAVEMENT: "사망(조사)",
  };
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

  // 휴가 취소 결재 — 결재함(/api/leave/cancel-requests/my-approvals)과 같은 기준(본인 요청 제외)
  const [pendingLeaveCancel, pendingCancelItems] = await Promise.all([
    prisma.leaveCancelRequest.count({ where: pendingForMe }),
    prisma.leaveCancelRequest.findMany({
      where: pendingForMe,
      include: {
        user: { select: { name: true } },
        leaveRequest: { select: { type: true, startDate: true, endDate: true, days: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

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
    ...pendingCancelItems.map((r) => ({
      id: r.id,
      type: "leaveCancel" as const,
      title: `휴가 취소 요청 · ${LEAVE_TYPE_LABEL[r.leaveRequest.type] ?? r.leaveRequest.type} ${fmt(r.leaveRequest.startDate)}~${fmt(r.leaveRequest.endDate)} (${r.leaveRequest.days}일)`,
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
    pending: { leave: pendingLeave, schedule: pendingSchedule, leaveCancel: pendingLeaveCancel },
    pendingItems,
    missingAttendance,
  });
}
