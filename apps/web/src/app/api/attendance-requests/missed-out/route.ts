import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { kstTodayDateUTC } from "@/lib/kst";
import { consent22Eligibility, hasPendingOutRequest } from "@/lib/missed-out";

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
  // 퇴근 쪽 요청(누락·수정·지점 밖/사진/본부 퇴근)이 대기 중이면 다시 안내하지 않는다
  if (await hasPendingOutRequest(session.userId, att.date)) return NextResponse.json({ missed: null });
  // can22: 「22:00 퇴근으로 처리 동의」 자격(#215-4, lib/missed-out) — 평일 10.5시간 상한 안·주말/공휴일 아님·출근 22시 전. 아니면 사유를 함께 준다
  const ymd = att.date.toISOString().slice(0, 10);
  const elig = await consent22Eligibility(att.clockIn!, ymd);
  return NextResponse.json({ missed: { date: ymd, clockIn: att.clockIn, can22: elig.ok, can22Reason: elig.ok ? null : (elig.reason ?? null) } });
}
