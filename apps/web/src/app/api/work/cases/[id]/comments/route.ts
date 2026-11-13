import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveCaseViewer } from "@/lib/success-case-server";
import { COMMENT_MAX } from "@/lib/success-cases";

export const dynamic = "force-dynamic";

// 댓글 달기 — 사례를 볼 수 있는 사람 누구나. 숫자는 실제 개수로 다시 센다.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveCaseViewer(await getSession());
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { v } = r;
  const { id } = await params;
  const c = await prisma.successCase.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  if (!c || c.deletedAt) return NextResponse.json({ error: "사례를 찾을 수 없습니다." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { content?: unknown };
  const content = typeof body.content === "string" ? body.content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : "";
  if (!content) return NextResponse.json({ error: "댓글을 적어주세요." }, { status: 400 });
  if (content.length > COMMENT_MAX) return NextResponse.json({ error: `댓글은 ${COMMENT_MAX}자까지입니다.` }, { status: 400 });
  const m = await prisma.successCaseComment.create({ data: { caseId: id, userId: v.userId, userName: v.name, userBranch: v.branch, content } });
  // 세기와 저장을 한 문장으로(검증관 P5)
  const rows = await prisma.$queryRaw<{ n: number }[]>`UPDATE "SuccessCase" SET "commentCount" = (SELECT count(*) FROM "SuccessCaseComment" WHERE "caseId" = ${id} AND "deletedAt" IS NULL)::int WHERE id = ${id} RETURNING "commentCount" AS n`;
  const count = Number(rows[0]?.n ?? 0);
  return NextResponse.json({
    comment: { id: m.id, userId: m.userId, userName: m.userName, userBranch: m.userBranch, content: m.content, createdAt: m.createdAt, canDelete: true },
    commentCount: count,
  });
}
