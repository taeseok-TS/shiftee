// 자료제출 서버 전용 공통 — 요청 본문 검증·직렬화 (2026-09-13)
import { prisma } from "@/lib/db";
import { CATEGORY_GROUPS, JOB_GROUPS, SHARE_ALL, dateStr, type SubmissionFile } from "@/lib/submissions";
import type { Submission, SubmissionRequest, SubmissionCategory } from "@prisma/client";
import { targetUsersFor, type TargetUser } from "@/lib/submission-targets";

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
/** 직접 지정 대상 검증 — 문자열 id 배열(최대 300), 전원이 제출 대상 자격(재직·본부 아님)이어야 한다. 검증된 사람 목록을 돌려준다.
 *  값이 없으면 [] (직군·지점 방식), 형식이 틀리거나 자격 없는 id 가 섞이면 null. */
export async function pickTargetUsers(v: unknown, opts: { tolerate?: string[] } = {}): Promise<{ ids: string[]; users: TargetUser[] } | null> {
  if (v === undefined || v === null) return { ids: [], users: [] };
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return null;
  const ids = [...new Set(v as string[])].filter(Boolean);
  if (!ids.length) return { ids: [], users: [] };
  if (ids.length > 300) return null;
  const users = await targetUsersFor({ targetJobGroups: [], targetBranches: [], targetUserIds: ids });
  // 수정 때: 이미 걸려 있던 사람이 그 사이 퇴사했으면 조용히 뺀다(그 요청을 영영 못 고치는 일 방지). 새로 넣는 id 는 여전히 자격이 있어야 한다.
  const found = new Set(users.map((u) => u.id));
  const tolerate = new Set(opts.tolerate ?? []);
  if (ids.some((id) => !found.has(id) && !tolerate.has(id))) return null;
  if (!users.length) return null; // 전원 퇴사 — 조용히 "전 직군"으로 풀리면 수십 명에게 나가므로 거절(화면에서 다시 고르게)
  // 저장 순서는 지점·이름순으로 정돈
  return { ids: users.map((u) => u.id), users };
}

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
    targetUserIds: r.targetUserIds,
    dueDate: dateStr(r.dueDate),
    createdBy: r.createdBy,
    createdByName: r.createdByName,
    closedAt: r.closedAt,
    createdAt: r.createdAt,
  };
}

export function serializeSubmission(s: Submission & { category?: SubmissionCategory | null; request?: { id: string; title: string; dueDate: Date | null; closedAt?: Date | null } | null }) {
  return {
    id: s.id,
    requestId: s.requestId,
    // closedAt 도 실어 화면이 삭제 가능 여부를 서버 규칙과 같게 판단한다(앱 검증관 P2)
    request: s.request ? { id: s.request.id, title: s.request.title, dueDate: dateStr(s.request.dueDate), closedAt: s.request.closedAt ?? null } : null,
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
    consent: s.consent,
    publishedAt: s.publishedAt,
    publishedUrl: s.publishedUrl,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}
