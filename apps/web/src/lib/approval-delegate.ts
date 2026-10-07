import { prisma } from "@/lib/db";
import { kstTodayDateUTC } from "@/lib/kst";
import { getManagerBranches, branchHasManager } from "@/lib/manager-branches";
import { isResigned } from "@/lib/resign";

// ─── 원장대행(2026-10-07 본부 답변 #3) ───────────────────────────
// 본부가 지점·대행자·기간을 정해 지정한다. 기간 안에는 그 지점의 **원장 결재**(휴가·근무일정·휴가 취소)를
// 원장과 똑같이 할 수 있다. 계약서 서명은 대행하지 않는다. 팀 화면(직원·출퇴근 등) 권한도 주지 않는다 — 결재만.
// 대행자는 원장(다른 지점)일 수도, 매니저(EMPLOYEE)일 수도 있다.
// 기간은 KST 날짜로 시작일~종료일(포함). 해제(revokedAt)하면 즉시 끝난다.

/** 오늘(KST) 이 사람이 대행 중인 지점 */
export async function activeDelegateBranches(userId: string): Promise<string[]> {
  const today = kstTodayDateUTC();
  const rows = await prisma.approvalDelegate.findMany({
    where: { delegateId: userId, revokedAt: null, startDate: { lte: today }, endDate: { gte: today } },
    select: { branch: true },
  });
  return [...new Set(rows.map((r) => r.branch))];
}

/** 오늘(KST) 이 지점을 대행 중인 사람(활성 계정만) */
export async function branchDelegates(branch: string): Promise<string[]> {
  const today = kstTodayDateUTC();
  const rows = await prisma.approvalDelegate.findMany({
    where: { branch, revokedAt: null, startDate: { lte: today }, endDate: { gte: today } },
    select: { delegateId: true },
  });
  if (rows.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.delegateId) }, isActive: true, deletedAt: null },
    select: { id: true, resignDate: true },
  });
  return users.filter((u) => !isResigned(u.resignDate)).map((u) => u.id);
}

/** 이 지점에 원장 단계를 둘지 — 원장이 있거나, 오늘 대행자가 있으면(원장 공석 때 대행을 세운 경우) */
export async function branchHasApprover(branch: string): Promise<boolean> {
  if (await branchHasManager(branch)) return true;
  return (await branchDelegates(branch)).length > 0;
}

/**
 * 이 사람이 **원장 단계 결재**를 할 수 있는 지점.
 *  · own: 원장이면 담당 지점(대표+겸직)
 *  · delegated: 오늘 대행 중인 지점
 *  · all: 둘을 합친 것
 * 관리자는 모든 단계를 처리할 수 있으므로 빈 값이다(관리자 판정은 따로 한다).
 */
export type ApproverScope = { own: string[]; delegated: string[]; all: string[] };

export async function approverScopeFor(session: { userId: string; role: string }): Promise<ApproverScope> {
  if (session.role === "ADMIN") return { own: [], delegated: [], all: [] };
  const own = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const delegated = await activeDelegateBranches(session.userId);
  return { own, delegated, all: [...new Set([...own, ...delegated])] };
}

type StepLike = { status: string; approverRole: string | null; branch: string | null; approverId: string | null };

/**
 * 이 단계가 지금 내 결재 차례인가 — 휴가·근무일정·휴가 취소 결재 라우트가 같이 쓴다.
 *  · 사람을 못박은 단계(메인 원장 등)는 그 사람만.
 *  · 관리자 단계는 관리자만.
 *  · 못박지 않은 원장 단계는 담당 지점 원장.
 *  · **대행자**는 그 지점의 원장 단계(못박힌 것 포함)를 처리한다 — 원장이 자리를 비워 대행을 세운 건데
 *    못박힌 건만 멈추면 대행의 뜻이 없다. 단 **원장이 올린 건은 대행하지 않는다**(코디·매니저가 상급자 건을
 *    결재하지 않게 — 2026-10-07 검증 지적). 그 건은 못박힌 원장이나 본부가 처리한다.
 * requesterRole 은 신청자의 역할. 결재함 조건(myStepOr)과 반드시 같은 규칙이어야 한다.
 */
export function isMyStep(
  s: StepLike,
  session: { userId: string; role: string },
  scope: ApproverScope,
  requesterRole: string | null | undefined,
): boolean {
  if (s.status !== "PENDING") return false;
  if (s.approverId === session.userId) return true;
  if (s.approverRole === "ADMIN") return !s.approverId && session.role === "ADMIN";
  if (s.approverRole !== "MANAGER" || !s.branch || session.role === "ADMIN") return false;
  if (!s.approverId && scope.own.includes(s.branch)) return true;
  return scope.delegated.includes(s.branch) && requesterRole !== "MANAGER";
}

/**
 * 결재함·대시보드 숫자용 조건(관리자가 아닌 사람). isMyStep 과 같은 규칙을 Prisma where 로 옮긴 것.
 * rel 은 단계에서 신청 건으로 가는 관계 이름(신청자 역할을 보려고) — 휴가 leaveRequest, 근무일정 scheduleRequest, 취소 cancelRequest.
 */
export function myStepOr(
  session: { userId: string },
  scope: ApproverScope,
  rel: "leaveRequest" | "scheduleRequest" | "cancelRequest",
) {
  return [
    { approverId: session.userId },
    ...(scope.own.length ? [{ approverRole: "MANAGER", branch: { in: scope.own }, approverId: null }] : []),
    ...(scope.delegated.length
      ? [{ approverRole: "MANAGER", branch: { in: scope.delegated }, [rel]: { user: { role: { not: "MANAGER" as const } } } }]
      : []),
  ];
}
