import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const NINE_HOURS_MS = 9 * 60 * 60 * 1000;

// 출퇴근 누락 자동 보정
// - 퇴실 누락(출근O 퇴근X): 퇴근 = 출근 + 9시간
// - 입실 누락(출근X 퇴근O): 출근 = 퇴근 - 9시간
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { id } = await params;

  const record = await prisma.attendance.findUnique({
    where: { id },
    include: { user: { select: { branch: true } } },
  });
  if (!record) return NextResponse.json({ error: "출퇴근 기록을 찾을 수 없습니다." }, { status: 404 });

  // 원장은 자기 지점만 보정 가능
  if (session.role === "MANAGER" && record.user.branch !== session.branch) {
    return NextResponse.json({ error: "다른 지점 직원의 기록은 보정할 수 없습니다." }, { status: 403 });
  }

  let clockIn = record.clockIn;
  let clockOut = record.clockOut;
  let mode: "out" | "in";

  if (clockIn && !clockOut) {
    // 퇴실 누락 → 퇴근 = 출근 + 9시간
    clockOut = new Date(clockIn.getTime() + NINE_HOURS_MS);
    mode = "out";
  } else if (!clockIn && clockOut) {
    // 입실 누락 → 출근 = 퇴근 - 9시간
    clockIn = new Date(clockOut.getTime() - NINE_HOURS_MS);
    mode = "in";
  } else {
    return NextResponse.json(
      { error: "출근/퇴근이 모두 기록되어 있거나 둘 다 없는 기록입니다." },
      { status: 400 }
    );
  }

  // 상태 재계산: 지각(9시 이후 출근) 여부 + 조퇴(18시 이전 퇴근) 여부
  const isLate = clockIn.getHours() > 9 || (clockIn.getHours() === 9 && clockIn.getMinutes() > 0);
  const isEarlyLeave = clockOut.getHours() < 18;
  const status = isLate ? "LATE" : isEarlyLeave ? "EARLY_LEAVE" : "NORMAL";

  const updated = await prisma.attendance.update({
    where: { id },
    data: { clockIn, clockOut, status },
  });

  return NextResponse.json({ success: true, mode, attendance: updated });
}
