import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkCaseFiles, resolveCaseViewer, sendCaseToMarketing, serializeCase } from "@/lib/success-case-server";
import { CASE_KINDS, STUDENT_GRADES, parseCaseInput, schoolsTextOf } from "@/lib/success-cases";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// 큐브티워크 「합격 · 성적 사례」 목록 · 작성 (2026-11-13 디렉터 결정)
// 열람 = 튜터 빼고 전 직원(본부 포함) — 전 지점 사례를 함께 본다(내부 학습용).
// 거르기: kind · grade(학생 학년) · branch(작성 지점) · band(결과 평균 등급대 1~9) · q(제목 · 전략 · 학교 · 작성자) · mine=1
export async function GET(request: NextRequest) {
  const r = await resolveCaseViewer(await getSession());
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { v } = r;
  const sp = new URL(request.url).searchParams;

  const and: Prisma.SuccessCaseWhereInput[] = [{ deletedAt: null }];
  const kind = sp.get("kind"); if (kind && (CASE_KINDS as readonly string[]).includes(kind)) and.push({ kind });
  const grade = sp.get("grade"); if (grade && (STUDENT_GRADES as readonly string[]).includes(grade)) and.push({ studentGrade: grade });
  const branch = sp.get("branch"); if (branch) and.push({ authorBranch: branch });
  if (sp.get("mine") === "1") and.push({ authorId: v.userId });
  const band = Number(sp.get("band"));
  if (Number.isInteger(band) && band >= 1 && band <= 9) {
    // 결과 등급(gradeTo)으로, 없으면 시작 등급(gradeFrom)으로 — 9등급대는 9.0 까지
    const range = { gte: band, ...(band === 9 ? { lte: 9 } : { lt: band + 1 }) };
    and.push({ OR: [{ gradeTo: range }, { gradeTo: null, gradeFrom: range }] });
  }
  const q = (sp.get("q") || "").trim().slice(0, 50);
  if (q) and.push({ OR: ["title", "strategy", "schoolsText", "beforeText", "afterText", "authorName", "region"].map((k) => ({ [k]: { contains: q, mode: "insensitive" } })) });

  const [rows, branchRows] = await Promise.all([
    prisma.successCase.findMany({
      where: { AND: and },
      include: { cheers: { where: { userId: v.userId }, select: { userId: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.successCase.findMany({ where: { deletedAt: null, authorBranch: { not: null } }, distinct: ["authorBranch"], select: { authorBranch: true } }),
  ]);
  return NextResponse.json({
    cases: rows.map((c) => serializeCase(c, v, { summary: true })),
    branches: branchRows.map((b) => b.authorBranch as string).sort((a, b) => a.localeCompare(b, "ko")),
    me: { userId: v.userId, role: v.role, branch: v.branch },
  });
}

// 작성 — 작성자 · 지점 · 직군은 서버가 채운다(본인 지점 사례). 첨부가 있으면 가림 확인 필수.
// sendToMarketing=true 면 외부 게시 동의(marketingConsent=true)를 따로 받아 마케팅 자료도 만든다.
export async function POST(request: NextRequest) {
  const r = await resolveCaseViewer(await getSession());
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { v } = r;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "내용이 없습니다." }, { status: 400 });

  const parsed = parseCaseInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const files = await checkCaseFiles(body.files, v, null, new Set());
  if ("error" in files) return NextResponse.json({ error: files.error }, { status: files.status });
  if (files.files.length && body.maskConfirmed !== true)
    return NextResponse.json({ error: "첨부의 학생 이름 · 얼굴 · 학교 · 수험번호를 가렸다는 확인에 체크해주세요." }, { status: 400 });
  const toMarketing = body.sendToMarketing === true;
  if (toMarketing && body.marketingConsent !== true)
    return NextResponse.json({ error: "마케팅 자료로 보내려면 외부 게시 동의(학생 · 학부모 동의를 받았거나 가렸음)에 체크해주세요." }, { status: 400 });

  const d = parsed.value;
  const row = await prisma.successCase.create({
    data: {
      ...d,
      results: d.results as unknown as Prisma.InputJsonValue,
      schoolsText: schoolsTextOf(d.results),
      files: files.files as unknown as Prisma.InputJsonValue,
      maskConfirmed: files.files.length > 0,
      authorId: v.userId, authorName: v.name, authorBranch: v.branch, authorJobGroup: v.jobGroup,
    },
  });
  await logAudit({ actorId: v.userId, actorName: v.name, action: "SUCCESS_CASE_CREATE", targetType: "SUCCESS_CASE", targetId: row.id, targetName: row.title.slice(0, 100), detail: `${d.kind} · ${v.branch ?? "지점 없음"} · 첨부 ${files.files.length}개${toMarketing ? " · 마케팅 자료로도 보냄" : ""}` });

  let marketingError: string | null = null;
  if (toMarketing) {
    const m = await sendCaseToMarketing(row.id, v);
    if ("error" in m) marketingError = m.error;
  }
  const fresh = await prisma.successCase.findUnique({ where: { id: row.id }, include: { cheers: { where: { userId: v.userId }, select: { userId: true } } } });
  return NextResponse.json({ case: serializeCase(fresh ?? row, v), marketingError });
}
