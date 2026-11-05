// 큐브티워크 캘린더 공통 — 일정 시각(#221)·「이달의 지점 공유」 메모(#222), 2026-10-20
import type { Prisma } from "@prisma/client";
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

/** 일정 고치기 권한 — 관리자 / 등록자 본인 / 그 지점 원장(원장 전용 제외). 목록 canEdit · 수정 · 삭제와 같은 규칙.
 *  끌어 옮기기(#243 [id]/move) · 순서(#243 order)도 이 규칙 — myBranches 는 원장이면 getManagerBranches(대표+겸직), 아니면 [] */
export function canEditCalendarEvent(
  session: { userId: string; role: string },
  event: { createdBy: string; managersOnly: boolean; branch: string | null },
  myBranches: string[]
): boolean {
  return session.role === "ADMIN" ||
    event.createdBy === session.userId ||
    (session.role === "MANAGER" && !event.managersOnly && !!event.branch && myBranches.includes(event.branch));
}

/** 이 사람이 보는 캘린더 일정 — 관리자 전체, 원장은 전사 + 담당 지점(대표+겸직, 원장 전용 포함), 직원은 전사 + 자기 지점(원장 전용 제외) */
export function calendarVisibleWhere(
  session: { role: string; branch?: string | null },
  myBranches: string[]
): Prisma.WorkCalendarEventWhereInput {
  return session.role === "ADMIN"
    ? {}
    : session.role === "MANAGER"
    ? { OR: [{ branch: null }, { branch: { in: myBranches } }] }
    : { AND: [{ OR: [{ branch: null }, { branch: session.branch ?? null }] }, { managersOnly: false }] };
}

// ── 같은 날 일정 순서(#243, 2026-11-05 권경욱 제안 · 디렉터 「추천대로」) ──
// 일정 칸에 순서를 두면 지점마다 보는 일정이 달라(전사 + 자기 지점) 남의 일정 아래로 못 놓고, 여러 날 일정은 날마다 순서가 엉켰다(11/5 검증).
// 그래서 **지점(관리자는 본부)마다 · 날짜마다** 그날 일정 id 를 순서대로 AppSetting 에 둔다 — 키 calendar.dayOrder:<지점>:<YYYY-MM-DD>.
// 바꾸는 사람은 원장(대표 지점) · 관리자(본부) — 「이달의 지점 공유」 순서(#240)와 같다. 지점 구성원은 그 순서로 본다.
// 목록에 없는 일정(새 일정 등)은 순서 있는 일정 뒤에 종일 먼저 · 이른 시각 순.
export const DAY_ORDER_PREFIX = "calendar.dayOrder:";
export const DAY_ORDER_MAX = 100;
export const HQ_SCOPE = "@HQ";   // 지점 이름과 겹칠 수 없는 값 — 「본부」는 실제 지점 이름이라 관리자 순서와 본부 소속 순서가 섞였다(11/5 재검증)

/** 순서를 읽는 묶음 — 관리자는 본부, 그 밖에는 대표 지점(토큰 값이 아니라 지금 DB 값) */
export async function dayOrderScope(session: { userId: string; role: string }): Promise<string | null> {
  if (session.role === "ADMIN") return HQ_SCOPE;
  return myBranch(session.userId);
}

/** 그 묶음의 날짜별 순서(from~to, "YYYY-MM-DD") — 날짜 → (일정 id → 자리) */
export async function dayRanks(scope: string, from: string, to: string): Promise<Map<string, Map<string, number>>> {
  const p = `${DAY_ORDER_PREFIX}${scope}:`;
  const rows = await prisma.appSetting.findMany({ where: { AND: [{ key: { gte: `${p}${from}` } }, { key: { lte: `${p}${to}` } }] }, select: { key: true, value: true } });
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const date = r.key.slice(`${DAY_ORDER_PREFIX}${scope}:`.length);
    try {
      const ids = JSON.parse(r.value);
      if (Array.isArray(ids)) out.set(date, new Map(ids.filter((x): x is string => typeof x === "string").map((id, i) => [id, i])));
    } catch { /* 깨진 값은 순서 없음으로 */ }
  }
  return out;
}

export const POST_MAX = 2000; // 「이달의 지점 공유」 한 건 글자 수
export const POSTS_PER_MONTH_MAX = 200; // 지점·달마다 글 수 상한

/** 글 한 건을 화면에 내려 보낼 모양 — 고치기·지우기 가능 여부를 함께(쓴 사람이면서 지금도 쓸 권한, 또는 원장·관리자) */
export function postView(
  p: { id: string; content: string; pinned: boolean; authorId: string; authorName: string | null; createdAt: Date; editedAt: Date | null },
  userId: string,
  canEdit: boolean,
  canManage: boolean
) {
  return {
    id: p.id,
    content: p.content,
    pinned: p.pinned,
    authorName: p.authorName,
    createdAt: p.createdAt,
    edited: p.editedAt !== null,
    canModify: canManage || (canEdit && p.authorId === userId),
  };
}
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
