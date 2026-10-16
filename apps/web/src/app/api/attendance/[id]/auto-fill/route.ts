import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { autoCloseTime, autoOpenTime, statusForAutoFill, type AutoFillBasis } from "@/lib/attendance-policy";

// 출퇴근 누락 자동 보정
// - 퇴근 누락(출근O 퇴근X): 퇴근 = 그날 근무일정 퇴근 시각 (없으면 출근 + 보정 시간)
// - 출근 누락(출근X 퇴근O): 출근 = 그날 근무일정 출근 시각 (없으면 퇴근 - 보정 시간)
// 기준은 「전일 미마감」과 같은 한 함수(lib/attendance-policy autoCloseTime·autoOpenTime, 2026-10-16 #219-4).
// 보정 시간(일정 없는 날 대체값)은 관리자 환경설정에서 30분 단위로 정한다(기본 9시간, 2026-09-07).
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

  const dateYmd = record.date.toISOString().slice(0, 10);

  // 그 날 직원이 올린 출퇴근 요청(퇴근 처리·기록 수정·지점 밖 등)이 대기 중이면 보정하지 않는다 — 결재로 처리한다.
  // 보정해 버리면 그 요청 승인이 「이미 퇴근 기록이 있습니다」로 막힌다(2026-10-16 #219-4).
  const pendingReq = await prisma.attendanceRequest.findFirst({
    where: { userId: record.userId, workDate: record.date, status: "PENDING", kind: { not: "DEVICE" } },
    select: { id: true },
  });
  if (pendingReq)
    return NextResponse.json({ error: "직원이 올린 출퇴근 요청이 결재 대기 중입니다. 출퇴근 관리의 요청 결재에서 처리해 주세요." }, { status: 409 });

  let clockIn = record.clockIn;
  let clockOut = record.clockOut;
  let mode: "out" | "in";
  let label: string;
  let basis: AutoFillBasis;

  if (clockIn && !clockOut) {
    // 퇴근 누락 → 근무일정 퇴근 시각(없으면 출근 + 보정 시간)
    const r = await autoCloseTime(record.userId, dateYmd, clockIn);
    clockOut = r.at; label = r.label; basis = r.basis;
    mode = "out";
  } else if (!clockIn && clockOut) {
    // 출근 누락 → 근무일정 출근 시각(없으면 퇴근 - 보정 시간)
    const r = await autoOpenTime(record.userId, dateYmd, clockOut);
    clockIn = r.at; label = r.label; basis = r.basis;
    mode = "in";
  } else {
    return NextResponse.json(
      { error: "출근/퇴근이 모두 기록되어 있거나 둘 다 없는 기록입니다." },
      { status: 400 }
    );
  }

  // 상태 재계산 — 공용 판정 함수 (지각/조퇴, 공휴일 제외, 한국시간 기준)
  // 시스템이 상한·퇴근 가능 시각으로 잘라 넣은 시각은 조퇴(출근 쪽은 지각)로 판정하지 않는다(2026-10-17 검증 F4)
  const status = await statusForAutoFill(clockIn!, clockOut!, dateYmd, record.userId, mode, basis);

  // ⚠ 조건부로 쓴다 — 그 사이 직원이 수정 요청 승인·본인 동의 등으로 채웠으면 덮어쓰지 않는다(전일 미마감과 같은 규칙)
  const w = await prisma.attendance.updateMany({
    where: {
      id, ...(mode === "out" ? { clockOut: null } : { clockIn: null }),
      // 위 확인과 쓰기 사이에 요청이 올라와도 덮지 않게 — 같은 UPDATE 조건으로 다시 본다(2026-10-17 검증 P3)
      user: { attendanceRequests: { none: { workDate: record.date, status: "PENDING", kind: { not: "DEVICE" } } } },
    },
    data: { clockIn, clockOut, status },
  });
  if (w.count === 0) return NextResponse.json({ error: "이미 처리된 기록입니다. 화면을 새로고침해 주세요." }, { status: 409 });
  const updated = await prisma.attendance.findUnique({ where: { id } });

  // ⚠ 근태는 급여 근거다. 누가 언제 무엇을 보정했는지 반드시 남긴다 (2026-09-07 디렉터 지시).
  //   종전에는 이 라우트만 logAudit 이 없어, DB 에 남은 "정확히 9시간짜리 근무" 8건이
  //   누가 만든 것인지 알 수 없었다. 형제 라우트(생성.수정)는 모두 남기고 있었다.
  const who = await prisma.user.findUnique({ where: { id: record.userId }, select: { name: true } });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "ATTENDANCE_AUTO_FILL",
    targetType: "Attendance", targetId: id, targetName: who?.name ?? record.userId,
    detail: `${dateYmd} ${mode === "out" ? "퇴근" : "출근"} 보정`
      + ` (${label}) → 출근 ${clockIn!.toISOString()} / 퇴근 ${clockOut!.toISOString()}`,
  }).catch(() => {});

  return NextResponse.json({ success: true, mode, basis: label, attendance: updated });
}
