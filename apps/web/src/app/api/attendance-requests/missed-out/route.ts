import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { kstTodayDateUTC } from "@/lib/kst";

export const dynamic = "force-dynamic";

// 퇴근 누락 안내(2026-10-07 #15) — 오늘 이전 7일 안에서 가장 최근의 「출근만 있고 퇴근이 없는」 날.
// 그날 퇴근 누락·기록 수정 요청이 이미 대기 중이면 다시 안내하지 않는다. 앱이 출퇴근 화면을 열 때 부른다.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const today = kstTodayDateUTC();
  const att = await prisma.attendance.findFirst({
    where: {
      userId: session.userId,
      date: { lt: today, gte: new Date(today.getTime() - 7 * 86400_000) },
      clockIn: { not: null },
      clockOut: null,
    },
    orderBy: { date: "desc" },
    select: { date: true, clockIn: true },
  });
  if (!att) return NextResponse.json({ missed: null });
  const pending = await prisma.attendanceRequest.findFirst({
    where: { userId: session.userId, workDate: att.date, status: "PENDING", kind: { in: ["MISSED_OUT", "CORRECTION"] } },
    select: { id: true },
  });
  if (pending) return NextResponse.json({ missed: null });
  return NextResponse.json({ missed: { date: att.date.toISOString().slice(0, 10), clockIn: att.clockIn } });
}
