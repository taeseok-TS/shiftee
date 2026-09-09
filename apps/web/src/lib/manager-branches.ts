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

// 특정 지점을 담당하는 활성 원장들 (결재 알림 대상 — 대표/겸직 모두 인정)
export async function branchManagers(branch: string): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    where: {
      role: "MANAGER",
      isActive: true,
      OR: [{ branch }, { managerBranches: { some: { branchName: branch } } }],
    },
    select: { id: true, name: true },
  });
}

/**
 * 그 지점을 담당하는 **다른** 원장이 있는지 (본인 제외).
 *
 * 원장 신청의 결재선을 만들 때 쓴다 — 원장도 자기 지점을 함께 보는 다른 원장에게
 * 먼저 결재를 받는다(2026-09-09 디렉터 지시):
 *  · 한 지점에 원장이 2명이면 서로가 상대의 결재자가 된다(메인 원장이 두 번째 원장을 결재)
 *  · 겸직 원장은 자기가 관리하는 다른 지점의 원장도 결재할 수 있다
 * 그 뒤에 **관리자 승인이 반드시 따라붙는다.**
 */
export async function branchHasOtherManager(branch: string, exceptUserId: string): Promise<boolean> {
  const count = await prisma.user.count({
    where: {
      role: "MANAGER",
      isActive: true,
      id: { not: exceptUserId },
      OR: [{ branch }, { managerBranches: { some: { branchName: branch } } }],
    },
  });
  return count > 0;
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
