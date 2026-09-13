import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { fileBelongsTo, resolveSubmissionViewer, sharedSubmissionWhere, submissionDiskPath } from "@/lib/submission-access";
import { isTargeted } from "@/lib/submission-targets";
import { serializeSubmission } from "@/lib/submission-server";
import { currentYearMonthKST, isYearMonth, normalizeFiles } from "@/lib/submissions";
import fs from "fs/promises";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// 제출물 목록. scope=mine(기본) | shared | branch(원장·본부) | all(본부)
// 필터: categoryId · yearMonth · branch · jobGroup · requestId · q(제목·이름)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const v = await resolveSubmissionViewer(session, null);
  if (!v) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const scope = sp.get("scope") || "mine";

  let where: Prisma.SubmissionWhereInput;
  if (scope === "all") {
    if (v.role !== "ADMIN") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    where = { deletedAt: null };
  } else if (scope === "branch") {
    if (v.role === "ADMIN") where = { deletedAt: null };
    else if (v.role === "MANAGER") where = { deletedAt: null, userBranch: { in: v.branches } };
    else return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  } else if (scope === "shared") {
    where = sharedSubmissionWhere(v);
  } else {
    where = { deletedAt: null, userId: v.userId };
  }
  const categoryId = sp.get("categoryId"); if (categoryId) where.categoryId = categoryId;
  const ym = sp.get("yearMonth"); if (isYearMonth(ym)) where.yearMonth = ym;
  const branch = sp.get("branch"); if (branch && scope !== "mine") where.userBranch = scope === "branch" && v.role === "MANAGER" && !v.branches.includes(branch) ? { in: [] } : branch;
  const jobGroup = sp.get("jobGroup"); if (jobGroup) where.userJobGroup = jobGroup;
  const requestId = sp.get("requestId"); if (requestId) where.requestId = requestId;
  const q = (sp.get("q") || "").trim();
  if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { userName: { contains: q, mode: "insensitive" } }];

  const rows = await prisma.submission.findMany({
    where,
    include: { category: true, request: { select: { id: true, title: true, dueDate: true, closedAt: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return NextResponse.json({ submissions: rows.map(serializeSubmission) });
}

// 제출 — 요청에 대해서나 자유 제출. 지점·직책·직급·연월은 서버가 채운다.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const v = await resolveSubmissionViewer(session, null);
  if (!v) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));

  const files = normalizeFiles(body.files);
  if (!files) return NextResponse.json({ error: "파일을 1~10개 올려주세요." }, { status: 400 });
  // 올린 파일이 실제로 우리 저장 구역에 있어야 하고, 다른 제출물에 이미 매여 있으면 안 된다
  for (const f of files) {
    if (!fileBelongsTo(f.url, v.userId)) return NextResponse.json({ error: `본인이 올린 파일만 제출할 수 있습니다: ${f.name}` }, { status: 400 });
    const p = submissionDiskPath(f.url);
    const st = p ? await fs.stat(p).catch(() => null) : null;
    if (!st?.isFile()) return NextResponse.json({ error: `파일을 찾을 수 없습니다: ${f.name}. 다시 올려주세요.` }, { status: 400 });
    f.size = st.size; // 크기는 디스크 값으로(검증관 11)
    const taken = await prisma.submission.findFirst({ where: { files: { array_contains: [{ url: f.url }] } }, select: { id: true } });
    if (taken) return NextResponse.json({ error: `이미 제출된 파일입니다: ${f.name}` }, { status: 409 });
  }

  let requestRow = null;
  if (body.requestId) {
    requestRow = typeof body.requestId === "string" ? await prisma.submissionRequest.findUnique({ where: { id: body.requestId } }) : null;
    if (!requestRow) return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
    if (requestRow.closedAt) return NextResponse.json({ error: "닫힌 요청입니다." }, { status: 400 });
    if (!isTargeted(v, requestRow)) return NextResponse.json({ error: "이 요청의 대상이 아닙니다." }, { status: 403 });
    const dup = await prisma.submission.findFirst({ where: { requestId: requestRow.id, userId: v.userId, deletedAt: null }, select: { id: true } });
    if (dup) return NextResponse.json({ error: "이 요청에는 이미 제출했습니다. '내 제출'에서 기존 제출물을 확인해주세요.", submissionId: dup.id }, { status: 409 });
  }
  const categoryId = requestRow ? requestRow.categoryId : typeof body.categoryId === "string" ? body.categoryId : "";
  const category = categoryId ? await prisma.submissionCategory.findUnique({ where: { id: categoryId } }) : null;
  if (!category || (!requestRow && !category.active)) return NextResponse.json({ error: "어디에 올리는 자료인지 골라주세요." }, { status: 400 });

  const title = (typeof body.title === "string" ? body.title.trim() : "").slice(0, 150) || files[0].name.replace(/\.[^.]+$/, "");
  const memo = typeof body.memo === "string" ? body.memo.trim().slice(0, 1000) || null : null;
  const yearMonth = isYearMonth(body.yearMonth) ? body.yearMonth : currentYearMonthKST();

  const row = await prisma.submission.create({
    data: {
      requestId: requestRow?.id ?? null,
      categoryId: category.id,
      userId: v.userId,
      userName: v.name,
      userBranch: v.branch,
      userJobGroup: v.jobGroup,
      userPosition: v.position,
      yearMonth,
      title,
      memo,
      files: files as unknown as Prisma.InputJsonValue,
    },
    include: { category: true, request: { select: { id: true, title: true, dueDate: true, closedAt: true } } },
  });
  await logAudit({
    actorId: v.userId, actorName: v.name, action: "SUBMISSION_CREATE", targetType: "SUBMISSION", targetId: row.id, targetName: title,
    detail: `${category.name}${requestRow ? ` · 요청 「${requestRow.title}」` : " · 자유 제출"} · 파일 ${files.length}개`,
  });
  return NextResponse.json({ submission: serializeSubmission(row) });
}
