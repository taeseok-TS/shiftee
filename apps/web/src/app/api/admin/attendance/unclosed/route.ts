import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { autoCloseTime, autoFillSettings, statusForAutoFill, WEEKDAY_CAP_HOURS } from "@/lib/attendance-policy";
import { kstTodayDateUTC } from "@/lib/kst";

// 전일 미마감 근태 (2026-09-07 디렉터 지시)
//
// 근무가 10.5시간을 넘으면 직원은 앱에서 퇴근을 못 찍는다(주 52시간 방어). 종전에는 그걸로
// 끝이라 기록이 **영원히 열린 채** 남았다 — 실제로 14건이 최장 80일간 고착돼 있었다.
// 다음 날 관리자가 확인을 누르면 마감한다.
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
    where: { clockIn: { not: null }, clockOut: null, date: { lt: kstTodayDateUTC() } },
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

/** 마감 — 근무일정 퇴근 시각(없으면 출근 + 보정 시간)으로 퇴근을 찍는다. id 를 주면 그 건만, 없으면 전부. */
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

  const settings = await autoFillSettings();
  const pending = await pendingRequestKeys(rows);
  let closed = 0;
  let skipped = 0;
  for (const r of rows) {
    const dateYmd = r.date.toISOString().slice(0, 10);
    // ⚠ 직원이 「퇴근 처리 요청」·기록 수정 요청을 올려 둔 날은 마감하지 않는다(2026-10-16 #219-4).
    //   마감해 버리면 그 요청 승인이 「이미 퇴근 기록이 있습니다」로 막히고, 직원이 넣은 실제 시각이 묻힌다.
    if (pending.has(`${r.userId}:${dateYmd}`)) { skipped++; continue; }
    const close = await autoCloseTime(r.userId, dateYmd, r.clockIn!, settings);
    const clockOut = close.at;
    // 시스템이 상한·퇴근 가능 시각으로 자른 퇴근은 「조퇴」로 판정하지 않는다(2026-10-17 검증 F4)
    const status = await statusForAutoFill(r.clockIn!, clockOut, dateYmd, r.userId, "out", close.basis);
    // ⚠ 조건부로 쓴다. 그 사이 직원이 찍었거나 관리자가 고쳤으면 덮어쓰지 않는다.
    //   결재 대기 요청이 없는지도 **쓰는 그 문장 안에서** 다시 본다(2026-10-17 검증 P3 — 위 목록 조회와 쓰기 사이에
    //   직원이 요청을 올리면 마감이 요청을 덮었다). 한 UPDATE 의 조건이라 틈이 없다.
    const w = await prisma.attendance.updateMany({
      where: {
        id: r.id, clockOut: null,
        user: { attendanceRequests: { none: { workDate: r.date, status: "PENDING", kind: { not: "DEVICE" } } } },
      },
      data: { clockOut, status },
    });
    if (w.count === 0) {
      // 막 올라온 요청 때문이면 건너뜀으로 센다(아니면 그 사이 퇴근이 채워진 것)
      const p2 = await prisma.attendanceRequest.findFirst({ where: { userId: r.userId, workDate: r.date, status: "PENDING", kind: { not: "DEVICE" } }, select: { id: true } });
      if (p2) skipped++;
      continue;
    }
    closed++;
    // ⚠ 근태는 급여 근거다. 누가 언제 무엇을 마감했는지 반드시 남긴다 —
    //   기존 auto-fill 은 이 기록이 없어 "9시간짜리 근무 8건"이 누가 만든 것인지 알 수 없다.
    await logAudit({
      actorId: session.userId, actorName: session.name, action: "ATTENDANCE_AUTO_CLOSE",
      targetType: "Attendance", targetId: r.id, targetName: r.user.name,
      detail: `${dateYmd} 미마감 마감 (기준: ${close.label}) → 퇴근 ${clockOut.toISOString()}`,
    }).catch(() => {});
  }
  return NextResponse.json({ success: true, closed, skipped });
}

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
