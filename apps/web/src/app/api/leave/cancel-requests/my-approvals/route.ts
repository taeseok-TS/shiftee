import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { cancelStepWhere } from "@/lib/leave-cancel-flow";

// 내가 결재해야 하는 **휴가 취소 결재** 목록. 조건은 lib/leave-cancel-flow.ts cancelStepWhere 한 곳
// — 원장 대시보드 숫자도 같은 함수로 센다(결재함과 숫자가 어긋나지 않게).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const steps = await prisma.leaveCancelStep.findMany({
    where: cancelStepWhere(session, myBranches),
    include: {
      cancelRequest: {
        include: {
          user: { select: { id: true, name: true, department: true, position: true, branch: true } },
          leaveRequest: { select: { id: true, type: true, startDate: true, endDate: true, days: true, reason: true } },
          approvalSteps: {
            include: { approver: { select: { id: true, name: true, position: true, branch: true } } },
            orderBy: { order: "asc" },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ steps });
}
