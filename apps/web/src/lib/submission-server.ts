// 자료제출 서버 전용 공통 — 요청 본문 검증·직렬화 (2026-09-13)
import { prisma } from "@/lib/db";
import { CATEGORY_GROUPS, JOB_GROUPS, SHARE_ALL, dateStr, type SubmissionFile } from "@/lib/submissions";
import type { Submission, SubmissionRequest, SubmissionCategory } from "@prisma/client";

export { CATEGORY_GROUPS };

export function pickGroup(v: unknown): (typeof CATEGORY_GROUPS)[number] | null {
  return typeof v === "string" && (CATEGORY_GROUPS as readonly string[]).includes(v) ? (v as (typeof CATEGORY_GROUPS)[number]) : null;
}

/** 직군 목록 검증 — 목록 밖 값이 하나라도 있으면 null. 중복 제거. */
export function pickJobGroups(v: unknown, allowAll = false): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const g of v) {
    if (typeof g !== "string") return null;
    if (g === SHARE_ALL && allowAll) { if (!out.includes(g)) out.push(g); continue; }
    if (!(JOB_GROUPS as readonly string[]).includes(g)) return null;
    if (!out.includes(g)) out.push(g);
  }
  return out;
}

/** 지점 목록 검증 — Branch 표에 있는 이름만 */
export async function pickBranches(v: unknown): Promise<string[] | null> {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((b) => typeof b !== "string")) return null;
  const names = [...new Set(v as string[])].filter(Boolean);
  if (!names.length) return [];
  const rows = await prisma.branch.findMany({ where: { name: { in: names } }, select: { name: true } });
  if (rows.length !== names.length) return null;
  return names;
}

export function serializeRequest(r: SubmissionRequest & { category?: SubmissionCategory | null }) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    categoryId: r.categoryId,
    category: r.category ? { id: r.category.id, group: r.category.group, name: r.category.name } : undefined,
    targetJobGroups: r.targetJobGroups,
    targetBranches: r.targetBranches,
    dueDate: dateStr(r.dueDate),
    createdBy: r.createdBy,
    createdByName: r.createdByName,
    closedAt: r.closedAt,
    createdAt: r.createdAt,
  };
}

export function serializeSubmission(s: Submission & { category?: SubmissionCategory | null; request?: { id: string; title: string; dueDate: Date | null } | null }) {
  return {
    id: s.id,
    requestId: s.requestId,
    request: s.request ? { id: s.request.id, title: s.request.title, dueDate: dateStr(s.request.dueDate) } : null,
    categoryId: s.categoryId,
    category: s.category ? { id: s.category.id, group: s.category.group, name: s.category.name } : undefined,
    userId: s.userId,
    userName: s.userName,
    userBranch: s.userBranch,
    userJobGroup: s.userJobGroup,
    userPosition: s.userPosition,
    yearMonth: s.yearMonth,
    title: s.title,
    memo: s.memo,
    files: (Array.isArray(s.files) ? s.files : []) as SubmissionFile[],
    status: s.status,
    checkedAt: s.checkedAt,
    shared: s.shared,
    shareJobGroups: s.shareJobGroups,
    sharedAt: s.sharedAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}
