import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAllowed } from "@/lib/permission-settings";
import { canSeeClockTimes } from "@/lib/attendance-visibility";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { isRealDate } from "@/lib/schedule-payload";
import { mondayOf, weeklyMinutes, WEEK_LIMIT_MIN } from "@/lib/weekly-hours";

export const dynamic = "force-dynamic";

const WEEK_52_MIN = 52 * 60;

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
  // 본부가 「원장 지점 출퇴근 기록 열람」을 끄면(권한 설정 #39) 실제 근로시간은 내려보내지 않는다(10/14 검증 3)
  const actualHidden = session.role === "MANAGER" && !(await isAllowed("manager.viewAttendance"));
  // 주 근무시간 숫자는 본부만(2026-10-23 ■0-11) — 원장(「출퇴근 시각 보기」 끔)에게는 숫자 대신 일정 기준 「49시간 넘음 · 52시간 넘음」 여부만.
  // sched · actual 을 0 으로 두면 숫자 줄(WeekHoursLine)이 그려지지 않는다. 실제(출퇴근) 기준 여부는 보내지 않는다
  const hoursHidden = !(await canSeeClockTimes(session.role));
  const hours: Record<string, { sched: number; actual: number; over49?: boolean; over52?: boolean; week52?: "IN_52" | "OVER_52" }> = {};
  for (const [key, v] of mins) {
    const id = key.split("|")[0];
    hours[id] = hoursHidden
      ? { sched: 0, actual: 0, over49: v.sched > WEEK_LIMIT_MIN, over52: v.sched > WEEK_52_MIN, week52: v.sched > WEEK_52_MIN ? "OVER_52" : "IN_52" }
      : actualHidden ? { sched: v.sched, actual: 0 } : v;
  }
  return NextResponse.json({ monday, limitMin: WEEK_LIMIT_MIN, hours, actualHidden: actualHidden || hoursHidden, hoursHidden });
}
