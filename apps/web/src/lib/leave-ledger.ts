import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { isLeaveDeductible } from "@/lib/leave-types";

/**
 * 직원별 **연차 대장** — "저 연차 이렇게 안 썼는데요?" 같은 분쟁 때 보여줄 근거를 한 곳에 모은다(디렉터 9/11).
 * 그 해(= 휴가를 쓰는 해, 시작일 연도 — lib/leave-calc.ts leaveYearOfLeave 와 같은 기준)의 휴가 **전부**
 * (승인·반려·취소·대기)와 단계별 결재자·시각, 취소 결재와 그 결재선, 잔여 조정 이력(감사 로그), 잔여 행을 묶는다.
 * 기록은 지우지 않는다 — 휴가는 상태만 바뀌고, 감사 로그는 삭제 경로가 없다(9/11 확인).
 *
 * 열람 권한(디렉터 확정 9/11): 관리자 = 전 직원 · 원장 = 담당 지점 직원(+본인) · 직원 = 본인.
 * **PDF 내려받기는 관리자만**(api/leave/ledger/pdf).
 */

export type LedgerAccess = "ok" | "forbidden" | "notfound";

export async function ledgerAccess(
  session: { userId: string; role: string },
  targetUserId: string
): Promise<LedgerAccess> {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { role: true, branch: true },
  });
  if (!target) return "notfound";
  if (session.role === "ADMIN") return "ok";
  if (targetUserId === session.userId) return "ok";
  if (session.role === "MANAGER") {
    // 원장은 담당 지점(대표+겸직)의 **직원**만 — 다른 원장·관리자의 대장은 보지 않는다
    if (target.role !== "EMPLOYEE" || !target.branch) return "forbidden";
    const mine = await getManagerBranches(session.userId);
    return mine.includes(target.branch) ? "ok" : "forbidden";
  }
  return "forbidden";
}

type StepOut = {
  order: number;
  role: string | null;
  approverName: string | null;
  status: string;
  decidedAt: string | null;
  comment: string | null;
};

export type Ledger = {
  user: { id: string; name: string; branch: string | null; position: string | null; hireDate: string | null };
  year: number;
  balance: { total: number; used: number; remaining: number } | null;
  entries: {
    id: string;
    type: string;
    startDate: string;
    endDate: string;
    days: number;
    status: string;
    deductible: boolean;
    reason: string | null;
    rejectedReason: string | null;
    createdAt: string;
    steps: StepOut[];
    cancelRequests: {
      id: string;
      status: string;
      reason: string | null;
      rejectedReason: string | null;
      createdAt: string;
      steps: StepOut[];
    }[];
  }[];
  adjustments: { at: string; actorName: string; detail: string | null }[];
  summary: { approvedDeductibleDays: number; balanceUsed: number | null; match: boolean | null };
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function buildLedger(userId: string, year: number): Promise<Ledger | null> {
  // 휴가 연도 = 시작일(@db.Date, UTC 자정)의 연도 — [그 해 1/1, 다음 해 1/1)
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  // 감사 로그 시각은 실제 시각이라 KST 달력 연도로 자른다
  const kFrom = new Date(from.getTime() - 9 * 3600 * 1000);
  const kTo = new Date(to.getTime() - 9 * 3600 * 1000);

  const [user, balance, leaves, adjustments] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, branch: true, position: true, hireDate: true },
    }),
    prisma.leaveBalance.findUnique({
      where: { userId_year: { userId, year } },
      select: { total: true, used: true, remaining: true },
    }),
    prisma.leaveRequest.findMany({
      where: { userId, startDate: { gte: from, lt: to } },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      include: {
        approvalSteps: { orderBy: { order: "asc" }, include: { approver: { select: { name: true } } } },
        cancelRequests: {
          orderBy: { createdAt: "asc" },
          include: { approvalSteps: { orderBy: { order: "asc" }, include: { approver: { select: { name: true } } } } },
        },
      },
    }),
    // 잔여 조정 이력 — 개별 조정과 일괄 업로드(사람별로 남긴다) 모두 LEAVE_BALANCE_UPDATE + targetId=직원
    prisma.auditLog.findMany({
      where: { targetId: userId, action: "LEAVE_BALANCE_UPDATE", createdAt: { gte: kFrom, lt: kTo } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, actorName: true, detail: true },
    }),
  ]);
  if (!user) return null;

  const stepsOut = (steps: { order: number; approverRole: string | null; approver: { name: string } | null; status: string; decidedAt: Date | null; comment: string | null }[]): StepOut[] =>
    steps.map((s) => ({
      order: s.order,
      role: s.approverRole,
      approverName: s.approver?.name ?? null,
      status: s.status,
      decidedAt: iso(s.decidedAt),
      comment: s.comment,
    }));

  const entries = leaves.map((l) => ({
    id: l.id,
    type: l.type,
    startDate: l.startDate.toISOString().slice(0, 10),
    endDate: l.endDate.toISOString().slice(0, 10),
    days: l.days,
    status: l.status,
    deductible: isLeaveDeductible(l.type),
    reason: l.reason,
    rejectedReason: l.rejectedReason,
    createdAt: l.createdAt.toISOString(),
    steps: stepsOut(l.approvalSteps),
    cancelRequests: l.cancelRequests.map((c) => ({
      id: c.id,
      status: c.status,
      reason: c.reason,
      rejectedReason: c.rejectedReason,
      createdAt: c.createdAt.toISOString(),
      steps: stepsOut(c.approvalSteps),
    })),
  }));

  // 대조 — 승인된 차감 휴가 합계와 잔여 행의 "사용"이 맞는가(다르면 잔여 조정 이력으로 설명돼야 한다)
  const approvedDeductibleDays = Math.round(
    entries.filter((e) => e.status === "APPROVED" && e.deductible).reduce((a, e) => a + e.days, 0) * 100
  ) / 100;
  const balanceUsed = balance ? balance.used : null;

  return {
    user: { id: user.id, name: user.name, branch: user.branch, position: user.position, hireDate: iso(user.hireDate) },
    year,
    balance,
    entries,
    adjustments: adjustments.map((a) => ({ at: a.createdAt.toISOString(), actorName: a.actorName, detail: a.detail })),
    summary: {
      approvedDeductibleDays,
      balanceUsed,
      match: balanceUsed === null ? null : Math.abs(approvedDeductibleDays - balanceUsed) < 0.001,
    },
  };
}
