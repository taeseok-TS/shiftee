import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { isRealDate } from "@/lib/schedule-payload";
import { mondayOf, weeklyMinutes, WEEK_LIMIT_MIN } from "@/lib/weekly-hours";

export const dynamic = "force-dynamic";

// 주간 근로시간(근무일정·실제, 휴게 제외) — 근무일정 주간 표의 49시간 빨간 표시용(2026-10-07 QA #38)
// GET ?week=YYYY-MM-DD(그 주 아무 날) → { monday, limitMin, hours: { [userId]: { sched, actual } } } (분)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGER") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const week = new URL(request.url).searchParams.get("week") || "";
  if (!isRealDate(week)) return NextResponse.json({ error: "날짜를 확인해 주세요." }, { status: 400 });
  const monday = mondayOf(week);
  const [y, m, d] = monday.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, d)), to = new Date(Date.UTC(y, m - 1, d + 6));

  // 그 주에 일정이나 출퇴근이 있는 사람만(원장은 담당 지점 직원만)
  const scope = session.role === "MANAGER" ? { branch: { in: await getManagerBranches(session.userId) } } : {};
  const [s, a] = await Promise.all([
    prisma.schedule.findMany({ where: { date: { gte: from, lte: to }, type: "WORK", user: scope }, select: { userId: true }, distinct: ["userId"] }),
    prisma.attendance.findMany({ where: { date: { gte: from, lte: to }, user: scope }, select: { userId: true }, distinct: ["userId"] }),
  ]);
  const ids = [...new Set([...s, ...a].map((x) => x.userId))];
  const mins = await weeklyMinutes(ids, [monday]);
  const hours: Record<string, { sched: number; actual: number }> = {};
  for (const [key, v] of mins) hours[key.split("|")[0]] = v;
  return NextResponse.json({ monday, limitMin: WEEK_LIMIT_MIN, hours });
}
