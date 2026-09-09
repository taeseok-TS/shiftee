import { prisma } from "@/lib/db";
import { kstTodayMidnight } from "@/lib/resign";

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
      deletedAt: null,
      // 퇴사일이 지난 사람은 로그인이 안 된다(getSession 이 막는다). 결재선에 넣으면
      // 그 건이 멈추므로 여기서도 뺀다 — 함수마다 기준이 다르면 라우팅이 갈린다
      // (2026-09-09 검증에서 적발: branchMainManager 에만 있었다).
      // ⚠ 지점 조건에도 OR 을 쓰므로 **AND 로 감싼다.** 같은 객체에 OR 을 두 번 쓰면
      //   뒤엣것이 앞엣것을 덮어써서 퇴사자 필터가 통째로 사라진다.
      AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }] }],
      OR: [{ branch }, { managerBranches: { some: { branchName: branch } } }],
    },
    select: { id: true, name: true },
  });
}

/**
 * 그 지점의 **메인 원장**(있으면). 한 지점에 원장이 2명일 때 누가 상급인지를 말한다
 * — 지점 관리 화면에서 지정한다(2026-09-09 디렉터 지시).
 * 지정된 사람이 퇴사.비활성이면 없는 것으로 본다(결재가 멈추면 안 된다).
 */
export async function branchMainManager(branch: string): Promise<{ id: string; name: string } | null> {
  const b = await prisma.branch.findFirst({
    where: { name: branch, isActive: true },
    select: {
      mainManager: {
        select: { id: true, name: true, isActive: true, role: true, deletedAt: true, resignDate: true },
      },
    },
  });
  const m = b?.mainManager;
  // ⚠ 로그인할 수 없는 사람에게 결재를 못박으면 그 건이 멈춘다. getSession 과 **같은 기준**
  //   으로 본다 — 비활성.삭제.퇴사일 경과(2026-09-09 검증에서 적발: isActive 만 봤다).
  if (!m || !m.isActive || m.deletedAt || m.role !== "MANAGER") return null;
  const { isResigned } = await import("@/lib/resign");
  if (isResigned(m.resignDate)) return null;
  return { id: m.id, name: m.name };
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
      deletedAt: null,
      // 퇴사일이 지난 사람은 로그인이 안 된다(getSession 이 막는다). 결재선에 넣으면
      // 그 건이 멈추므로 여기서도 뺀다 — 함수마다 기준이 다르면 라우팅이 갈린다
      // (2026-09-09 검증에서 적발: branchMainManager 에만 있었다).
      // ⚠ 지점 조건에도 OR 을 쓰므로 **AND 로 감싼다.** 같은 객체에 OR 을 두 번 쓰면
      //   뒤엣것이 앞엣것을 덮어써서 퇴사자 필터가 통째로 사라진다.
      AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }] }],
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
      deletedAt: null,
      // 퇴사일이 지난 사람은 로그인이 안 된다(getSession 이 막는다). 결재선에 넣으면
      // 그 건이 멈추므로 여기서도 뺀다 — 함수마다 기준이 다르면 라우팅이 갈린다
      // (2026-09-09 검증에서 적발: branchMainManager 에만 있었다).
      // ⚠ 지점 조건에도 OR 을 쓰므로 **AND 로 감싼다.** 같은 객체에 OR 을 두 번 쓰면
      //   뒤엣것이 앞엣것을 덮어써서 퇴사자 필터가 통째로 사라진다.
      AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }] }],
      OR: [{ branch }, { managerBranches: { some: { branchName: branch } } }],
    },
  });
  return count > 0;
}
