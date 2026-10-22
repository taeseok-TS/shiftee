import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// 관리자별 「연봉 보기」 켜기·끄기(2026-10-22 디렉터) — 메인 관리자만. 메인 관리자는 늘 볼 수 있어 따로 켤 필요가 없다.
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN" || !(await isSuperAdmin(session.userId))) return NextResponse.json({ error: "메인 관리자만 바꿀 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!userId || typeof body?.on !== "boolean") return NextResponse.json({ error: "요청이 올바르지 않습니다." }, { status: 400 });
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, deletedAt: true } });
  if (!target || target.deletedAt || target.role !== "ADMIN") return NextResponse.json({ error: "관리자 계정에만 켤 수 있습니다." }, { status: 400 });
  await prisma.user.update({ where: { id: userId }, data: { canViewSalary: body.on } });
  await logAudit({ actorId: session.userId, actorName: session.name, action: "SALARY_ACCESS", targetType: "USER", targetId: userId, targetName: target.name, detail: `연봉 보기 ${body.on ? "켬" : "끔"}` });
  return NextResponse.json({ ok: true });
}
