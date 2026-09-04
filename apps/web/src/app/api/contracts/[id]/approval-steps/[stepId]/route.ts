import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** 자기 자신을 결재자로 앉히려는가 — 원장이 스스로 전 단계를 처리하는 것을 막는다 */
function approverIdIsSelf(me: string, target: unknown): boolean {
  return typeof target === "string" && target === me;
}

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

  // ⚠ 종전에는 "EMPLOYEE 가 아니면" 통과가 전부였다. 그러면 **원장이 뒤 단계 결재자를
  //   자기로 바꾼 뒤 혼자 전 단계를 서명 완료**할 수 있다(2026-09-04 검증 지적).
  //   원장에게도 결재선 조정은 필요하므로 기능을 없애지 않고, **자기 자신으로 앉히는 것**과
  //   **담당 지점 밖 계약**만 막는다. 관리자는 종전대로.
  if (session.role !== "ADMIN") {
    if (approverIdIsSelf(session.userId, approverId)) {
      return NextResponse.json({ error: "본인을 결재자로 지정할 수 없습니다." }, { status: 403 });
    }
    const target = await prisma.contract.findUnique({
      where: { id }, select: { user: { select: { branch: true } } },
    });
    const branch = target?.user?.branch ?? null;
    const { getManagerBranches } = await import("@/lib/manager-branches");
    const mine = await getManagerBranches(session.userId);
    if (!branch || !mine.includes(branch)) {
      return NextResponse.json({ error: "담당 지점의 계약만 변경할 수 있습니다." }, { status: 403 });
    }
  }

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

  // 결재자 업데이트 — 외부 스텝이었다면 기존 서명 링크 토큰을 반드시 파기(구 링크로 대리 서명 방지)
  const updatedStep = await prisma.contractApprovalStep.update({
    where: { id: stepId },
    data: { approverId, signToken: null, tokenExpiresAt: null, externalName: null },
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
