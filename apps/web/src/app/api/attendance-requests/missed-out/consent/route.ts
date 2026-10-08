import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { calcStatus } from "@/lib/attendance-status";
import { kstTodayDateUTC } from "@/lib/kst";
import { verifyAttendanceDevice } from "@/lib/device";
import { consent22Eligibility, clockOut22Of, hasPendingOutRequest } from "@/lib/missed-out";

export const dynamic = "force-dynamic";

// 전날 퇴근 누락 → 「22:00 퇴근으로 처리하는 데 동의」(2026-10-08 개선 제안 #215-4, 디렉터 채택)
//  · 본인 기록만, 오늘 이전 7일 안, 출근만 있고 퇴근이 없는 날
//  · 자격 규칙(lib/missed-out.ts): 평일 10.5시간 상한 안·주말/공휴일 아님·출근 22시 전·퇴근 쪽 요청 대기 없음 — 상한 우회 금지(76a0c00 검증 F1)
//  · 출퇴근 버튼과 같은 기기 검증(x-device-id) — 결재 없이 바로 기록되므로(F4)
//  · 동의한 사람·시각을 퇴근 장소 칸과 감사 기록에 남긴다. 22시가 아니면 보정 요청(AttendanceRequest CORRECTION)으로 고친다

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const deviceError = await verifyAttendanceDevice(session.userId, session.role, request.headers.get("x-device-id"));
  if (deviceError) return NextResponse.json({ error: deviceError }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { date?: unknown; agree?: unknown };
  const date = typeof body.date === "string" ? body.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "날짜가 올바르지 않습니다." }, { status: 400 });
  if (body.agree !== true) return NextResponse.json({ error: "22:00 퇴근 처리에 동의해야 합니다." }, { status: 400 });

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

  const elig = await consent22Eligibility(att.clockIn, date);
  if (!elig.ok) return NextResponse.json({ error: elig.reason ?? "22:00 퇴근으로 처리할 수 없습니다." }, { status: 400 });
  const clockOut = clockOut22Of(date);

  // 그 날 퇴근 쪽 요청(누락·수정·지점 밖/사진/본부 퇴근)이 대기 중이면 두 갈래로 처리되지 않게 막는다
  if (await hasPendingOutRequest(session.userId, workDate))
    return NextResponse.json({ error: "그 날 퇴근 처리 요청이 이미 대기 중입니다. 요청 결과를 기다려 주세요." }, { status: 409 });

  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
  const status = await calcStatus(att.clockIn, clockOut, date, session.userId);
  // ⚠ 조건부로 쓴다 — 그 사이 관리자가 마감했거나 직원이 다른 탭에서 눌렀으면 덮어쓰지 않는다
  const w = await prisma.attendance.updateMany({
    where: { id: att.id, clockOut: null },
    data: { clockOut, status, clockOutPlace: `22시 퇴근 처리 · 본인 동의 ${kst}` },
  });
  if (w.count === 0) return NextResponse.json({ error: "이미 처리된 기록입니다. 화면을 새로고침해 주세요." }, { status: 409 });

  await logAudit({
    actorId: session.userId, actorName: session.name, action: "ATTENDANCE_CLOSE_22",
    targetType: "Attendance", targetId: att.id, targetName: session.name,
    detail: `${session.name} ${date} 퇴근 누락 → 22:00 퇴근 처리 (본인 동의 ${kst} KST, 상태 ${status})`,
  });
  return NextResponse.json({ success: true, clockOut, status });
}
