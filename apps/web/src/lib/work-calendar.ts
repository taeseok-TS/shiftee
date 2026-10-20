// 큐브티워크 캘린더 공통 — 일정 시각(#221)·「이달의 지점 공유」 메모(#222), 2026-10-20
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { kstTodayMidnight } from "@/lib/resign";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 일정 시각 검사 — 둘 다 비우면 종일. 끝 시각만 있는 건 받지 않는다. 하루짜리 일정은 끝이 시작보다 늦어야 한다 */
export function parseEventTimes(
  startTime: unknown,
  endTime: unknown,
  sameDay: boolean
): { startTime: string | null; endTime: string | null } | { error: string } {
  const s = typeof startTime === "string" && startTime.trim() ? startTime.trim() : null;
  const e = typeof endTime === "string" && endTime.trim() ? endTime.trim() : null;
  if (s && !HHMM.test(s)) return { error: "시작 시각 형식이 올바르지 않습니다." };
  if (e && !HHMM.test(e)) return { error: "끝 시각 형식이 올바르지 않습니다." };
  if (e && !s) return { error: "끝 시각을 넣으려면 시작 시각도 넣어 주세요." };
  if (s && e && sameDay && e <= s) return { error: "끝 시각은 시작 시각보다 늦어야 합니다." };
  return { startTime: s, endTime: e };
}

export const NOTE_MAX = 5000;
export const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 메모를 볼 수 있는 지점과 쓸 수 있는지.
 * 보기: 관리자 = 모든 활성 지점 / 원장 = 담당 지점(대표+겸직) / 직원 = 자기 지점. 다른 지점에는 안 보인다.
 * 쓰기: 관리자·원장, 그리고 **원장이 지정한 직원**(2026-10-20 디렉터 정정: 「지점 메모는 원장이나 원장이 지정한 사람이 작성,
 *       지점 일정 입력은 직원도」). 지정은 지점마다 AppSetting `calendarNote.editors:<지점>` (사용자 id JSON 배열).
 * 직원 지점은 토큰 값이 아니라 DB 에서 읽는다(지점명 변경이 바로 반영되게).
 */
export async function noteScope(session: { userId: string; role: string }): Promise<{ branches: string[]; canEdit: boolean; canManage: boolean }> {
  if (session.role === "ADMIN") {
    const rows = await prisma.branch.findMany({ where: { isActive: true }, select: { name: true }, orderBy: { name: "asc" } });
    return { branches: rows.map((r) => r.name), canEdit: true, canManage: true };
  }
  if (session.role === "MANAGER") return { branches: await getManagerBranches(session.userId), canEdit: true, canManage: true };
  const b = await myBranch(session.userId);
  if (!b) return { branches: [], canEdit: false, canManage: false };
  return { branches: [b], canEdit: (await noteEditorIds(b)).includes(session.userId), canManage: false };
}

/** 내 소속 지점 — 토큰이 아니라 DB 값 */
export async function myBranch(userId: string): Promise<string | null> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { branch: true } });
  return me?.branch || null;
}

// ── 메모 작성자 지정(원장이 고른 직원) ──
export const NOTE_EDITORS_PREFIX = "calendarNote.editors:";

export async function noteEditorIds(branch: string): Promise<string[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: NOTE_EDITORS_PREFIX + branch } });
  if (!row) return [];
  try {
    const v = JSON.parse(row.value);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 지정할 수 있는 사람 — 그 지점 소속 재직 직원(원장·관리자는 원래 쓸 수 있어 빼고, 퇴사일 지난 사람 제외) */
export async function noteEditorCandidates(branch: string) {
  // 퇴사일 당일까지는 재직(로그인 판정·manager-branches 와 같은 기준)
  return prisma.user.findMany({
    where: { branch, role: "EMPLOYEE", isActive: true, deletedAt: null, OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }] },
    select: { id: true, name: true, position: true, jobGroup: true },
    orderBy: { name: "asc" },
  });
}

/** 메모 작성자 지정을 바꿀 수 있는지 — 관리자는 활성 지점 모두, 원장은 담당 지점 */
export async function canManageNoteEditors(session: { userId: string; role: string }, branch: string): Promise<boolean> {
  const { branches, canManage } = await noteScope(session);
  return canManage && branches.includes(branch);
}
