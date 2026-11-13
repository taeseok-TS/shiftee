import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { resolveCaseViewer } from "@/lib/success-case-server";

export const dynamic = "force-dynamic";

// 댓글 지우기 — 쓴 사람 · 본부. 표시만 지운다.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; commentId: string }> }) {
  const r = await resolveCaseViewer(await getSession());
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { v } = r;
  const { id, commentId } = await params;
  const m = await prisma.successCaseComment.findUnique({ where: { id: commentId } });
  if (!m || m.caseId !== id || m.deletedAt) return NextResponse.json({ error: "댓글을 찾을 수 없습니다." }, { status: 404 });
  if (v.role !== "ADMIN" && m.userId !== v.userId) return NextResponse.json({ error: "쓴 사람과 본부만 지울 수 있습니다." }, { status: 403 });
  await prisma.successCaseComment.update({ where: { id: m.id }, data: { deletedAt: new Date() } });
  // 세기와 저장을 한 문장으로(검증관 P5)
  const rows = await prisma.$queryRaw<{ n: number }[]>`UPDATE "SuccessCase" SET "commentCount" = (SELECT count(*) FROM "SuccessCaseComment" WHERE "caseId" = ${id} AND "deletedAt" IS NULL)::int WHERE id = ${id} RETURNING "commentCount" AS n`;
  const count = Number(rows[0]?.n ?? 0);
  if (m.userId !== v.userId)
    await logAudit({ actorId: v.userId, actorName: v.name, action: "SUCCESS_CASE_COMMENT_DELETE", targetType: "SUCCESS_CASE", targetId: id, targetName: m.userName, detail: m.content.slice(0, 100) });
  return NextResponse.json({ ok: true, commentCount: count });
}
