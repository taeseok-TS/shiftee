import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { resolveCaseViewer } from "@/lib/success-case-server";

export const dynamic = "force-dynamic";

// 목록 맨 위 고정 · 풀기 — 본부(ADMIN)만(2026-11-26 디렉터 — 「작성 예시」 글을 늘 위에). 몸통 { on: boolean }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveCaseViewer(await getSession());
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { v } = r;
  if (v.role !== "ADMIN") return NextResponse.json({ error: "본부만 고정할 수 있습니다." }, { status: 403 });
  const { id } = await params;
  const c = await prisma.successCase.findUnique({ where: { id }, select: { id: true, title: true, deletedAt: true, pinnedAt: true } });
  if (!c || c.deletedAt) return NextResponse.json({ error: "사례를 찾을 수 없습니다." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { on?: unknown };
  if (typeof body.on !== "boolean") return NextResponse.json({ error: "on 값이 필요합니다." }, { status: 400 });
  if (body.on === !!c.pinnedAt) return NextResponse.json({ pinned: body.on });
  await prisma.successCase.update({ where: { id }, data: { pinnedAt: body.on ? new Date() : null } });
  await logAudit({ actorId: v.userId, actorName: v.name, action: body.on ? "SUCCESS_CASE_PIN" : "SUCCESS_CASE_UNPIN", targetType: "SUCCESS_CASE", targetId: id, targetName: c.title.slice(0, 100), detail: body.on ? "목록 맨 위 고정" : "고정 풀기" });
  return NextResponse.json({ pinned: body.on });
}
