import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { kstTodayDateUTC } from "@/lib/kst";
import { getManagerBranches } from "@/lib/manager-branches";
import { countableEmployeeWhere } from "@/lib/employee-scope";

// 원장(팀) 대시보드 통계 — 자기 지점 기준
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  // MANAGER는 담당 지점(대표+겸직), ADMIN(테스트용)은 전체
  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  // "통계 포함" 꺼진 지점(본부·테스트지점)은 팀 인원에서 뺀다
  // 결재함(my-approvals)과 **같은 조건**을 쓴다 — 숫자와 목록이 어긋나면 안 된다.
  // 지정 결재자로 못박힌 건 + 내 담당 지점의 (못박히지 않은) 원장 단계.
  const approvalStepWhere = {
    status: "PENDING" as const,
    OR: [
      { approverId: session.userId },
      ...(session.role === "MANAGER"
        ? [{ approverRole: "MANAGER", branch: { in: myBranches }, approverId: null }]
        : []),
    ],
  };

  const memberWhere = await countableEmployeeWhere(
    session.role === "MANAGER" ? { branches: myBranches } : {}
  );

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  // 오늘 날짜 (UTC 자정 — @db.Date 컬럼과 동일 규칙)
  const today = kstTodayDateUTC();

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

      // 내가 결재해야 할 휴가/근무일정.
      // ⚠ 결재함(my-approvals)과 **같은 조건**이어야 한다. 종전에는 지정 결재자만 세서
      //   역할.지점 기반 단계가 빠졌고, 실제로 대기 중인데 화면에는 **0건**으로 떴다
      //   (2026-09-09 검증에서 라이브 실측 — 주예나 2건, 김원장 1건이 안 보였다).
      prisma.leaveApprovalStep.count({ where: { ...approvalStepWhere } }),
      prisma.scheduleApprovalStep.count({ where: { ...approvalStepWhere } }),

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
