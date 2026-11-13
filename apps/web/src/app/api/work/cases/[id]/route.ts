import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { canEditCase, checkCaseFiles, resolveCaseViewer, serializeCase } from "@/lib/success-case-server";
import { caseFilesOf, parseCaseInput, schoolsTextOf } from "@/lib/success-cases";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// 사례 하나 + 댓글. 지운 사례는 본부만 본다.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const r = await resolveCaseViewer(await getSession());
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { v } = r;
  const { id } = await params;
  const c = await prisma.successCase.findUnique({
    where: { id },
    include: {
      cheers: { where: { userId: v.userId }, select: { userId: true } },
      comments: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, take: 300 },
    },
  });
  if (!c || (c.deletedAt && v.role !== "ADMIN")) return NextResponse.json({ error: "사례를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({
    case: serializeCase(c, v),
    comments: c.comments.map((m) => ({
      id: m.id, userId: m.userId, userName: m.userName, userBranch: m.userBranch, content: m.content, createdAt: m.createdAt,
      canDelete: v.role === "ADMIN" || m.userId === v.userId,
    })),
  });
}

// 수정 — 작성자 · 본부. 이미 마케팅 자료로 보낸 내용은 따라 바뀌지 않는다(화면에서 안내).
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const r = await resolveCaseViewer(await getSession());
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { v } = r;
  const { id } = await params;
  const c = await prisma.successCase.findUnique({ where: { id } });
  if (!c || c.deletedAt) return NextResponse.json({ error: "사례를 찾을 수 없습니다." }, { status: 404 });
  if (!canEditCase(c, v)) return NextResponse.json({ error: "작성자와 본부만 고칠 수 있습니다." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "내용이 없습니다." }, { status: 400 });

  const parsed = parseCaseInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const before = new Set(caseFilesOf(c.files).map((f) => f.url));
  // files 를 아예 안 보내면 기존 첨부를 그대로 둔다(검증관 C1 — 빼고 보내면 첨부가 다 지워졌다)
  const files = await checkCaseFiles(body.files === undefined ? caseFilesOf(c.files) : body.files, v, c.id, before);
  if ("error" in files) return NextResponse.json({ error: files.error }, { status: files.status });
  const added = files.files.some((f) => !before.has(f.url));
  // 새 첨부를 붙일 때는 가림 확인을 다시 받는다(기존 첨부만 남기는 수정은 처음 확인으로 충분)
  if (added && body.maskConfirmed !== true)
    return NextResponse.json({ error: "첨부의 학생 이름 · 얼굴 · 학교 · 수험번호를 가렸다는 확인에 체크해주세요." }, { status: 400 });

  const d = parsed.value;
  const row = await prisma.successCase.update({
    where: { id: c.id },
    data: {
      ...d,
      results: d.results as unknown as Prisma.InputJsonValue,
      schoolsText: schoolsTextOf(d.results),
      files: files.files as unknown as Prisma.InputJsonValue,
      maskConfirmed: files.files.length > 0,
    },
    include: { cheers: { where: { userId: v.userId }, select: { userId: true } } },
  });
  await logAudit({ actorId: v.userId, actorName: v.name, action: "SUCCESS_CASE_UPDATE", targetType: "SUCCESS_CASE", targetId: c.id, targetName: row.title.slice(0, 100), detail: `${c.authorId === v.userId ? "작성자" : `본부(작성자 ${c.authorName})`} · 첨부 ${files.files.length}개` });
  return NextResponse.json({ case: serializeCase(row, v) });
}

// 지우기 — 작성자 · 본부. 표시만 지운다(첨부 · 댓글은 남고 본부는 볼 수 있다). 마케팅 자료로 보낸 것은 따로 남는다.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const r = await resolveCaseViewer(await getSession());
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { v } = r;
  const { id } = await params;
  const c = await prisma.successCase.findUnique({ where: { id } });
  if (!c || c.deletedAt) return NextResponse.json({ error: "사례를 찾을 수 없습니다." }, { status: 404 });
  if (!canEditCase(c, v)) return NextResponse.json({ error: "작성자와 본부만 지울 수 있습니다." }, { status: 403 });
  await prisma.successCase.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
  await logAudit({ actorId: v.userId, actorName: v.name, action: "SUCCESS_CASE_DELETE", targetType: "SUCCESS_CASE", targetId: c.id, targetName: c.title.slice(0, 100), detail: `${c.authorBranch ?? "-"} ${c.authorName}${c.marketingSubmissionId ? ` · 마케팅 자료 ${c.marketingSubmissionId} 는 남음` : ""}` });
  return NextResponse.json({ ok: true });
}
