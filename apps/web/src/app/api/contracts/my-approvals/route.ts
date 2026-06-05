import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const pendingSteps = await prisma.contractApprovalStep.findMany({
    where: {
      approverId: session.userId,
      status: "PENDING",
    },
    include: {
      approvalLine: {
        include: {
          contract: {
            include: { user: { select: { id: true, name: true, email: true, department: true, branch: true } } },
          },
          steps: {
            include: { approver: { select: { id: true, name: true, branch: true } } },
            orderBy: { order: "asc" },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // 데이터 필터링 적용: 직원 정보에서 이메일 제거
  const contracts = pendingSteps.map((step) => ({
    ...step.approvalLine.contract,
    user: {
      id: step.approvalLine.contract.user.id,
      name: step.approvalLine.contract.user.name,
      department: step.approvalLine.contract.user.department,
      branch: step.approvalLine.contract.user.branch,
    },
    approvalLine: {
      steps: step.approvalLine.steps.map(s => ({
        ...s,
        approver: {
          id: s.approver.id,
          name: s.approver.name,
          branch: s.approver.branch,
        },
      })),
      myStep: step,
    },
  }));

  return NextResponse.json({ contracts });
}