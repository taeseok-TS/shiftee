import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { calcStatus } from "@/lib/attendance-status";
import { WEEKDAY_CAP_MS, WEEKDAY_CAP_HOURS } from "@/lib/attendance-policy";
import { kstTodayDateUTC } from "@/lib/kst";

// 전일 미마감 근태 (2026-09-07 디렉터 지시)
//
// 근무가 10.5시간을 넘으면 직원은 앱에서 퇴근을 못 찍는다(주 52시간 방어). 종전에는 그걸로
// 끝이라 기록이 **영원히 열린 채** 남았다 — 실제로 14건이 최장 80일간 고착돼 있었다.
// 이제 다음 날 관리자가 확인을 누르면 **출근 + 10.5시간**으로 마감한다.
//
// 오늘 것은 대상이 아니다. 아직 퇴근하지 않았을 수 있다.

/** 미마감 목록 — 어제 이전에 출근만 있고 퇴근이 없는 기록 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const rows = await prisma.attendance.findMany({
    where: { clockIn: { not: null }, clockOut: null, date: { lt: kstTodayDateUTC() } },
    select: {
      id: true, date: true, clockIn: true,
      user: { select: { name: true, branch: true } },
    },
    orderBy: { date: "asc" },
  });

  return NextResponse.json({
    capHours: WEEKDAY_CAP_HOURS,
    count: rows.length,
    records: rows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      name: r.user.name,
      branch: r.user.branch,
      clockIn: r.clockIn,
      // 마감하면 찍힐 퇴근 시각 — 누르기 전에 보여준다
      willClockOut: new Date(r.clockIn!.getTime() + WEEKDAY_CAP_MS),
    })),
  });
}

/** 마감 — 출근 + 10.5시간으로 퇴근을 찍는다. id 를 주면 그 건만, 없으면 전부. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 마감할 수 있습니다." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : null;

  const rows = await prisma.attendance.findMany({
    where: {
      clockIn: { not: null }, clockOut: null, date: { lt: kstTodayDateUTC() },
      ...(ids && ids.length ? { id: { in: ids } } : {}),
    },
    select: { id: true, userId: true, date: true, clockIn: true, user: { select: { name: true } } },
  });
  if (rows.length === 0) return NextResponse.json({ success: true, closed: 0 });

  let closed = 0;
  for (const r of rows) {
    const clockOut = new Date(r.clockIn!.getTime() + WEEKDAY_CAP_MS);
    const dateYmd = r.date.toISOString().slice(0, 10);
    const status = await calcStatus(r.clockIn, clockOut, dateYmd, r.userId);
    // ⚠ 조건부로 쓴다. 그 사이 직원이 찍었거나 관리자가 고쳤으면 덮어쓰지 않는다.
    const w = await prisma.attendance.updateMany({
      where: { id: r.id, clockOut: null },
      data: { clockOut, status },
    });
    if (w.count === 0) continue;
    closed++;
    // ⚠ 근태는 급여 근거다. 누가 언제 무엇을 마감했는지 반드시 남긴다 —
    //   기존 auto-fill 은 이 기록이 없어 "9시간짜리 근무 8건"이 누가 만든 것인지 알 수 없다.
    await logAudit({
      actorId: session.userId, actorName: session.name, action: "ATTENDANCE_AUTO_CLOSE",
      targetType: "Attendance", targetId: r.id, targetName: r.user.name,
      detail: `${dateYmd} 미마감 → 출근 +${WEEKDAY_CAP_HOURS}시간으로 마감 (${clockOut.toISOString()})`,
    }).catch(() => {});
  }
  return NextResponse.json({ success: true, closed, capHours: WEEKDAY_CAP_HOURS });
}
