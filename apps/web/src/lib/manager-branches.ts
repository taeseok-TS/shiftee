import { prisma } from "@/lib/db";

// 원장(MANAGER)의 담당 지점 목록 = 대표 지점(User.branch) + 겸직 지점(ManagerBranch).
// 대표 지점은 세션(토큰 박제)이 아닌 DB에서 읽는다 — 지점명 변경 직후에도 정확.
// 반환이 빈 배열이면 담당 지점 없음 → { branch: { in: [] } } 필터는 아무것도 매칭하지 않음(안전).
export async function getManagerBranches(userId: string): Promise<string[]> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { branch: true, managerBranches: { select: { branchName: true } } },
  });
  if (!me) return [];
  const set = new Set<string>();
  if (me.branch) set.add(me.branch);
  for (const b of me.managerBranches) set.add(b.branchName);
  return [...set];
}

// 특정 지점을 담당하는 활성 원장이 있는지 (결재 라우팅용 — 대표/겸직 모두 인정)
export async function branchHasManager(branch: string): Promise<boolean> {
  const count = await prisma.user.count({
    where: {
      role: "MANAGER",
      isActive: true,
      OR: [{ branch }, { managerBranches: { some: { branchName: branch } } }],
    },
  });
  return count > 0;
}
