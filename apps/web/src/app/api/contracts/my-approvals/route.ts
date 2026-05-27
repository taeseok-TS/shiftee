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
            include: { user: { select: { name: true, department: true, branch: true } } },
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

  const contracts = pendingSteps.map((step) => ({
    ...step.approvalLine.contract,
    approvalLine: {
      steps: step.approvalLine.steps,
      myStep: step,
    },
  }));

  return NextResponse.json({ contracts });
}