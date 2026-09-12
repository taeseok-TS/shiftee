// 자료제출 대상자 풀기 — "이 요청은 누구에게 걸린 것인가" (2026-09-13)
//
// 대상 축은 직군(jobGroup)·지점(branch) 둘. 빈 배열은 "전부". 본부(ADMIN)와 봇(isActive=false)은
// 제출 대상이 아니다. 퇴사일이 지난 사람도 뺀다(branchManagers 와 같은 기준).
import { prisma } from "@/lib/db";
import { kstTodayMidnight } from "@/lib/resign";

export type TargetUser = { id: string; name: string; branch: string | null; jobGroup: string | null; position: string | null };

type TargetSpec = { targetJobGroups: string[]; targetBranches: string[] };

export async function targetUsersFor(spec: TargetSpec): Promise<TargetUser[]> {
  return prisma.user.findMany({
    where: {
      role: { not: "ADMIN" },
      isActive: true,
      deletedAt: null,
      employmentStatus: { not: "RESIGNED" },
      AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }] }],
      ...(spec.targetJobGroups.length ? { jobGroup: { in: spec.targetJobGroups } } : {}),
      ...(spec.targetBranches.length ? { branch: { in: spec.targetBranches } } : {}),
    },
    select: { id: true, name: true, branch: true, jobGroup: true, position: true },
    orderBy: [{ branch: "asc" }, { name: "asc" }],
  });
}

/** 한 사람이 이 요청의 대상인가 (목록·뱃지에서 "내게 걸린 요청" 판정) */
export function isTargeted(u: { role: string; branch: string | null; jobGroup: string | null }, spec: TargetSpec): boolean {
  if (u.role === "ADMIN") return false;
  if (spec.targetJobGroups.length && !(u.jobGroup && spec.targetJobGroups.includes(u.jobGroup))) return false;
  if (spec.targetBranches.length && !(u.branch && spec.targetBranches.includes(u.branch))) return false;
  return true;
}

/** Prisma where — "내게 걸린 요청": 직군·지점 조건이 비었거나 나를 포함 */
export function requestsTargetingWhere(u: { branch: string | null; jobGroup: string | null }) {
  return {
    AND: [
      { OR: [{ targetJobGroups: { isEmpty: true } }, ...(u.jobGroup ? [{ targetJobGroups: { has: u.jobGroup } }] : [])] },
      { OR: [{ targetBranches: { isEmpty: true } }, ...(u.branch ? [{ targetBranches: { has: u.branch } }] : [])] },
    ],
  };
}

/** 공유 알림 대상 — 직군 목록("*" 면 본부 제외 전원) */
export async function usersInJobGroups(groups: string[]): Promise<{ id: string }[]> {
  if (!groups.length) return [];
  const all = groups.includes("*");
  return prisma.user.findMany({
    where: {
      role: { not: "ADMIN" },
      isActive: true,
      deletedAt: null,
      employmentStatus: { not: "RESIGNED" },
      AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }] }],
      ...(all ? {} : { jobGroup: { in: groups } }),
    },
    select: { id: true },
  });
}
