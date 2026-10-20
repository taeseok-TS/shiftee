// 큐브티워크 캘린더 공통 — 일정 시각(#221)·「이달의 지점 공유」 메모(#222), 2026-10-20
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";

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
 * 관리자 = 모든 지점 / 원장 = 담당 지점(대표+겸직) / 직원 = 자기 지점 — 모두 쓸 수 있다
 * (2026-10-20 디렉터: 지점 구성원끼리 보는 건 직원도 설정해도 된다, 다른 지점에는 보이면 안 된다).
 * 직원 지점은 토큰 값이 아니라 DB 에서 읽는다(지점명 변경이 바로 반영되게).
 */
export async function noteScope(session: { userId: string; role: string }): Promise<{ branches: string[]; canEdit: boolean }> {
  if (session.role === "ADMIN") {
    const rows = await prisma.branch.findMany({ where: { isActive: true }, select: { name: true }, orderBy: { name: "asc" } });
    return { branches: rows.map((r) => r.name), canEdit: true };
  }
  if (session.role === "MANAGER") return { branches: await getManagerBranches(session.userId), canEdit: true };
  const b = await myBranch(session.userId);
  return { branches: b ? [b] : [], canEdit: true };
}

/** 내 소속 지점 — 토큰이 아니라 DB 값 */
export async function myBranch(userId: string): Promise<string | null> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { branch: true } });
  return me?.branch || null;
}
