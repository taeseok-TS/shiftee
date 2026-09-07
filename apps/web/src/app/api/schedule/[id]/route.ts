import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

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

  const schedule = await prisma.schedule.update({
    where: { id },
    data: { startTime, endTime, type, note },
    include: { user: { select: { name: true, department: true } } },
  });

  return NextResponse.json({ success: true, schedule });
}
