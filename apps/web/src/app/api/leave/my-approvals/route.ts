import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";

// 내가 결재해야 하는 휴가 신청 목록
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const steps = await prisma.leaveApprovalStep.findMany({
    where: {
      status: "PENDING",
      // 본인 신청은 본인 결재함에 뜨지 않는다. 원장 신청에 원장 단계가 생기면서
      // 자기 것이 자기 결재함에 뜨는데, 누르면 403 이다 — 누를 수 없는 버튼을
      // 보여주지 않는다(2026-09-09 검증에서 적발).
      leaveRequest: { userId: { not: session.userId } },
      // 관리자는 **대기 중인 모든 단계**를 본다. 결재 요청 DM 이 전체 관리자에게
      // 가는데(디렉터 지시) 결재함에는 ADMIN 단계만 보이면, 받아놓고 열었을 때
      // 빈 화면이 된다. 관리자는 어차피 어떤 건이든 대신 처리할 수 있고,
      // 원장 단계에서 멈춘 건(그 지점 원장이 퇴사.비활성이면 영구 정지)도 이걸로 보인다.
      // 근무일정 결재함과 **같은 규칙**이다(2026-09-09 검증에서 한쪽만 들어간 것 적발).
      ...(session.role === "ADMIN"
        ? {}
        : {
            OR: [
              { approverId: session.userId }, // 레거시 고정 결재자
              ...(session.role === "MANAGER"
                ? [{ approverRole: "MANAGER", branch: { in: myBranches } }]
                : []),
            ],
          }),
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
