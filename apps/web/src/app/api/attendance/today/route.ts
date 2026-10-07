import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { kstTodayDateUTC } from "@/lib/kst";

// 오늘 본인 출퇴근 상태 (앱 출퇴근 버튼 상태 결정용)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // clock-in과 동일하게 UTC 자정 기준
  const nowDate = new Date();
  const today = kstTodayDateUTC();

  const att = await prisma.attendance.findUnique({
    where: { userId_date: { userId: session.userId, date: today } },
    select: { clockIn: true, clockOut: true },
  });

  // 지점 밖·사진·본부 처리 요청이 승인 대기 중인지(2026-10-07 #9 #13) — 출근 요청 대기면 앱이 퇴근 버튼을 보여 준다
  const pending = await prisma.attendanceRequest.findMany({
    where: { userId: session.userId, workDate: today, status: "PENDING", action: { in: ["IN", "OUT"] } },
    select: { action: true },
  });

  return NextResponse.json({
    clockedIn: !!att?.clockIn,
    clockedOut: !!att?.clockOut,
    clockInAt: att?.clockIn ?? null,
    clockOutAt: att?.clockOut ?? null,
    pendingIn: pending.some((p) => p.action === "IN"),
    pendingOut: pending.some((p) => p.action === "OUT"),
  });
}
