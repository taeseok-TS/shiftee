import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { calcStatus } from "@/lib/attendance-status";

// KST "HH:mm" 표기 (감사 로그용)
const fmtKst = (d: Date | null) =>
  d ? new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16) : "-";

// 출퇴근 기록 수동 수정 (관리자 전용)
// body: { clockIn?: string | null, clockOut?: string | null }
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
    return isNaN(d.getTime()) ? "invalid" : d;
  };
  const newIn = parse(body.clockIn, record.clockIn);
  const newOut = parse(body.clockOut, record.clockOut);

  if (newIn === "invalid" || newOut === "invalid")
    return NextResponse.json({ error: "시각 형식이 올바르지 않습니다." }, { status: 400 });
  if (!newIn && !newOut)
    return NextResponse.json({ error: "출근·퇴근을 모두 비울 수는 없습니다. (기록 삭제는 지원하지 않음)" }, { status: 400 });
  if (newIn && newOut && newOut < newIn)
    return NextResponse.json({ error: "퇴근 시각이 출근 시각보다 빠릅니다." }, { status: 400 });

  const dateYmd = record.date.toISOString().slice(0, 10);
  const status = await calcStatus(newIn, newOut, dateYmd);

  const attendance = await prisma.attendance.update({
    where: { id },
    data: { clockIn: newIn, clockOut: newOut, status },
  });

  await logAudit({
    actorId: session.userId,
    actorName: session.name,
    action: "ATTENDANCE_EDIT",
    targetType: "Attendance",
    targetId: id,
    targetName: record.user.name,
    detail: `${record.user.name} ${dateYmd} 출근 ${fmtKst(record.clockIn)}→${fmtKst(newIn)}, 퇴근 ${fmtKst(record.clockOut)}→${fmtKst(newOut)} (${status})`,
  });

  // 자정 넘는 근무 기록이 기존 데이터에 존재하므로 날짜 불일치는 거부하지 않고 경고만
  const kstDate = (d: Date) => new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const warning =
    (newIn && kstDate(newIn) !== dateYmd) || (newOut && kstDate(newOut) !== dateYmd)
      ? "입력한 시각이 기록 날짜와 다른 날입니다. (야간 근무가 아니라면 확인해주세요)"
      : undefined;

  return NextResponse.json({ success: true, attendance, warning });
}
