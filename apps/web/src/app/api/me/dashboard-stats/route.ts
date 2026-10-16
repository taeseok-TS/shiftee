import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currentLeaveYear } from "@/lib/leave-calc";

// 개인 대시보드 통계 (모든 역할: 본인 데이터만)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [balance, pendingContracts, pendingLeave, pendingSchedule, monthAttendance] =
    await Promise.all([
      // 나의 휴가 잔여 (현재 연도)
      prisma.leaveBalance.findUnique({
        where: { userId_year: { userId: session.userId, year: currentLeaveYear() } },
      }),

      // 서명 대기 계약 — **내 서명 차례가 온 것만**(2026-10-16 E1). 상태 SENT 로 세면 본부 서명 전(차례 전) 문서까지 세어
      //   목록은 비었는데 「서명 대기 1건」이 뜨고, 반대로 내 차례에 APPROVED 가 된 문서는 빠졌다
      prisma.contractApprovalStep.count({
        where: { approverId: session.userId, status: "PENDING", approvalLine: { contract: { userId: session.userId, status: { in: ["SENT", "APPROVED"] } } } },
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

  // 내가 올린 휴가 취소 결재(대기)도 "내가 신청한 대기 결재"에 넣는다 — 결재자 쪽 숫자와 짝(9/11)
  const pendingLeaveCancel = await prisma.leaveCancelRequest.count({ where: { userId: session.userId, status: "PENDING" } });

  const monthMinutes = monthAttendance.reduce((acc, r) => {
    if (!r.clockIn || !r.clockOut) return acc;
    return acc + Math.max(0, (new Date(r.clockOut).getTime() - new Date(r.clockIn).getTime()) / 60000);
  }, 0);

  // 그해 잔여 기록이 없으면 휴가 화면·신청 검사와 **같은 함수**로 근속 기준 총연차를 낸다.
  // 종전엔 기록이 없으면 15일로 보여 줘 화면마다 잔여가 달랐다(2026-10-06 QA 조사).
  // 잔여 숫자 숨김(2026-10-16 #219-1) — 직원·원장은 「잔여 연차 숫자 보기」가 켜졌을 때만 숫자, 아니면 null + balanceHidden(화면 「연차 정리 중」)
  const { canSeeLeaveBalance } = await import("@/lib/permission-settings");
  const visible = await canSeeLeaveBalance(session.role);
  const { yearBalanceFor } = await import("@/lib/leave-balance");
  const leaveRemaining = !visible
    ? null
    : balance
    ? balance.remaining
    : ((await yearBalanceFor(prisma, session.userId, currentLeaveYear()))?.remaining ?? 0);

  return NextResponse.json({
    leaveRemaining,
    balanceHidden: !visible,
    pendingContracts,
    pendingApprovals: pendingLeave + pendingSchedule + pendingLeaveCancel,
    monthWorkHours: Math.round((monthMinutes / 60) * 10) / 10,
  });
}
