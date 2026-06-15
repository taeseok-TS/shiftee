import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 원장(팀) 대시보드 통계 — 자기 지점 기준
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  // MANAGER는 자기 지점, ADMIN(테스트용)은 전체
  const branchWhere = session.role === "MANAGER" && session.branch ? { branch: session.branch } : {};
  const memberWhere = {
    role: { not: "ADMIN" as const },
    isActive: true,
    deletedAt: null,
    employmentStatus: "ACTIVE" as const,
    ...branchWhere,
  };

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  // 오늘 날짜 (UTC 자정 — @db.Date 컬럼과 동일 규칙)
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  const [teamCount, todayRecords, onLeave, pendingContracts, pendingLeaveSteps, pendingScheduleSteps, monthAbsent] =
    await Promise.all([
      // 팀 인원
      prisma.user.count({ where: memberWhere }),

      // 오늘 출퇴근 기록 (지점 직원)
      prisma.attendance.findMany({
        where: { date: today, user: memberWhere },
      }),

      // 오늘 휴가 중 (승인된 휴가, 지점 직원)
      prisma.leaveRequest.count({
        where: {
          status: "APPROVED",
          startDate: { lte: today },
          endDate: { gte: today },
          user: memberWhere,
        },
      }),

      // 대기 중인 계약 (지점 직원에게 발송되어 서명 대기 중)
      prisma.contract.count({
        where: { status: "SENT", user: memberWhere },
      }),

      // 내가 결재해야 할 휴가/근무일정 (지정 결재자 기준)
      prisma.leaveApprovalStep.count({
        where: { approverId: session.userId, status: "PENDING" },
      }),
      prisma.scheduleApprovalStep.count({
        where: { approverId: session.userId, status: "PENDING" },
      }),

      // 금월 결근자 (지점 직원, 중복 제거)
      prisma.attendance.findMany({
        where: {
          status: "ABSENT",
          date: { gte: monthStart, lte: monthEnd },
          user: memberWhere,
        },
        select: { userId: true },
        distinct: ["userId"],
      }),
    ]);

  // 오늘 근무 현황 집계
  const present = todayRecords.filter((r) => r.clockIn).length;
  const late = todayRecords.filter((r) => r.status === "LATE").length;
  const earlyLeave = todayRecords.filter((r) => r.status === "EARLY_LEAVE").length;
  const absent = Math.max(teamCount - present - onLeave, 0);

  return NextResponse.json({
    teamCount,
    attendance: { present, late, absent, earlyLeave, onLeave },
    pendingContracts,
    pendingApprovals: pendingLeaveSteps + pendingScheduleSteps,
    monthAbsent: monthAbsent.length,
  });
}
