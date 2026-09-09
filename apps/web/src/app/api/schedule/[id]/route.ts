import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { asHhmm, asScheduleType, toMin } from "@/lib/schedule-payload";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { id } = await params;
  // ⚠ 종전에는 소유자.지점 검사가 아예 없어, 원장이 id 만 알면 남의 지점 직원의 승인된
  //   주말 일정을 지울 수 있었다(그러면 그 직원은 그날 출근이 막힌다).
  const target = await prisma.schedule.findUnique({ where: { id }, select: { userId: true } });
  if (!target) return NextResponse.json({ error: "일정을 찾을 수 없습니다." }, { status: 404 });
  const { guardScheduleChange } = await import("@/lib/schedule-guard");
  const denied = await guardScheduleChange(session, target.userId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  await prisma.schedule.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { id } = await params;
  const { startTime, endTime, type, note } = await request.json();

  // 시간대를 바꾸면 퇴근 상한이 따라 바뀐다 — 소유자.지점 검사가 반드시 필요하다.
  const target = await prisma.schedule.findUnique({ where: { id }, select: { userId: true } });
  if (!target) return NextResponse.json({ error: "일정을 찾을 수 없습니다." }, { status: 404 });
  const { guardScheduleChange } = await import("@/lib/schedule-guard");
  const denied = await guardScheduleChange(session, target.userId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // ⚠ 등록(POST)과 **같은 기준**으로 검사한다. 종전에는 여기만 검증이 없어서,
  //   00:00~23:59 로 고치면 지각.조퇴 판정과 퇴근 상한이 동시에 무력화됐다
  //   (schedule-guard 주석이 경고한 그 경로 — 2026-09-09 검증에서 적발).
  const st = asHhmm(startTime), et = asHhmm(endTime);
  if (!st || !et) {
    return NextResponse.json({ error: "근무 시간 형식이 올바르지 않습니다. 예: 09:00" }, { status: 400 });
  }
  if (toMin(et) <= toMin(st)) {
    return NextResponse.json({ error: "종료 시간이 시작 시간보다 빠릅니다." }, { status: 400 });
  }
  if (toMin(et) - toMin(st) > 12 * 60) {
    return NextResponse.json({ error: "하루 근무는 12시간을 넘을 수 없습니다." }, { status: 400 });
  }
  const kind = asScheduleType(type);
  if (!kind) return NextResponse.json({ error: "근무 유형이 올바르지 않습니다." }, { status: 400 });

  const schedule = await prisma.schedule.update({
    where: { id },
    data: { startTime: st, endTime: et, type: kind, note: typeof note === "string" ? note : null },
    include: { user: { select: { name: true, department: true } } },
  });

  return NextResponse.json({ success: true, schedule });
}
