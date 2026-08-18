import { prisma } from "@/lib/db";

// 인원 "숫자"를 셀 때 쓰는 공용 기준.
//
// 큐브티는 지점에서 근무하는 인원을 관리한다. 그래서 집계에서 두 가지를 뺀다.
//   1) 관리자(서브 포함) — 전원 본부 소속이라 지점 인원이 아니다
//   2) 지점 관리에서 "통계 포함"을 끈 지점 소속 — 본부·테스트지점 등
//
// 주의: 이건 카운트용이다. 연차 부여·결재선·봇 축하처럼 그 사람을 대상으로 하는
// 기능에는 쓰지 말 것(빼면 관리자 본인 연차가 사라진다).

/** 지점 관리에서 "통계 포함"이 꺼진 지점명 목록 */
export async function excludedBranchNames(): Promise<string[]> {
  const rows = await prisma.branch.findMany({
    where: { countInStats: false },
    select: { name: true },
  });
  return rows.map((b) => b.name);
}

type Options = {
  /** 화면의 "관리자 포함" 체크박스가 켜졌을 때만 true */
  includeAdmins?: boolean;
  /** 원장 담당 지점 등으로 범위를 좁힐 때 (getManagerBranches 결과) */
  branches?: string[];
};

/**
 * 집계 대상 직원의 prisma where.
 * 지점을 지정하면 그 안에서도 통계 제외 지점은 다시 걸러진다.
 */
export async function countableEmployeeWhere(opts: Options = {}) {
  const excluded = await excludedBranchNames();

  // 지점을 지정받은 경우: 지정 지점에서 제외 지점을 뺀 목록으로 좁힌다
  if (opts.branches) {
    const allowed = opts.branches.filter((b) => !excluded.includes(b));
    return {
      ...(opts.includeAdmins ? {} : { role: { not: "ADMIN" as const } }),
      isActive: true,
      deletedAt: null,
      employmentStatus: "ACTIVE" as const,
      branch: { in: allowed },
    };
  }

  // 전체 조회: 소속 없는 인원은 남기고, 제외 지점 소속만 뺀다
  return {
    ...(opts.includeAdmins ? {} : { role: { not: "ADMIN" as const } }),
    isActive: true,
    deletedAt: null,
    employmentStatus: "ACTIVE" as const,
    ...(excluded.length > 0
      ? { OR: [{ branch: null }, { branch: { notIn: excluded } }] }
      : {}),
  };
}
