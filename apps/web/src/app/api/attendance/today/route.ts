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

  return NextResponse.json({
    clockedIn: !!att?.clockIn,
    clockedOut: !!att?.clockOut,
    clockInAt: att?.clockIn ?? null,
    clockOutAt: att?.clockOut ?? null,
  });
}
