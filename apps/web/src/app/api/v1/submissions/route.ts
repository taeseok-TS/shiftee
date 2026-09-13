import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, v1Error } from "@/lib/api-key";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { resolveSubmissionViewer, sharedSubmissionWhere } from "@/lib/submission-access";
import { isTargeted } from "@/lib/submission-targets";
import { serializeSubmission } from "@/lib/submission-server";
import { receiveSubmissionMultipart } from "@/lib/submission-upload";
import { currentYearMonthKST, isYearMonth } from "@/lib/submissions";
import type { Prisma } from "@prisma/client";
import fs from "fs/promises";
import { submissionDiskPath } from "@/lib/submission-access";

export const dynamic = "force-dynamic";

// 내 제출 / 공유 자료
export async function GET(request: NextRequest) {
  const a = await authenticateApiKey(request, "submissions:read");
  if (a.ok === false) return a.res; // strictNullChecks 없이는 !a.ok 로 좁혀지지 않는다
  const v = await resolveSubmissionViewer({ userId: a.p.user.id, role: a.p.user.role }, null);
  if (!v) return v1Error(401, "사용할 수 없는 계정입니다.", "USER_INACTIVE");
  const scope = new URL(request.url).searchParams.get("scope") || "mine";
  const where: Prisma.SubmissionWhereInput = scope === "shared" ? sharedSubmissionWhere(v) : { deletedAt: null, userId: v.userId };
  const rows = await prisma.submission.findMany({ where, include: { category: true, request: { select: { id: true, title: true, dueDate: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  return NextResponse.json({ submissions: rows.map(serializeSubmission) });
}

// 제출 — 파일과 항목을 multipart 한 번에. 웹 화면의 두 단계(올리기→제출)를 AI 가 한 번에 하도록.
export async function POST(request: NextRequest) {
  const a = await authenticateApiKey(request, "submissions:write", "upload");
  if (a.ok === false) return a.res; // strictNullChecks 없이는 !a.ok 로 좁혀지지 않는다
  const v = await resolveSubmissionViewer({ userId: a.p.user.id, role: a.p.user.role }, null);
  if (!v) return v1Error(401, "사용할 수 없는 계정입니다.", "USER_INACTIVE");

  const mp = await receiveSubmissionMultipart(request, v.userId);
  const cleanup = async () => { for (const f of mp.files) { const p = submissionDiskPath(f.url); if (p) await fs.unlink(p).catch(() => {}); } };
  if (mp.error) return v1Error(400, mp.error, "BAD_FILE");
  if (!mp.files.length) { return v1Error(400, "files 에 파일을 1~10개 넣어주세요.", "NO_FILES"); }

  let requestRow = null;
  if (mp.fields.requestId) {
    requestRow = await prisma.submissionRequest.findUnique({ where: { id: mp.fields.requestId } });
    if (!requestRow) { await cleanup(); return v1Error(404, "요청을 찾을 수 없습니다.", "NO_REQUEST"); }
    if (requestRow.closedAt) { await cleanup(); return v1Error(400, "닫힌 요청입니다.", "REQUEST_CLOSED"); }
    if (!isTargeted(v, requestRow)) { await cleanup(); return v1Error(403, "이 요청의 대상이 아닙니다.", "NOT_TARGET"); }
    const dup = await prisma.submission.findFirst({ where: { requestId: requestRow.id, userId: v.userId, deletedAt: null }, select: { id: true } });
    if (dup) { await cleanup(); return NextResponse.json({ error: "이 요청에는 이미 제출했습니다.", code: "ALREADY", submissionId: dup.id }, { status: 409 }); }
  }
  const categoryId = requestRow ? requestRow.categoryId : mp.fields.categoryId || "";
  const category = categoryId ? await prisma.submissionCategory.findUnique({ where: { id: categoryId } }) : null;
  if (!category || (!requestRow && !category.active)) { await cleanup(); return v1Error(400, "requestId 또는 유효한 categoryId 가 필요합니다. GET /submissions/categories 로 목록을 보세요.", "NO_CATEGORY"); }

  const title = (mp.fields.title || "").trim().slice(0, 150) || mp.files[0].name.replace(/\.[^.]+$/, "");
  const memo = (mp.fields.memo || "").trim().slice(0, 1000) || null;
  const yearMonth = isYearMonth(mp.fields.yearMonth) ? mp.fields.yearMonth : currentYearMonthKST();
  const row = await prisma.submission.create({
    data: {
      requestId: requestRow?.id ?? null, categoryId: category.id, userId: v.userId,
      userName: v.name, userBranch: v.branch, userJobGroup: v.jobGroup, userPosition: v.position,
      yearMonth, title, memo, files: mp.files as unknown as Prisma.InputJsonValue,
    },
    include: { category: true, request: { select: { id: true, title: true, dueDate: true } } },
  });
  await logAudit({
    actorId: v.userId, actorName: v.name, action: "SUBMISSION_CREATE", targetType: "SUBMISSION", targetId: row.id, targetName: title,
    detail: `API 키 「${a.p.key.name}」 · ${category.name}${requestRow ? ` · 요청 「${requestRow.title}」` : " · 자유 제출"} · 파일 ${mp.files.length}개`,
  });
  return NextResponse.json({ submission: serializeSubmission(row) });
}
