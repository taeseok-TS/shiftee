import { prisma } from "@/lib/db";
import { branchHasManager, branchHasOtherManager, getManagerBranches, branchMainManager } from "@/lib/manager-branches";

export type PolicyStep = { approverRole: string; branch: string | null; approverId?: string };

/**
 * 휴가 결재선 — 휴가 신청(POST /api/leave)과 **취소 결재**(POST /api/leave/[id]/cancel-request)가
 * **같은 함수**를 쓴다. 복사해 두면 한쪽만 고치는 짝 누락이 반드시 생긴다(이 작업의 반복 결함).
 *
 * ── 역할/지점 기반 자동 결재 정책 ──
 *  2일 이상: 직원 → [소속 지점 원장 → 관리자],  원장 → [관리자]
 *  1일 이하: 직원 → [소속 지점 원장],          원장 → [관리자]
 *  관리자 본인: 다른 관리자 1명 결재(없으면 자동 승인)
 *  **취소 결재(forCancel)**: 일수와 무관하게 **항상 관리자까지** — 직원은 [원장 → 관리자]
 *  (디렉터 9/11). 원장·관리자는 신청과 같다(원래도 관리자까지 간다).
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
  if (submitter?.role === "MANAGER") {
    // ⚠ 원장도 **관리자 승인이 필수**다(디렉터 지시).
    //
    //  · **겸직(멀티) 원장이 신청자면 바로 관리자 결재로 간다** (2026-09-09 디렉터 지시).
    //    여러 지점을 총괄하는 사람이라 같은 급의 원장에게 먼저 받을 이유가 없다.
    //  · 단일 지점 원장은, 그 지점을 함께 보는 다른 원장이 있으면 그 원장이 먼저 결재한다
    //    — 한 지점에 원장이 2명이면 서로가 상대의 결재자가 되고, 겸직 원장은 자기가
    //    관리하는 다른 지점의 원장을 결재한다.
    //  · 그런 원장이 없으면 관리자 단독.
    //  (자기 신청을 자기가 결재하는 것은 결재 라우트에서 막는다)
    const myBranches = await getManagerBranches(userId);
    const isMultiBranch = myBranches.length > 1;

    // 메인 원장이 지정돼 있으면 **방향이 정해진다** — 메인이 두 번째를 결재한다.
    // 메인 원장 본인이 신청하면 겸직 원장과 같이 관리자에게 바로 간다.
    const main = !isMultiBranch && submitter.branch
      ? await branchMainManager(submitter.branch)
      : null;

    if (main && main.id !== userId) {
      // 두 번째 원장의 신청 → [메인 원장 → 관리자]. 지정 결재자로 못박는다.
      policySteps = [{ approverRole: "MANAGER", branch: submitter.branch ?? null, approverId: main.id }, adminStep];
    } else if (main) {
      policySteps = [adminStep];               // 메인 원장 본인 → 관리자 바로
    } else {
      // 메인 지정이 없으면 종전대로 — 같은 지점에 다른 원장이 있으면 그 원장이 먼저.
      const peer = !isMultiBranch && submitter.branch
        ? await branchHasOtherManager(submitter.branch, userId)
        : false;
      policySteps = peer ? [managerStep, adminStep] : [adminStep];
    }
  } else if (submitter?.role === "ADMIN") {
    const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { not: userId } } });
    policySteps = otherAdmins > 0 ? [adminStep] : [];
  } else {
    // 취소 결재는 일수와 무관하게 관리자까지(디렉터 9/11 "항상 관리자까지")
    if (opts.forCancel || opts.days >= 2) policySteps = hasBranchManager ? [managerStep, adminStep] : [adminStep];
    else policySteps = hasBranchManager ? [managerStep] : [adminStep];
  }
  return policySteps;
}
