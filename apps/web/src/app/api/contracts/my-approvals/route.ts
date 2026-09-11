import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { templateFieldNames, summaryForTemplate } from "@/lib/contract-fields";

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
            include: {
              user: { select: { id: true, name: true, email: true, department: true, branch: true } },
              template: { select: { fileUrl: true } }, // 요약 칸을 그 템플릿 필드로 거르는 데만 쓴다(#206-2)
            },
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

  // 서명 창 요약 칸 — 그 문서 템플릿의 필드만(#206-2)
  const namesByTemplate = new Map<string, string[] | null>();
  for (const s of pendingSteps) {
    const u = s.approvalLine.contract.template?.fileUrl;
    if (u && !namesByTemplate.has(u)) namesByTemplate.set(u, await templateFieldNames(u));
  }

  // 데이터 필터링 적용: 직원 정보에서 이메일 제거
  const contracts = pendingSteps.map((step) => ({
    ...step.approvalLine.contract,
    template: undefined, // 요약 계산용으로만 읽었다 — 응답에 싣지 않는다
    summaryFields: summaryForTemplate(
      step.approvalLine.contract.extraFields,
      step.approvalLine.contract.template?.fileUrl ? namesByTemplate.get(step.approvalLine.contract.template.fileUrl) : null
    ),
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