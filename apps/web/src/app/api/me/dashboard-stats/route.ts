import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 개인 대시보드 통계 (모든 역할: 본인 데이터만)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [balance, pendingContracts, pendingLeave, pendingSchedule, monthAttendance] =
    await Promise.all([
      // 나의 휴가 잔여
      prisma.leaveBalance.findUnique({ where: { userId: session.userId } }),

      // 대기 중인 계약 (내게 발송되어 서명 대기 중)
      prisma.contract.count({
        where: { userId: session.userId, status: "SENT" },
      }),

      // 내가 신청한 결재 대기 (휴가 + 근무일정)
      prisma.leaveRequest.count({
        where: { userId: session.userId, status: "PENDING" },
      }),
      prisma.scheduleRequest.count({
        where: { userId: session.userId, status: "PENDING" },
      }),

      // 금월 근무 시간 (출퇴근 기록 기준)
      prisma.attendance.findMany({
        where: {
          userId: session.userId,
          date: { gte: monthStart, lte: monthEnd },
          clockIn: { not: null },
        },
        select: { clockIn: true, clockOut: true },
      }),
    ]);

  const monthMinutes = monthAttendance.reduce((acc, r) => {
    if (!r.clockIn || !r.clockOut) return acc;
    return acc + Math.max(0, (new Date(r.clockOut).getTime() - new Date(r.clockIn).getTime()) / 60000);
  }, 0);

  return NextResponse.json({
    leaveRemaining: balance?.remaining ?? 15,
    pendingContracts,
    pendingApprovals: pendingLeave + pendingSchedule,
    monthWorkHours: Math.round((monthMinutes / 60) * 10) / 10,
  });
}
