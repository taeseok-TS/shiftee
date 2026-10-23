import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { approverScopeFor } from "@/lib/approval-delegate";
import { cancelStepWhere } from "@/lib/leave-cancel-flow";
import { testRequesterExclusion } from "@/lib/employee-scope";

// 내가 결재해야 하는 **휴가 취소 결재** 목록. 조건은 lib/leave-cancel-flow.ts cancelStepWhere 한 곳
// — 원장 대시보드 숫자도 같은 함수로 센다(결재함과 숫자가 어긋나지 않게).
// 테스트 계정이 올린 요청은 기본으로 빼고, 관리자가 ?includeTest=1 을 주면 넣는다(2026-10-23 이예지 답)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // 원장 단계 결재 범위 — 담당 지점 + 원장대행 중인 지점(2026-10-07 본부 답변 #3)
  const scope = await approverScopeFor(session);
  const testEx = await testRequesterExclusion(session, request.nextUrl.searchParams.get("includeTest"));
  const steps = await prisma.leaveCancelStep.findMany({
    where: cancelStepWhere(session, scope, undefined, testEx),
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
