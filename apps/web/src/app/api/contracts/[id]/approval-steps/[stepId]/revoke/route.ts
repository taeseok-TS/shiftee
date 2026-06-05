import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const session = await getSession();
  // 회수는 ADMIN만 가능
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 결재를 회수할 수 있습니다." }, { status: 403 });
  }

  const { id, stepId } = await params;
  const body = await request.json();
  const { reason } = body;

  if (!reason || reason.trim() === "") {
    return NextResponse.json({ error: "회수 사유를 입력해주세요." }, { status: 400 });
  }

  // 계약서 존재 확인
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      approvalLine: {
        include: {
          steps: {
            orderBy: { order: "asc" },
          },
        },
      },
    },
  });

  if (!contract) {
    return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });
  }

  if (!contract.approvalLine) {
    return NextResponse.json({ error: "승인라인이 없습니다." }, { status: 400 });
  }

  // 회수 대상 단계 찾기
  const revokeStep = contract.approvalLine.steps.find((s) => s.id === stepId);

  if (!revokeStep) {
    return NextResponse.json({ error: "결재 단계를 찾을 수 없습니다." }, { status: 404 });
  }

  // APPROVED 또는 PENDING 상태만 회수 가능
  if (revokeStep.status !== "APPROVED" && revokeStep.status !== "PENDING") {
    return NextResponse.json(
      {
        error: `${revokeStep.status} 상태에서는 회수할 수 없습니다. APPROVED 또는 PENDING 상태만 회수 가능합니다.`,
      },
      { status: 400 }
    );
  }

  // 트랜잭션으로 모든 변경 처리
  const result = await prisma.$transaction(async (tx) => {
    // revocationLog JSON 배열로 관리
    const newLog = {
      type: "approval",
      stepOrder: revokeStep.order,
      reason,
      revokedBy: session.userId,
      revokedAt: new Date().toISOString(),
    };

    const existingLogs = (contract.revocationLog as any[]) || [];
    const updatedLogs = [...existingLogs, newLog];

    // 1. 회수 대상 단계 상태를 WAITING으로 변경
    const revokedStep = await tx.contractApprovalStep.update({
      where: { id: stepId },
      data: { status: "WAITING", decidedAt: null },
    });

    // 2. 해당 단계 이후의 모든 단계를 WAITING으로 초기화
    await tx.contractApprovalStep.updateMany({
      where: {
        approvalLineId: contract.approvalLine!.id,
        order: { gt: revokeStep.order },
      },
      data: { status: "WAITING", decidedAt: null, comment: null },
    });

    // 3. 계약 상태를 APPROVED로 변경 (진행 중 상태를 유지) 및 회수 로그 저장
    const updatedContract = await tx.contract.update({
      where: { id },
      data: {
        status: "APPROVED",
        revocationLog: updatedLogs,
      },
      include: {
        user: { select: { id: true, name: true, email: true, department: true } },
        approvalLine: {
          include: {
            steps: {
              include: { approver: { select: { id: true, name: true, branch: true } } },
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    return { revokedStep, contract: updatedContract };
  });

  return NextResponse.json({
    success: true,
    message: `${revokeStep.order}단계 이후의 모든 결재가 회수되었습니다. 다시 승인을 진행해주세요.`,
    step: result.revokedStep,
    contract: result.contract,
  });
}
