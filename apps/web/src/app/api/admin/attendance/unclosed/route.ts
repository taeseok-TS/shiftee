import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { autoCloseTime, autoFillSettings, WEEKDAY_CAP_HOURS } from "@/lib/attendance-policy";
import { kstTodayDateUTC } from "@/lib/kst";

// 전일 미마감 근태 (2026-09-07 디렉터 지시)
//
// 근무가 10.5시간을 넘으면 직원은 앱에서 퇴근을 못 찍는다(주 52시간 방어). 종전에는 그걸로
// 끝이라 기록이 **영원히 열린 채** 남았다 — 실제로 14건이 최장 80일간 고착돼 있었다.
// 다음 날 관리자가 목록을 보고 한 건씩 보정한다(10/23 — 한꺼번에 마감은 없앴다, 아래).
//
// 2026-10-16 #219-4 (디렉터 결정): 마감 시각은 대시보드 누락 보정과 **같은 기준**이다 —
//   그날 근무일정의 퇴근 시각, 일정이 없으면 출근 + 보정 시간(기본 9시간), 상한을 넘으면 상한으로 자른다
//   (lib/attendance-policy autoCloseTime). 종전에는 언제나 출근 + 10.5시간이라 13:00~22:00 일정 직원이
//   13:20 출근하면 23:50 퇴근으로 기록됐다.
//
// 오늘 것은 대상이 아니다. 아직 퇴근하지 않았을 수 있다.

/** 미마감 목록 — 어제 이전에 출근만 있고 퇴근이 없는 기록 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const rows = await prisma.attendance.findMany({
    where: { clockIn: { not: null }, clockOut: null, date: { lt: kstTodayDateUTC() }, importBatch: null },   // 시프티에서 옮긴 기록은 마감하지 않는다(원본 보관)
    select: {
      id: true, userId: true, date: true, clockIn: true,
      user: { select: { name: true, branch: true } },
    },
    orderBy: { date: "asc" },
  });

  const settings = await autoFillSettings();
  const { fallbackHours } = settings;
  const pending = await pendingRequestKeys(rows);
  const records = [];
  for (const r of rows) {
    const date = r.date.toISOString().slice(0, 10);
    // 마감하면 찍힐 퇴근 시각 — 누르기 전에 보여준다(마감 POST 와 같은 함수)
    const close = await autoCloseTime(r.userId, date, r.clockIn!, settings);
    records.push({
      // 직원이 올린 퇴근 처리·수정 요청이 대기 중 — 마감하지 않고 결재를 기다린다
      pendingRequest: pending.has(`${r.userId}:${date}`),
      id: r.id,
      date,
      name: r.user.name,
      branch: r.user.branch,
      clockIn: r.clockIn,
      willClockOut: close.at,
      basis: close.basis,
      basisLabel: close.label,
      schedule: close.schedule,
    });
  }

  return NextResponse.json({
    capHours: WEEKDAY_CAP_HOURS,
    fallbackHours,
    count: rows.length,
    records,
  });
}

// 한꺼번에 마감(POST)은 없앴다(2026-10-23 본부 — 근로감독 대비, 임의 값 자동 입력 금지).
// 미마감은 출퇴근 현황 줄마다 「보정」(MissingFixDialog → PATCH /api/attendance/[id], 사유 필수 · 고친 사람 실명)으로 한 건씩.

/** 그 날 대기 중인 출퇴근 요청(기기 변경 제외)이 있는 「사람:날짜」 */
async function pendingRequestKeys(rows: { userId: string; date: Date }[]): Promise<Set<string>> {
  if (rows.length === 0) return new Set();
  const reqs = await prisma.attendanceRequest.findMany({
    where: {
      status: "PENDING",
      kind: { not: "DEVICE" },
      OR: rows.map((r) => ({ userId: r.userId, workDate: r.date })),
    },
    select: { userId: true, workDate: true },
  });
  return new Set(reqs.map((q) => `${q.userId}:${q.workDate.toISOString().slice(0, 10)}`));
}
