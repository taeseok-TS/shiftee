// 합격 · 성적 사례 — 서버 전용 도우미 (2026-11-13). 열람 주체 · 첨부 검사 · 응답 모양 · 마케팅 자료로 보내기.
import { prisma } from "@/lib/db";
import { resolveSubmissionViewer, fileBelongsTo, submissionDiskPath, submissionFileSha256, type SubmissionViewer } from "@/lib/submission-access";
import { canViewCasesBy, caseFileAllowed, caseFilesOf, studentLabel, CASE_KIND_LABEL, CASE_MAX_FILES, type CaseKind, type CaseResult } from "@/lib/success-cases";
import { currentYearMonthKST, decodeFileName, extOf, fileTypeOf, isSubmissionFileUrl, type SubmissionFile } from "@/lib/submissions";
import fs from "fs/promises";
import type { Prisma, SuccessCase } from "@prisma/client";

/** 세션 → 사례 열람 주체. 재직 중이 아니면 null, 튜터면 forbidden */
export async function resolveCaseViewer(session: { userId: string; role: string } | null): Promise<{ v: SubmissionViewer } | { error: string; status: number }> {
  const v = await resolveSubmissionViewer(session, null);
  if (!v) return { error: "인증이 필요합니다.", status: 401 };
  if (!canViewCasesBy(v.role, v.jobGroup, v.position)) return { error: "합격 · 성적 사례는 튜터를 뺀 직원이 볼 수 있습니다.", status: 403 };
  return { v };
}

export function canEditCase(c: { authorId: string }, v: SubmissionViewer): boolean {
  return v.role === "ADMIN" || c.authorId === v.userId;
}

/**
 * 첨부 목록 검사 — 자료제출 업로드(/api/work/submissions/upload)로 올린 파일만, 5개까지.
 * 새로 붙이는 파일은 본인이 올린 것(파일명 업로더 표식)이어야 하고, 다른 사례 · 제출물에 이미 매여 있으면 안 된다.
 * keepUrls(수정 전 이 사례에 이미 있던 파일)는 그대로 둘 수 있다 — 본부가 남의 사례를 고칠 때.
 */
export async function checkCaseFiles(raw: unknown, v: SubmissionViewer, caseId: string | null, keepUrls: Set<string>): Promise<{ ok: true; files: SubmissionFile[] } | { ok: false; error: string; status: number }> {
  if (raw === undefined || raw === null) return { ok: true, files: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "첨부 형식이 올바르지 않습니다.", status: 400 };
  if (raw.length > CASE_MAX_FILES) return { ok: false, error: `첨부는 ${CASE_MAX_FILES}개까지입니다.`, status: 400 };
  const out: SubmissionFile[] = [];
  const seen = new Set<string>();
  for (const f of raw) {
    const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    if (!isSubmissionFileUrl(o.url)) return { ok: false, error: "첨부 형식이 올바르지 않습니다.", status: 400 };
    // 퍼센트 인코딩을 풀어 한 가지 형태로 저장한다 — 인코딩만 바꿔 「이미 붙은 파일」 검사를 피하지 못하게(검증관 P4)
    let fname = o.url.slice("/api/uploads/submissions/".length);
    try { fname = decodeURIComponent(fname); } catch { return { ok: false, error: "첨부 형식이 올바르지 않습니다.", status: 400 }; }
    const url = `/api/uploads/submissions/${fname}`;
    if (!isSubmissionFileUrl(url) || seen.has(url)) return { ok: false, error: "첨부 형식이 올바르지 않습니다.", status: 400 };
    const urlForms = Array.from(new Set([url, `/api/uploads/submissions/${encodeURIComponent(fname)}`]));
    const rawName = typeof o.name === "string" ? decodeFileName(o.name) : "";
    const name = rawName.replace(/[\\/:*?"<>|\r\n]/g, "_").replace(/\.{2,}/g, ".").trim().slice(-200);
    const ext = extOf(name);
    if (!name || !caseFileAllowed(name) || extOf(url) !== ext)
      return { ok: false, error: `올릴 수 없는 파일입니다: ${name || "(이름 없음)"} — 이미지 · PDF · 워드 · 엑셀 · PPT · 한글만(아이폰 HEIC 는 JPG 로)`, status: 400 };
    const kept = urlForms.some((u) => keepUrls.has(u));
    if (!kept && !fileBelongsTo(url, v.userId)) return { ok: false, error: `본인이 올린 파일만 붙일 수 있습니다: ${name}`, status: 400 };
    const p = submissionDiskPath(url);
    const st = p ? await fs.stat(p).catch(() => null) : null;
    if (!st?.isFile()) return { ok: false, error: `파일을 찾을 수 없습니다: ${name}. 다시 올려주세요.`, status: 400 };
    if (!kept) {
      const anyForm = { OR: urlForms.map((u) => ({ files: { array_contains: [{ url: u }] } })) };
      const takenCase = await prisma.successCase.findFirst({ where: { ...anyForm, ...(caseId ? { id: { not: caseId } } : {}) }, select: { id: true } });
      const takenSub = await prisma.submission.findFirst({ where: anyForm, select: { id: true } });
      if (takenCase || takenSub) return { ok: false, error: `이미 다른 곳에 붙은 파일입니다: ${name}`, status: 409 };
    }
    seen.add(url);
    out.push({ url, name, size: st.size, type: fileTypeOf(ext), sha256: (await submissionFileSha256(p as string)) ?? undefined });
  }
  return { ok: true, files: out };
}

type CaseRow = SuccessCase & { cheers?: { userId: string }[] };

/** 응답 모양 — 목록(summary)은 전략을 160자로 줄인다 */
export function serializeCase(c: CaseRow, v: SubmissionViewer, opts: { summary?: boolean } = {}) {
  const strategy = opts.summary && c.strategy.length > 160 ? c.strategy.slice(0, 160) + "…" : c.strategy;
  return {
    id: c.id,
    kind: c.kind,
    kindLabel: CASE_KIND_LABEL[c.kind as CaseKind] ?? c.kind,
    title: c.title,
    student: studentLabel(c),
    studentGrade: c.studentGrade, studentSurname: c.studentSurname, studentGender: c.studentGender,
    region: c.region, schoolType: c.schoolType, periodMonths: c.periodMonths,
    gradeBasis: c.gradeBasis, gradeFrom: c.gradeFrom, gradeTo: c.gradeTo,
    beforeText: c.beforeText, afterText: c.afterText,
    results: (Array.isArray(c.results) ? c.results : []) as CaseResult[],
    strategy,
    files: opts.summary ? [] : caseFilesOf(c.files),
    fileCount: caseFilesOf(c.files).length,
    authorId: c.authorId, authorName: c.authorName, authorBranch: c.authorBranch, authorJobGroup: c.authorJobGroup,
    marketingSent: !!c.marketingSubmissionId,
    cheerCount: c.cheerCount, commentCount: c.commentCount,
    cheeredByMe: !!c.cheers?.some((x) => x.userId === v.userId),
    canEdit: canEditCase(c, v),
    deleted: !!c.deletedAt,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

/** 마케팅 자료로 보낼 분류 — 합격 사례는 「합격」이 든 분류가 있으면 그것, 없으면 「성적 향상 사례」, 그것도 없으면 처음 켜진 마케팅 분류 */
async function marketingCategoryFor(kind: string): Promise<{ id: string; name: string } | null> {
  const cats = await prisma.submissionCategory.findMany({ where: { group: "MARKETING", active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  if (!cats.length) return null;
  if (kind !== "GRADE") { const hit = cats.find((c) => c.name.includes("합격")); if (hit) return hit; }
  return cats.find((c) => c.name.includes("성적")) ?? cats[0];
}

/** 사례 본문을 마케팅 자료 메모로 — 큐브마케팅이 글감으로 쓴다. 학생은 학년 · 성만. */
function marketingMemoOf(c: SuccessCase): string {
  const results = (Array.isArray(c.results) ? c.results : []) as CaseResult[];
  const lines = [
    `[합격 · 성적 사례에서 보냄] ${CASE_KIND_LABEL[c.kind as CaseKind] ?? c.kind} · ${studentLabel(c)}${c.region ? ` · ${c.region}` : ""}${c.schoolType ? ` · ${c.schoolType}` : ""}`,
    c.periodMonths ? `관리 기간: ${c.periodMonths}개월` : "",
    c.gradeFrom !== null || c.gradeTo !== null ? `${c.gradeBasis ?? "성적"}: ${c.gradeFrom ?? "?"}등급 → ${c.gradeTo ?? "?"}등급` : "",
    c.beforeText ? `시작: ${c.beforeText}` : "",
    c.afterText ? `결과: ${c.afterText}` : "",
    results.length ? `지원 결과: ${results.map((r) => `${r.school}${r.track ? ` ${r.track}` : ""}${r.major ? ` ${r.major}` : ""} ${r.outcome}`).join(" / ")}` : "",
    `전략 · 노하우: ${c.strategy}`,
  ].filter(Boolean);
  return lines.join("\n").slice(0, 3000);
}

/**
 * 「마케팅 자료로도 보내기」 — 마케팅 자료(Submission, MARKETING)를 하나 만들어 사례와 잇는다.
 * 외부 게시 동의 확인(consent)은 호출 쪽이 받았다. 이미 보냈으면 그대로 둔다(멱등).
 */
export async function sendCaseToMarketing(caseId: string, v: SubmissionViewer): Promise<{ ok: true; submissionId: string } | { ok: false; error: string; status: number }> {
  const cat0 = await prisma.successCase.findUnique({ where: { id: caseId }, select: { kind: true } });
  if (!cat0) return { ok: false, error: "사례를 찾을 수 없습니다.", status: 404 };
  const cat = await marketingCategoryFor(cat0.kind);
  if (!cat) return { ok: false, error: "마케팅 자료 분류가 없습니다. 본부에 알려주세요.", status: 409 };
  // 같은 사례를 두 번 눌러도 마케팅 자료가 둘 생기지 않게 — 행 잠금으로 줄 세운다
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "SuccessCase" WHERE id = ${caseId} FOR UPDATE`;
    const c = await tx.successCase.findUnique({ where: { id: caseId } });
    if (!c || c.deletedAt) return { ok: false as const, error: "사례를 찾을 수 없습니다.", status: 404 };
    if (c.marketingSubmissionId) return { ok: true as const, submissionId: c.marketingSubmissionId };
    // 작성자 이름으로 올라가야 블로그 발행 알림이 작성자에게 간다 — 본부가 대신 보낸 경우에도 작성자 스냅샷을 쓴다
    const author = await tx.user.findUnique({ where: { id: c.authorId }, select: { position: true } });
    const sub = await tx.submission.create({
      data: {
        categoryId: cat.id, consent: true,
        userId: c.authorId, userName: c.authorName, userBranch: c.authorBranch, userJobGroup: c.authorJobGroup, userPosition: author?.position ?? null,
        yearMonth: currentYearMonthKST(), title: c.title.slice(0, 150), memo: marketingMemoOf(c),
        files: caseFilesOf(c.files) as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await tx.successCase.update({ where: { id: c.id }, data: { marketingSubmissionId: sub.id } });
    await tx.auditLog.create({
      data: { actorId: v.userId, actorName: v.name, action: "SUCCESS_CASE_TO_MARKETING", targetType: "SUCCESS_CASE", targetId: c.id, targetName: c.title.slice(0, 100), detail: `마케팅 자료 ${sub.id} · 분류 ${cat.name}` },
    });
    return { ok: true as const, submissionId: sub.id };
  });
}
