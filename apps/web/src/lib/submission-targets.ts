// 자료제출 대상자 풀기 — "이 요청은 누구에게 걸린 것인가" (2026-09-13)
//
// 대상 축은 직군(jobGroup)·지점(branch) 둘. 빈 배열은 "전부". 본부(ADMIN)와 봇(isActive=false)은
// 제출 대상이 아니다. 퇴사일이 지난 사람도 뺀다(branchManagers 와 같은 기준).
import { prisma } from "@/lib/db";
import { kstTodayMidnight } from "@/lib/resign";

export type TargetUser = { id: string; name: string; branch: string | null; jobGroup: string | null; position: string | null };

// 세 번째 축: 사람 직접 지정(targetUserIds). 비어 있지 않으면 **그 사람들에게만** — 직군·지점은 무시한다.
// (2026-09-14 디렉터: "지점이 다 다른 CM 7명"에게 걸 때 직군×지점으로는 수십 명에게 나간다)
type TargetSpec = { targetJobGroups: string[]; targetBranches: string[]; targetUserIds?: string[] };

/** 제출 대상이 될 수 있는 사람의 공통 조건 — 본부·봇·퇴사자 제외 */
export function eligibleTargetWhere() {
  return {
    role: { not: "ADMIN" as const },
    isActive: true,
    deletedAt: null,
    employmentStatus: { not: "RESIGNED" as const },
    AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }] }],
  };
}

export async function targetUsersFor(spec: TargetSpec): Promise<TargetUser[]> {
  const ids = spec.targetUserIds ?? [];
  return prisma.user.findMany({
    where: {
      ...eligibleTargetWhere(),
      ...(ids.length
        ? { id: { in: ids } }
        : {
            ...(spec.targetJobGroups.length ? { jobGroup: { in: spec.targetJobGroups } } : {}),
            ...(spec.targetBranches.length ? { branch: { in: spec.targetBranches } } : {}),
          }),
    },
    select: { id: true, name: true, branch: true, jobGroup: true, position: true },
    orderBy: [{ branch: "asc" }, { name: "asc" }],
  });
}

// 호출처마다 사람 객체 모양이 다르다: 화면 뷰어는 userId, API 키 사용자는 id
type PersonLike = { id?: string; userId?: string; role?: string; branch: string | null; jobGroup: string | null };
const personId = (u: PersonLike) => u.id ?? u.userId ?? null;

/** 한 사람이 이 요청의 대상인가 (목록·뱃지에서 "내게 걸린 요청" 판정) */
export function isTargeted(u: PersonLike & { role: string }, spec: TargetSpec): boolean {
  if (u.role === "ADMIN") return false;
  const ids = spec.targetUserIds ?? [];
  if (ids.length) { const id = personId(u); return !!id && ids.includes(id); }
  if (spec.targetJobGroups.length && !(u.jobGroup && spec.targetJobGroups.includes(u.jobGroup))) return false;
  if (spec.targetBranches.length && !(u.branch && spec.targetBranches.includes(u.branch))) return false;
  return true;
}

/** Prisma where — "내게 걸린 요청": 나를 콕 집었거나, (사람 지정이 없고) 직군·지점 조건이 비었거나 나를 포함 */
export function requestsTargetingWhere(u: PersonLike) {
  const id = personId(u);
  return {
    OR: [
      ...(id ? [{ targetUserIds: { has: id } }] : []),
      {
        AND: [
          { targetUserIds: { isEmpty: true } },
          { OR: [{ targetJobGroups: { isEmpty: true } }, ...(u.jobGroup ? [{ targetJobGroups: { has: u.jobGroup } }] : [])] },
          { OR: [{ targetBranches: { isEmpty: true } }, ...(u.branch ? [{ targetBranches: { has: u.branch } }] : [])] },
        ],
      },
    ],
  };
}

/** 대상 표기 — 목록·감사로그·DM 공용 */
export function targetLabel(spec: TargetSpec, names?: string[]): string {
  const ids = spec.targetUserIds ?? [];
  if (ids.length) {
    const shown = (names ?? []).slice(0, 3).join("·");
    const rest = ids.length - Math.min(3, (names ?? []).length);
    return `직접 지정 ${ids.length}명${shown ? ` (${shown}${rest > 0 ? ` 외 ${rest}명` : ""})` : ""}`;
  }
  return `${spec.targetJobGroups.length ? spec.targetJobGroups.join("·") : "전 직군"}${spec.targetBranches.length ? ` (${spec.targetBranches.join("·")})` : ""}`;
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
