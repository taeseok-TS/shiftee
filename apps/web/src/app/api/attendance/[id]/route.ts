import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { calcStatus } from "@/lib/attendance-status";
import { personLabelOf, recordAttendanceEdit } from "@/lib/attendance-edit";

// KST "HH:mm" 표기 (감사 로그용)
const fmtKst = (d: Date | null) =>
  d ? new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16) : "-";

// 출퇴근 기록 수동 수정 (관리자 전용)
// body: { clockIn?: string | null, clockOut?: string | null, reason?: string }
//  - reason: 수정 사유(300자). 수정 이력(AttendanceEdit)에 원래 시각과 함께 남는다(#219-15)
//  - undefined: 변경 없음 / null: 삭제 / 문자열: ISO 8601 (오프셋 포함 권장, 예: 2026-07-01T09:00:00+09:00)
// GPS 좌표는 실측 값이므로 건드리지 않는다 (수정 사실은 감사 로그가 증명)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "출퇴근 수정은 관리자만 가능합니다." }, { status: 403 });

  const { id } = await params;
  const record = await prisma.attendance.findUnique({
    where: { id },
    include: { user: { select: { name: true } } },
  });
  if (!record) return NextResponse.json({ error: "출퇴근 기록을 찾을 수 없습니다." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parse = (v: unknown, cur: Date | null): Date | null | "invalid" => {
    if (v === undefined) return cur;
    if (v === null) return null;
    const d = new Date(String(v));
    if (isNaN(d.getTime())) return "invalid";
    // 화면은 출근·퇴근을 늘 「HH:mm」으로 함께 보낸다 — 같은 분이면 안 바꾼 칸으로 본다(실제 찍힌 초를 지우지 않게, 검증 1)
    if (cur && Math.floor(d.getTime() / 60000) === Math.floor(cur.getTime() / 60000)) return cur;
    return d;
  };
  const newIn = parse(body.clockIn, record.clockIn);
  const newOut = parse(body.clockOut, record.clockOut);

  if (newIn === "invalid" || newOut === "invalid")
    return NextResponse.json({ error: "시각 형식이 올바르지 않습니다." }, { status: 400 });
  if (!newIn && !newOut)
    return NextResponse.json({ error: "출근·퇴근을 모두 비울 수는 없습니다. (기록 삭제는 지원하지 않음)" }, { status: 400 });
  if (newIn && newOut && newOut < newIn)
    return NextResponse.json({ error: "퇴근 시각이 출근 시각보다 빠릅니다." }, { status: 400 });
  // 자정 넘긴 퇴근을 받으면서 「18:00 을 08:00 으로」 같은 오타가 23시간 기록이 되지 않게 — 16시간 넘으면 되묻는다(재검증 ①)
  if (newIn && newOut && +newOut - +newIn > 16 * 3600_000)
    return NextResponse.json({ error: "출근부터 퇴근까지 16시간이 넘습니다. 퇴근 시각을 확인해 주세요." }, { status: 400 });

  const dateYmd = record.date.toISOString().slice(0, 10);
  const status = await calcStatus(newIn, newOut, dateYmd, record.userId);

  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  // 근로감독 때 「고친 이유」를 보여 줘야 해서 서버도 사유를 꼭 받는다(#219-15, 검증 2)
  if (!reason) return NextResponse.json({ error: "수정 사유를 입력해 주세요." }, { status: 400 });
  // 출퇴근 누락 보정(대시보드·출퇴근 현황 「확인 필요」, missingFix) — 그날 직원이 올린 출퇴근 요청이 결재 대기면 막는다.
  // 보정해 버리면 그 요청 승인이 「이미 퇴근 기록이 있습니다」로 막힌다(옛 auto-fill 의 409 와 같은 규칙, 10/22 검증 5)
  if (body.missingFix === true) {
    const pendingReq = await prisma.attendanceRequest.findFirst({
      where: { userId: record.userId, workDate: record.date, status: "PENDING", kind: { not: "DEVICE" } },
      select: { id: true },
    });
    if (pendingReq) return NextResponse.json({ error: "그날 직원이 올린 출퇴근 요청이 결재 대기 중입니다. 결재 › 결재함에서 처리해 주세요." }, { status: 409 });
  }
  const editorName = await personLabelOf(session.userId, session.name);

  // 기록과 수정 이력을 한 트랜잭션으로 — 이력 없이 시각만 바뀌는 일이 없게(#219-15)
  const attendance = await prisma.$transaction(async (tx) => {
    if (body.missingFix === true && await tx.attendanceRequest.findFirst({
      where: { userId: record.userId, workDate: record.date, status: "PENDING", kind: { not: "DEVICE" } }, select: { id: true },
    })) return "PENDING_REQUEST" as const;
    // 연 뒤에 다른 쓰기(요청 승인 등)가 끼었으면 덮어쓰지 않는다 — 읽은 그 값일 때만 쓴다(검증 5, 재검증)
    const hit = await tx.attendance.updateMany({
      where: { id, clockIn: record.clockIn, clockOut: record.clockOut },
      data: {
        clockIn: newIn, clockOut: newOut, status,
        // 시각을 바꾼 칸은 장소도 「본부 수정」으로 — 옛 「지점 밖 …」 문구가 남아 오해를 사지 않게(2026-10-07 #36)
        ...(+(newIn ?? 0) !== +(record.clockIn ?? 0) ? { clockInPlace: newIn ? "본부 수정" : null } : {}),
        ...(+(newOut ?? 0) !== +(record.clockOut ?? 0) ? { clockOutPlace: newOut ? "본부 수정" : null } : {}),
      },
    });
    if (hit.count === 0) return null;
    const updated = await tx.attendance.findUniqueOrThrow({ where: { id } });
    await recordAttendanceEdit(tx, {
      attendanceId: id, userId: record.userId, workDate: record.date, kind: "ADMIN_EDIT",
      before: { clockIn: record.clockIn, clockOut: record.clockOut, status: record.status },
      after: { clockIn: newIn, clockOut: newOut, status },
      reason, editorId: session.userId, editorName,
    });
    return updated;
  });
  if (attendance === "PENDING_REQUEST")
    return NextResponse.json({ error: "그날 직원이 올린 출퇴근 요청이 결재 대기 중입니다. 결재 › 결재함에서 처리해 주세요." }, { status: 409 });
  if (!attendance)
    return NextResponse.json({ error: "그 사이 이 기록이 바뀌었습니다(요청 승인 등). 새로고침한 뒤 다시 수정해 주세요." }, { status: 409 });

  await logAudit({
    actorId: session.userId,
    actorName: session.name,
    action: "ATTENDANCE_EDIT",
    targetType: "Attendance",
    targetId: id,
    targetName: record.user.name,
    detail: `${record.user.name} ${dateYmd} 출근 ${fmtKst(record.clockIn)}→${fmtKst(newIn)}, 퇴근 ${fmtKst(record.clockOut)}→${fmtKst(newOut)} (${status})${reason ? ` · 사유: ${reason}` : ""}`,
  });

  // 자정 넘는 근무 기록이 기존 데이터에 존재하므로 날짜 불일치는 거부하지 않고 경고만
  const kstDate = (d: Date) => new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const warning =
    (newIn && kstDate(newIn) !== dateYmd) || (newOut && kstDate(newOut) !== dateYmd)
      ? "입력한 시각이 기록 날짜와 다른 날입니다. (야간 근무가 아니라면 확인해주세요)"
      : undefined;

  return NextResponse.json({ success: true, attendance, warning });
}
