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
      // signToken·tokenExpiresAt은 결재자에게 노출 금지(게스트 서명 링크 위조 방지)
      steps: step.approvalLine.steps.map(({ signToken: _st, tokenExpiresAt: _te, ...s }) => ({
        ...s,
        // 남의 서명 PNG 주소는 주지 않는다 — 완료본에 찍히는 도장이라 위조 재료가 된다.
        // 목록.상세 API 는 이미 가리는데 여기만 빠져 있었다 (2026-09-04 검증 지적).
        signatureUrl: s.approverId === session.userId ? s.signatureUrl : null,
        // 외부(미가입) 서명 단계는 approver가 없음(null) — externalName으로 표시
        approver: s.approver ? {
          id: s.approver.id,
          name: s.approver.name,
          branch: s.approver.branch,
        } : null,
      })),
      myStep: (({ signToken: _st, tokenExpiresAt: _te, approvalLine: _al, ...rest }) => rest)(step),
    },
  }));

  return NextResponse.json({ contracts });
}