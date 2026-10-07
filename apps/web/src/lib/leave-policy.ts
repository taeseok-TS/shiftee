import { prisma } from "@/lib/db";
import { branchHasManager } from "@/lib/manager-branches";

export type PolicyStep = { approverRole: string; branch: string | null; approverId?: string };

/**
 * 휴가 결재선 — 휴가 신청(POST /api/leave)과 **취소 결재**(POST /api/leave/[id]/cancel-request)가
 * **같은 함수**를 쓴다. 복사해 두면 한쪽만 고치는 짝 누락이 반드시 생긴다(이 작업의 반복 결함).
 *
 * ── 역할/지점 기반 자동 결재 정책 (2026-10-07 본부 답변 #1 — 시프티 설정과 같게) ──
 *  직원: 일수와 무관하게 [소속 지점 원장 → 관리자] (지점에 원장이 없으면 [관리자])
 *  원장: [관리자] 1단계 — 겸직·메인 원장 구분 없이(종전 9/9 「메인 원장이 먼저」 규칙은 휴가에서 뺐다)
 *  관리자 본인: 다른 관리자 1명 결재(없으면 자동 승인) — 본부는 큐브티 휴가 대상이 아니지만(#2) 막지는 않는다
 *  **취소 결재(forCancel)**: 신청과 같은 결재선(종전 9/11 「항상 관리자까지」와 결과가 같다).
 */
export async function leavePolicySteps(
  userId: string,
  opts: { days: number; forCancel?: boolean }
): Promise<PolicyStep[]> {
  const submitter = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, branch: true },
  });
  const adminStep = { approverRole: "ADMIN", branch: null as string | null };
  const managerStep = { approverRole: "MANAGER", branch: submitter?.branch ?? null };
  const hasBranchManager = submitter?.branch
    ? await branchHasManager(submitter.branch) // 대표/겸직 모두 인정
    : false;

  let policySteps: PolicyStep[] = [];
  void opts; // 일수·취소 여부와 무관해졌다(10/7) — 호출부 호환을 위해 인자는 그대로 받는다
  if (submitter?.role === "MANAGER") {
    policySteps = [adminStep];
  } else if (submitter?.role === "ADMIN") {
    const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { not: userId } } });
    policySteps = otherAdmins > 0 ? [adminStep] : [];
  } else {
    policySteps = hasBranchManager ? [managerStep, adminStep] : [adminStep];
  }
  return policySteps;
}
