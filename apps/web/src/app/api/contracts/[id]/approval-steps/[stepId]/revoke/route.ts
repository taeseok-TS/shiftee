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

    // 1. 회수 대상 단계를 PENDING으로 복원 — 재서명 재개 지점(WAITING으로 두면 결재함·게스트 링크가
    // 앞 단계 완료를 기다리며 영구 대기하는 데드락)
    const revokedStep = await tx.contractApprovalStep.update({
      where: { id: stepId },
      data: { status: "PENDING", decidedAt: null, signatureUrl: null },
    });

    // 직원 서명 단계가 회수 범위에 들어가는가 (order >= 회수 단계)
    const employeeStepRevoked = (contract.approvalLine?.steps || []).some(
      (st) =>
      // ⚠ 외부 계약은 **소유자(contract.userId)가 작성 관리자**다. 그래서 이 조건이
      //   외부 서명자 단계가 아니라 관리자 결재 단계를 가리켜, 게스트 서명이 문서에
      //   그대로 살아 있는데 계약만 "직원 미서명"이 됐다(2026-09-04 검증관 B F7).
      //   외부 계약의 직원 서명 단계는 approverId 가 없고 externalName 이 있다.
      (contract.externalName ? !st.approverId : st.approverId === contract.userId) &&
      st.order >= revokeStep.order
    );

    // 2. 해당 단계 이후의 모든 단계를 WAITING으로 초기화
    await tx.contractApprovalStep.updateMany({
      where: {
        approvalLineId: contract.approvalLine!.id,
        order: { gt: revokeStep.order },
      },
      // ⚠ signatureUrl 을 반드시 지운다. 빠뜨리면 **회수된 뒤 단계의 서명이 문서에 계속 찍힌다**
      //   (완료본.미리보기 모두 st.signatureUrl 만 보고 서명자를 모은다). 다음 결재자가
      //   이미 서명이 찍힌 문서를 보고 결재하게 된다 — 계약서에서 이건 진본성 문제다.
      //   직원 서명 회수(revoke-employee-signature)에는 있는데 여기만 빠져 있었다 (2026-09-04).
      data: { status: "WAITING", decidedAt: null, comment: null, signatureUrl: null },
    });

    // 3. 계약 상태를 APPROVED로 변경 (진행 중 상태를 유지) 및 회수 로그 저장
    const updatedContract = await tx.contract.update({
      where: { id },
      data: {
        status: "APPROVED",
        // 저장된 완료본도 지운다. 남겨 두면 미리보기 폴백이 **회수 전 완료본**을 되살린다
        // (bundle-preview 는 signedUrl 이 있으면 그것부터 쓴다). 되돌린 서명이 찍힌 문서다.
        signedUrl: null,
        signedAt: null,
        // ⚠ 회수 범위(order >= 회수 단계)에 **직원 서명 단계**가 들어가면 그 서명도 지워진다.
        //   그런데 employeeSignedAt 을 남기면 계약은 "직원이 서명함"으로 남아
        //   ① none 문서가 당사자에게 403 이 되고(다시 서명해야 하는 사람이 못 본다)
        //   ② 직원 화면이 완료본 링크를 띄웠다가 "아직 서명이 없습니다" 400 을 낸다.
        //   뒷 단계만 회수한 경우에는 직원 서명이 살아 있으므로 지우면 안 된다 — 범위를 본다.
        ...(employeeStepRevoked ? { employeeSignedAt: null } : {}),
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
