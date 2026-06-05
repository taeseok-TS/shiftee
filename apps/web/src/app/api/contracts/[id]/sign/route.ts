import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendApprovalRequest, sendContractCompletion } from "@/lib/email";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { signatureName, isApprover } = body;

  const contract = await prisma.contract.findUnique({
    where: { id },
    include: { approvalLine: { include: { steps: { orderBy: { order: "asc" }, include: { approver: true } } } } },
  });

  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });

  const approvalLine = contract.approvalLine;

  // 현재 사용자의 대기 중인 단계 찾기 (approval line 기반)
  const myStep = approvalLine?.steps.find(
    (step) => step.approverId === session.userId && step.status === "PENDING"
  );

  // 케이스 1: 직원이 서명할 번차 (승인라인의 순서 상 직원이 배정된 단계)
  if (myStep && myStep.approverId === contract.userId) {
    if (!signatureName) {
      return NextResponse.json({ error: "서명자 이름이 필요합니다." }, { status: 400 });
    }

    // 현재 단계(직원 서명)를 APPROVED로 변경
    await prisma.contractApprovalStep.update({
      where: { id: myStep.id },
      data: { status: "APPROVED", decidedAt: new Date() },
    });

    // 다음 단계가 있으면 PENDING으로 변경
    const nextStep = approvalLine.steps.find((step) => step.order === myStep.order + 1);
    if (nextStep) {
      await prisma.contractApprovalStep.update({
        where: { id: nextStep.id },
        data: { status: "PENDING" },
      });
    }

    const updated = await prisma.contract.update({
      where: { id },
      data: {
        employeeSignedAt: new Date(),
        status: !nextStep ? "SIGNED" : "APPROVED",
        signedAt: !nextStep ? new Date() : undefined,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        approvalLine: {
          include: {
            steps: {
              include: { approver: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
    });

    // 이메일 알림 발송
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    if (nextStep?.approver?.email) {
      // 다음 승인자에게 알림
      await sendApprovalRequest(
        nextStep.approver.email,
        nextStep.approver.name,
        updated.title,
        updated.user.name,
        nextStep.order,
        appUrl
      );
    } else if (!nextStep && updated.user.email) {
      // 계약 완료
      await sendContractCompletion(
        updated.user.email,
        updated.user.name,
        updated.title,
        updated.user.name,
        appUrl
      );
    }

    return NextResponse.json({ success: true, contract: updated });
  }

  // 케이스 2: 직원이 결재라인에 등록되지 않은 경우 (에러)
  if (!isApprover && contract.userId === session.userId && !myStep) {
    // 직원이 명시적으로 결재라인에 등록되지 않았으므로 에러
    return NextResponse.json(
      { error: "직원이 결재 단계에 등록되지 않았습니다. 발송 시 직원을 1,2,3단계 중 하나에 배치하세요." },
      { status: 400 }
    );
  }

  // 케이스 3: 승인자 승인 (myStep이 있고, approverId가 contract.userId가 아닌 경우)
  if (myStep) {
    // 현재 단계 승인으로 변경
    await prisma.contractApprovalStep.update({
      where: { id: myStep.id },
      data: { status: "APPROVED", decidedAt: new Date() },
    });

    // 다음 단계가 있으면 PENDING으로, 없으면 계약 완료
    const nextStep = approvalLine.steps.find((step) => step.order === myStep.order + 1);
    if (nextStep) {
      await prisma.contractApprovalStep.update({
        where: { id: nextStep.id },
        data: { status: "PENDING" },
      });
    }

    const finalContract = await prisma.contract.update({
      where: { id },
      data: {
        status: !nextStep ? "SIGNED" : "APPROVED",
        signedAt: !nextStep ? new Date() : undefined,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        approvalLine: {
          include: {
            steps: {
              include: { approver: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
    });

    // 이메일 알림 발송
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    if (nextStep?.approver?.email) {
      // 다음 단계가 직원 서명인지 확인
      if (nextStep.approverId === finalContract.userId) {
        // 직원에게 서명 요청 알림
        await sendApprovalRequest(
          finalContract.user.email,
          finalContract.user.name,
          finalContract.title,
          finalContract.user.name,
          nextStep.order,
          appUrl
        );
      } else {
        // 다음 승인자에게 알림
        await sendApprovalRequest(
          nextStep.approver.email,
          nextStep.approver.name,
          finalContract.title,
          finalContract.user.name,
          nextStep.order,
          appUrl
        );
      }
    } else if (!nextStep && finalContract.user.email) {
      // 계약 완료
      await sendContractCompletion(
        finalContract.user.email,
        finalContract.user.name,
        finalContract.title,
        finalContract.user.name,
        appUrl
      );
    }

    return NextResponse.json({ success: true, contract: finalContract });
  }

  // 어떤 경우도 해당하지 않음
  return NextResponse.json({ error: "처리할 수 있는 단계가 없습니다." }, { status: 403 });
}