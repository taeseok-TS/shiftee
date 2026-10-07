import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseTemplateBody } from "@/lib/schedule-template";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// 근무일정 템플릿 고치기(PATCH)·끄기/켜기(PATCH { isActive })·지우기 대신 끄기(DELETE) — 본부만(2026-10-07 QA #10).
// 지우지 않고 끈다 — 이미 이 템플릿으로 만든 일정·신청 기록에는 이름이 남아 있다.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const before = await prisma.scheduleTemplate.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });

  // 켜기·끄기만
  if (Object.keys(body).length === 1 && typeof body.isActive === "boolean") {
    const row = await prisma.scheduleTemplate.update({ where: { id }, data: { isActive: body.isActive } });
    await logAudit({
      actorId: session.userId, actorName: session.name, action: "SCHEDULE_TEMPLATE_UPDATE",
      targetType: "ScheduleTemplate", targetId: id, targetName: row.name, detail: `근무일정 템플릿 ${body.isActive ? "켬" : "끔"}: ${row.name}`,
    });
    return NextResponse.json({ success: true, template: row });
  }

  const p = parseTemplateBody(body);
  if (p.ok === false) return NextResponse.json({ error: p.error }, { status: 400 });
  const row = await prisma.scheduleTemplate.update({ where: { id }, data: p.data });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "SCHEDULE_TEMPLATE_UPDATE",
    targetType: "ScheduleTemplate", targetId: id, targetName: row.name,
    detail: `근무일정 템플릿 수정: ${before.name} ${before.startTime}~${before.endTime} → ${row.name} ${row.startTime}~${row.endTime}`,
  });
  return NextResponse.json({ success: true, template: row });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const { id } = await params;
  const row = await prisma.scheduleTemplate.updateMany({ where: { id }, data: { isActive: false } });
  if (row.count === 0) return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ success: true });
}
