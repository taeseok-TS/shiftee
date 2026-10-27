import type { Prisma } from "@prisma/client";
import { branchManagers } from "@/lib/manager-branches";

// 본부 결재함 「본부 차례」 판정(2026-10-27 이예지 ⑬) — 관리자는 대기 중인 **모든** 단계를 보되(원장 단계에서 멈춘 건을 살리려고, 9/9),
// 결재 대기 숫자 · 목록 · 앱 승인 탭에는 **본부 차례인 것만** 넣고, 원장 승인 전인 건은 「원장 승인 전」 탭에 버튼 없이 따로 둔다.
//
// 결재선은 첫 단계만 PENDING, 뒤 단계는 WAITING 으로 만들어진다(api/leave POST). 그래서 PENDING 인 단계가 지금 차례다.
//   · 그 단계가 원장(MANAGER) 단계면 → 원장 승인 전(본부 차례 아님)
//   · 관리자(ADMIN) 단계거나 역할이 비어 있는(옛 지정 결재자) 단계면 → 본부 차례. 그 밖의 역할(직원 지정 등)은 그 사람 차례라 본부 차례가 아니다
//   · 결재선이 없는 신청(approvalSteps 없음)은 본부가 바로 처리 → 본부 차례

type StepLike = { approverRole: string | null; status: string };

/** 이 PENDING 단계가 본부 차례인가 */
export const isHqTurnStep = (s: StepLike) => s.status === "PENDING" && (s.approverRole === "ADMIN" || s.approverRole == null);

/** 신청(단계 목록) 기준 — 결재선이 없거나, PENDING 단계가 본부 차례면 본부 차례 */
export const isHqTurn = (steps: StepLike[]) => steps.length === 0 || steps.some(isHqTurnStep);

/**
 * 「본부 차례인 신청」 Prisma where 조각 — LeaveRequest · ScheduleRequest 의 approvalSteps 관계에 그대로 붙인다.
 * ⚠ approverRole 이 NULL 인 옛 단계도 본부 차례다 — Prisma 의 `not` 은 NULL 행을 조용히 빼므로 OR 로 쓴다.
 */
export const hqTurnRequestWhere = {
  OR: [
    { approvalSteps: { none: {} } },
    { approvalSteps: { some: { status: "PENDING", OR: [{ approverRole: null }, { approverRole: "ADMIN" }] } } },
  ],
} satisfies Prisma.LeaveRequestWhereInput & Prisma.ScheduleRequestWhereInput;

/**
 * 결재 진행 칸의 「[대치] 원장」을 사람 이름으로(2026-10-27 이예지 ⑨) — 승인 전 원장 단계는 approver 가 비어 있어
 * 역할 이름만 보였다. 지점에 원장이 둘이면(대치) 둘 다 적는다(못박지 않은 단계는 둘 중 누구든 결재할 수 있다).
 * steps[].branch 별로 한 번씩만 조회해 candidates(이름 목록)를 붙여 돌려준다.
 */
export async function withManagerCandidates<S extends { approverRole: string | null; branch?: string | null; approver?: { name: string } | null }>(
  stepsList: S[][],
): Promise<Map<string, string[]>> {
  const branches = new Set<string>();
  for (const steps of stepsList) for (const s of steps) if (s.approverRole === "MANAGER" && !s.approver && s.branch) branches.add(s.branch);
  const out = new Map<string, string[]>();
  await Promise.all([...branches].map(async (b) => {
    const names = (await branchManagers(b).catch(() => [] as { name: string }[])).map((m) => m.name);
    out.set(b, names);
  }));
  return out;
}

/** 단계마다 candidates 를 붙인다(원장 단계 · 승인 전 · 지점 있음일 때만) */
export function attachCandidates<S extends { approverRole: string | null; branch?: string | null; approver?: { name: string } | null }>(
  steps: S[], names: Map<string, string[]>,
): (S & { candidates?: string[] })[] {
  return steps.map((s) => {
    if (s.approverRole === "MANAGER" && !s.approver && s.branch && names.get(s.branch)?.length) return { ...s, candidates: names.get(s.branch) };
    return s;
  });
}
