// 자료제출 열람 권한 — 목록·파일 서빙·PDF 미리보기가 **이 한 곳**의 규칙을 쓴다 (2026-09-13).
//
// 규칙(디렉터 확정 9/13):
//  - 본인 제출물은 본인이 본다
//  - 본부(ADMIN)는 전부 본다
//  - 원장(MANAGER)은 담당 지점(대표+겸직) 직원의 제출물을 본다 (승인 ①)
//  - 공유가 켜진 제출물은 대상 직군("*" 는 전원)이 본다
// 판정에 필요한 직군은 토큰에 없어 DB 에서 읽는다. 세션이 없는 접근(앱 티켓 u:<userId>)도
// 같은 주체로 판정한다 — 계약서 파일 접근과 같은 방식(2026-09-02 사고 이후 원칙).
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { isResigned } from "@/lib/resign";
import path from "path";
import crypto from "crypto";
import { SHARE_ALL, isSubmissionFileUrl } from "@/lib/submissions";
import type { Prisma } from "@prisma/client";

export type SubmissionViewer = {
  userId: string;
  role: "ADMIN" | "MANAGER" | "EMPLOYEE";
  branches: string[];      // MANAGER 의 담당 지점(대표+겸직). 그 외는 []
  branch: string | null;   // 본인 소속 지점(요청 대상 판정용)
  jobGroup: string | null; // 공유·요청 대상 판정용
  name: string;
  position: string | null;
};

/** 세션 또는 티켓 주체(u:<userId>)로 열람 주체를 만든다. 재직 중이 아니면 null. */
export async function resolveSubmissionViewer(
  session: { userId: string; role: string } | null,
  ticketSubject: string | null,
): Promise<SubmissionViewer | null> {
  // 티켓 주체는 `u:<userId>~<발급 당시 tokenVersion>` (contract-access resolvePrincipal 과 같은 규칙, 2026-09-07).
  // ~ 뒤가 없으면 옛 티켓(0 으로 본다). 세션 무효화(기기 초기화·비번 초기화) 뒤에는 그 전 티켓이 통하면 안 된다.
  // (API 키 경로 apiKeyFileSubject 는 `u:<userId>` 만 주므로 ~ 없이 오면 세션번호를 대조하지 않는다 — 키는 이미 재직·허용을 봤다)
  let userId: string | null = session?.userId ?? null;
  let ticketTv: number | null = null;
  if (!userId && ticketSubject?.startsWith("u:")) {
    const raw = ticketSubject.slice(2);
    const cut = raw.lastIndexOf("~");
    userId = cut >= 0 ? raw.slice(0, cut) : raw;
    if (cut >= 0) { const tvRaw = raw.slice(cut + 1); ticketTv = /^\d+$/.test(tvRaw) ? Number(tvRaw) : NaN; }
  }
  if (!userId) return null;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, name: true, branch: true, jobGroup: true, position: true, isActive: true, deletedAt: true, employmentStatus: true, resignDate: true, tokenVersion: true },
  });
  // 퇴사일이 지난 사람은 getSession 과 같은 기준으로 막는다(티켓 경로도 — 검증관 10)
  if (!u || !u.isActive || u.deletedAt || u.employmentStatus === "RESIGNED" || isResigned(u.resignDate)) return null;
  if (ticketTv !== null && u.tokenVersion !== ticketTv) return null; // 끊긴 세션의 티켓
  const role = u.role as SubmissionViewer["role"];
  const branches = role === "MANAGER" ? await getManagerBranches(u.id) : [];
  return { userId: u.id, role, branches, branch: u.branch, jobGroup: u.jobGroup, name: u.name, position: u.position };
}

type SubmissionLike = {
  userId: string;
  userBranch: string | null;
  shared: boolean;
  shareJobGroups: string[];
  deletedAt: Date | null;
};

export function canViewSubmission(s: SubmissionLike, v: SubmissionViewer): boolean {
  if (s.deletedAt) return v.role === "ADMIN";
  if (v.role === "ADMIN") return true;
  if (s.userId === v.userId) return true;
  if (v.role === "MANAGER" && s.userBranch && v.branches.includes(s.userBranch)) return true;
  if (s.shared && (s.shareJobGroups.includes(SHARE_ALL) || (v.jobGroup && s.shareJobGroups.includes(v.jobGroup)))) return true;
  return false;
}

/** "내가 볼 수 있는 제출물" 목록 조건 — canViewSubmission 과 같은 규칙을 where 로 */
export function visibleSubmissionWhere(v: SubmissionViewer): Prisma.SubmissionWhereInput {
  if (v.role === "ADMIN") return {};
  const or: Prisma.SubmissionWhereInput[] = [{ userId: v.userId }];
  if (v.role === "MANAGER" && v.branches.length) or.push({ userBranch: { in: v.branches } });
  const groups = v.jobGroup ? [SHARE_ALL, v.jobGroup] : [SHARE_ALL];
  or.push({ shared: true, shareJobGroups: { hasSome: groups } });
  return { deletedAt: null, OR: or };
}

/** 공유 자료만 (본인 것·지점 것 제외하지 않음 — "공유 자료" 탭은 공유된 것 전부) */
export function sharedSubmissionWhere(v: SubmissionViewer): Prisma.SubmissionWhereInput {
  if (v.role === "ADMIN") return { deletedAt: null, shared: true };
  const groups = v.jobGroup ? [SHARE_ALL, v.jobGroup] : [SHARE_ALL];
  return { deletedAt: null, shared: true, shareJobGroups: { hasSome: groups } };
}

/**
 * 첨부 파일 하나에 대한 접근 판정 — /api/uploads/submissions/<파일명> 과 /api/docs/pdf 가 부른다.
 * 파일이 어느 제출물에 속하는지 files JSON 에서 찾고, 그 제출물을 볼 수 있는지 본다.
 */
export async function canAccessSubmissionFile(
  fileName: string,
  session: { userId: string; role: string } | null,
  ticketSubject: string | null,
): Promise<{ allowed: boolean; status: number; error: string }> {
  const v = await resolveSubmissionViewer(session, ticketSubject);
  if (!v) return { allowed: false, status: 401, error: "인증이 필요합니다." };
  const url = `/api/uploads/submissions/${fileName}`;
  // 파일명은 업로드 때 안전화(영문·숫자·한글·.-_)돼 있어 URL 과 1:1 — 인코딩 차이는 양쪽 다 찾아본다
  const urls = [url];
  try { const enc = `/api/uploads/submissions/${encodeURIComponent(fileName)}`; if (enc !== url) urls.push(enc); } catch { /* ignore */ }
  const rows = await prisma.submission.findMany({
    where: { OR: urls.map((u) => ({ files: { array_contains: [{ url: u }] } })) },
    select: { userId: true, userBranch: true, shared: true, shareJobGroups: true, deletedAt: true },
    take: 5,
  });
  if (rows.length === 0) return { allowed: false, status: 404, error: "파일을 찾을 수 없습니다." };
  if (rows.some((r) => canViewSubmission(r, v))) return { allowed: true, status: 200, error: "" };
  return { allowed: false, status: 403, error: "이 자료를 볼 권한이 없습니다." };
}

/**
 * 업로더 표식(검증관 7) — 파일명에 올린 사람의 짧은 HMAC 을 박아, 남이 올려 둔(아직 제출 안 한) 파일 URL 을
 * 자기 제출에 붙이지 못하게 한다. 파일명: <ts>-<rand>-<tag8>-<이름>
 */
export function uploaderTag(userId: string): string {
  return crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(`subup:${userId}`).digest("hex").slice(0, 8);
}
export function fileBelongsTo(fileUrl: string, userId: string): boolean {
  let name = fileUrl.split("/").pop() || "";
  try { name = decodeURIComponent(name); } catch { /* 그대로 */ }
  const m = /^\d{13}-[a-z0-9]{1,10}-([0-9a-f]{8})-/.exec(name);
  return !!m && m[1] === uploaderTag(userId);
}

/** 첨부 URL → 디스크 경로. uploads/submissions 밖으로 나가면 null. (lib/work-file 과 같은 봉인) */
export function submissionDiskPath(fileUrl: string): string | null {
  if (!isSubmissionFileUrl(fileUrl)) return null;
  let name: string;
  try { name = decodeURIComponent(fileUrl.slice("/api/uploads/submissions/".length)); } catch { return null; }
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) return null;
  const baseDir = path.join(process.cwd(), "uploads", "submissions");
  const full = path.resolve(baseDir, name);
  const root = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  return full.startsWith(root) ? full : null;
}
