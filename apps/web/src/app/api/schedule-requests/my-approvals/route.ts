import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 내가 결재해야 하는 근무일정 신청 목록
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const steps = await prisma.scheduleApprovalStep.findMany({
    where: {
      approverId: session.userId,
      status: "PENDING",
    },
    include: {
      scheduleRequest: {
        include: {
          user: { select: { id: true, name: true, department: true, position: true, branch: true } },
          approvalSteps: {
            include: {
              approver: { select: { id: true, name: true, position: true, branch: true } },
            },
            orderBy: { order: "asc" },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ steps });
}
