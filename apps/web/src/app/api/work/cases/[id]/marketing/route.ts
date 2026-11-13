import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canEditCase, resolveCaseViewer, sendCaseToMarketing } from "@/lib/success-case-server";

export const dynamic = "force-dynamic";

// 이미 올린 사례를 나중에 「마케팅 자료로도 보내기」 — 작성자 · 본부. 외부 게시 동의 확인(consent=true) 필수. 두 번 눌러도 하나만.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveCaseViewer(await getSession());
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { v } = r;
  const { id } = await params;
  const c = await prisma.successCase.findUnique({ where: { id }, select: { id: true, authorId: true, deletedAt: true } });
  if (!c || c.deletedAt) return NextResponse.json({ error: "사례를 찾을 수 없습니다." }, { status: 404 });
  if (!canEditCase(c, v)) return NextResponse.json({ error: "작성자와 본부만 보낼 수 있습니다." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { consent?: unknown };
  if (body.consent !== true)
    return NextResponse.json({ error: "외부 게시 동의(학생 · 학부모 동의를 받았거나 가렸음)에 체크해주세요." }, { status: 400 });
  const m = await sendCaseToMarketing(id, v);
  if ("error" in m) return NextResponse.json({ error: m.error }, { status: m.status });
  return NextResponse.json({ ok: true, submissionId: m.submissionId });
}
