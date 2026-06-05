import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { id, stepId } = await params;
  const body = await request.json();
  const { approverId } = body;

  if (!approverId) {
    return NextResponse.json({ error: "새로운 승인자 ID가 필요합니다." }, { status: 400 });
  }

  // 계약서 존재 확인 (권한 체크)
  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!contract) {
    return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });
  }

  // 결재 단계 조회
  const step = await prisma.contractApprovalStep.findUnique({
    where: { id: stepId },
    include: { approvalLine: { select: { contractId: true } } },
  });

  if (!step) {
    return NextResponse.json({ error: "결재 단계를 찾을 수 없습니다." }, { status: 404 });
  }

  // 계약서 일치 확인
  if (step.approvalLine.contractId !== id) {
    return NextResponse.json({ error: "해당 결재 단계는 이 계약서에 속하지 않습니다." }, { status: 400 });
  }

  // WAITING 상태만 수정 가능
  if (step.status !== "WAITING") {
    return NextResponse.json(
      { error: `${step.status} 상태에서는 결재자를 수정할 수 없습니다. WAITING 상태만 수정 가능합니다.` },
      { status: 400 }
    );
  }

  // 새로운 승인자 존재 확인
  const newApprover = await prisma.user.findUnique({
    where: { id: approverId },
    select: { id: true, name: true },
  });

  if (!newApprover) {
    return NextResponse.json({ error: "승인자를 찾을 수 없습니다." }, { status: 404 });
  }

  // 결재자 업데이트
  const updatedStep = await prisma.contractApprovalStep.update({
    where: { id: stepId },
    data: { approverId },
    include: {
      approver: { select: { id: true, name: true, branch: true } },
    },
  });

  // 업데이트된 계약서 정보 반환
  const updatedContract = await prisma.contract.findUnique({
    where: { id },
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

  return NextResponse.json({
    success: true,
    message: `${updatedStep.order}단계 결재자가 ${newApprover.name}으로 변경되었습니다.`,
    step: updatedStep,
    contract: updatedContract,
  });
}
