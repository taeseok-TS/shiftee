import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 내가 결재해야 하는 휴가 신청 목록
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const steps = await prisma.leaveApprovalStep.findMany({
    where: {
      approverId: session.userId,
      status: "PENDING",
    },
    include: {
      leaveRequest: {
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

  // 관리자: 결재라인이 없는 대기 신청도 결재함에 표시 (직접 승인/반려 대상)
  if (session.role === "ADMIN") {
    const noLineRequests = await prisma.leaveRequest.findMany({
      where: {
        status: "PENDING",
        approvalSteps: { none: {} },
      },
      include: {
        user: { select: { id: true, name: true, department: true, position: true, branch: true } },
        approvalSteps: {
          include: {
            approver: { select: { id: true, name: true, position: true, branch: true } },
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const directSteps = noLineRequests.map((req) => ({
      id: `direct-${req.id}`,
      order: 0,
      status: "PENDING",
      leaveRequest: req,
    }));

    return NextResponse.json({ steps: [...steps, ...directSteps] });
  }

  return NextResponse.json({ steps });
}
