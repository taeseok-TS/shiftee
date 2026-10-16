import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { statusForAutoFill } from "@/lib/attendance-policy";
import { kstTodayDateUTC } from "@/lib/kst";
import { verifyAttendanceDevice } from "@/lib/device";
import { consentEligibility, hasPendingOutRequest, kstHhmm } from "@/lib/missed-out";

export const dynamic = "force-dynamic";

// 전날 퇴근 누락 → 「근무일정 퇴근 시각으로 처리하는 데 동의」(2026-10-08 개선 제안 #215-4, 디렉터 채택 · 10-17 기준 변경)
//  · 본인 기록만, 오늘 이전 7일 안, 출근만 있고 퇴근이 없는 날
//  · 기록될 시각 = 관리자 자동 마감과 같은 함수(lib/attendance-policy autoCloseTime — 근무일정 퇴근 시각, 없으면 출근 + 보정 시간,
//    상한·퇴근 가능 시각·23:59 에서 자름). 종전 22:00 고정(2026-10-17 디렉터 결정 #219-4)
//  · 자격 규칙(lib/missed-out.ts): 잘라 넣어야 하는 시각(상한 초과)이면 불가·퇴근 쪽 요청 대기 없음 — 상한 우회 금지(76a0c00 검증 F1)
//  · 앱이 본 시각(expectAt)과 지금 계산한 시각이 다르면 기록하지 않는다 — 직원이 보지 않은 시각에 동의한 것이 되지 않게.
//    구버전 앱(expectAt 없음, 화면에 「22:00」)은 계산값이 22:00 일 때만 받는다
//  · 출퇴근 버튼과 같은 기기 검증(x-device-id) — 결재 없이 바로 기록되므로(F4)
//  · 동의한 사람·시각·기준을 퇴근 장소 칸과 감사 기록에 남긴다. 실제와 다르면 보정 요청(AttendanceRequest CORRECTION)으로 고친다

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const deviceError = await verifyAttendanceDevice(session.userId, session.role, request.headers.get("x-device-id"));
  if (deviceError) return NextResponse.json({ error: deviceError }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { date?: unknown; agree?: unknown; expectAt?: unknown };
  const date = typeof body.date === "string" ? body.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "날짜가 올바르지 않습니다." }, { status: 400 });
  if (body.agree !== true) return NextResponse.json({ error: "퇴근 처리에 동의해야 합니다." }, { status: 400 });

  const today = kstTodayDateUTC();
  const workDate = new Date(`${date}T00:00:00Z`);
  if (!(workDate < today) || workDate < new Date(today.getTime() - 7 * 86400_000))
    return NextResponse.json({ error: "오늘 이전 7일 안의 날짜만 처리할 수 있습니다." }, { status: 400 });

  const att = await prisma.attendance.findUnique({
    where: { userId_date: { userId: session.userId, date: workDate } },
    select: { id: true, clockIn: true, clockOut: true },
  });
  if (!att || !att.clockIn) return NextResponse.json({ error: "그 날 출근 기록이 없습니다." }, { status: 404 });
  if (att.clockOut) return NextResponse.json({ error: "이미 퇴근이 기록된 날입니다." }, { status: 409 });

  const elig = await consentEligibility(session.userId, att.clockIn, date);
  if (!elig.ok) return NextResponse.json({ error: elig.reason ?? "본인 동의로 처리할 수 없습니다." }, { status: 400 });
  const clockOut = elig.close.at;
  const hhmm = kstHhmm(clockOut);

  // 앱이 보여 준 시각과 같은지 — 그 사이 근무일정·설정이 바뀌었으면 다시 보게 한다
  const expect = typeof body.expectAt === "string" ? new Date(body.expectAt) : null;
  const hasExpect = !!expect && !Number.isNaN(expect.getTime());
  const mismatch = hasExpect ? expect!.getTime() !== clockOut.getTime() : hhmm !== "22:00";   // 구버전 앱은 「22:00」을 보여 줬다
  if (mismatch)
    return NextResponse.json({
      error: `처리될 퇴근 시각이 ${hhmm}(${elig.close.label})입니다. 화면을 새로고침해 다시 확인해 주세요.`,
      closeAt: clockOut, closeLabel: elig.close.label,
    }, { status: 409 });

  // 그 날 퇴근 쪽 요청(누락·수정·지점 밖/사진/본부 퇴근)이 대기 중이면 두 갈래로 처리되지 않게 막는다
  if (await hasPendingOutRequest(session.userId, workDate))
    return NextResponse.json({ error: "그 날 퇴근 처리 요청이 이미 대기 중입니다. 요청 결과를 기다려 주세요." }, { status: 409 });

  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
  const status = await statusForAutoFill(att.clockIn, clockOut, date, session.userId, "out", elig.close.basis);
  // ⚠ 조건부로 쓴다 — 그 사이 관리자가 마감했거나 직원이 다른 탭에서 눌렀으면 덮어쓰지 않는다
  const w = await prisma.attendance.updateMany({
    where: { id: att.id, clockOut: null },
    data: { clockOut, status, clockOutPlace: `${hhmm} 퇴근 처리(${elig.close.label}) · 본인 동의 ${kst}` },
  });
  if (w.count === 0) return NextResponse.json({ error: "이미 처리된 기록입니다. 화면을 새로고침해 주세요." }, { status: 409 });

  await logAudit({
    actorId: session.userId, actorName: session.name, action: "ATTENDANCE_CLOSE_22",   // 액션 이름은 기존 기록과 맞춰 그대로 둔다
    targetType: "Attendance", targetId: att.id, targetName: session.name,
    detail: `${session.name} ${date} 퇴근 누락 → ${hhmm} 퇴근 처리 (기준: ${elig.close.label}, 본인 동의 ${kst} KST, 상태 ${status})`,
  });
  return NextResponse.json({ success: true, clockOut, closeHhmm: hhmm, closeLabel: elig.close.label, status });
}
