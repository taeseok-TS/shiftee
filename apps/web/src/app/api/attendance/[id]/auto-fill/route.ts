import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calcStatus } from "@/lib/attendance-status";
import { logAudit } from "@/lib/audit";
import { readAutoFillHours } from "@/lib/attendance-policy";

// 출퇴근 누락 자동 보정
// - 퇴실 누락(출근O 퇴근X): 퇴근 = 출근 + (설정 시간)
// - 입실 누락(출근X 퇴근O): 출근 = 퇴근 - (설정 시간)
// 보정 시간은 관리자 환경설정에서 30분 단위로 정한다(기본 9시간, 2026-09-07).
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  // 출퇴근 보정은 관리자(ADMIN) 전용 (직원/원장이 자신의 지각·미기록을 임의 보정하는 것 방지)
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "출퇴근 보정은 관리자만 가능합니다." }, { status: 403 });

  const { id } = await params;

  const record = await prisma.attendance.findUnique({
    where: { id },
  });
  if (!record) return NextResponse.json({ error: "출퇴근 기록을 찾을 수 없습니다." }, { status: 404 });

  const fillHours = await readAutoFillHours();
  const fillMs = fillHours * 60 * 60 * 1000;
  let clockIn = record.clockIn;
  let clockOut = record.clockOut;
  let mode: "out" | "in";

  if (clockIn && !clockOut) {
    // 퇴실 누락 → 퇴근 = 출근 + 설정 시간
    clockOut = new Date(clockIn.getTime() + fillMs);
    mode = "out";
  } else if (!clockIn && clockOut) {
    // 입실 누락 → 출근 = 퇴근 - 설정 시간
    clockIn = new Date(clockOut.getTime() - fillMs);
    mode = "in";
  } else {
    return NextResponse.json(
      { error: "출근/퇴근이 모두 기록되어 있거나 둘 다 없는 기록입니다." },
      { status: 400 }
    );
  }

  // 상태 재계산 — 공용 판정 함수 (지각/조퇴, 공휴일 제외, 한국시간 기준)
  const status = await calcStatus(clockIn, clockOut, record.date.toISOString().slice(0, 10), record.userId);

  const updated = await prisma.attendance.update({
    where: { id },
    data: { clockIn, clockOut, status },
  });

  // ⚠ 근태는 급여 근거다. 누가 언제 무엇을 보정했는지 반드시 남긴다 (2026-09-07 디렉터 지시).
  //   종전에는 이 라우트만 logAudit 이 없어, DB 에 남은 "정확히 9시간짜리 근무" 8건이
  //   누가 만든 것인지 알 수 없었다. 형제 라우트(생성.수정)는 모두 남기고 있었다.
  const who = await prisma.user.findUnique({ where: { id: record.userId }, select: { name: true } });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "ATTENDANCE_AUTO_FILL",
    targetType: "Attendance", targetId: id, targetName: who?.name ?? record.userId,
    detail: `${record.date.toISOString().slice(0, 10)} ${mode === "out" ? "퇴근" : "출근"} 보정`
      + ` (${fillHours}시간 기준) → 출근 ${clockIn!.toISOString()} / 퇴근 ${clockOut!.toISOString()}`,
  }).catch(() => {});

  return NextResponse.json({ success: true, mode, fillHours, attendance: updated });
}
