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
    include: { approvalLine: { include: { steps: { include: { approver: true } } } } },
  }) as any;

  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });

  // 직원 서명
  if (!isApprover) {
    if (contract.userId !== session.userId)
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

    if (contract.status !== "SENT")
      return NextResponse.json({ error: "서명 대기 중인 계약서가 아닙니다." }, { status: 400 });

    if (!signatureName)
      return NextResponse.json({ error: "서명자 이름이 필요합니다." }, { status: 400 });

    // 직원 서명 후 첫 승인자를 PENDING으로 변경
    const approvalLine = contract.approvalLine;
    if (approvalLine && approvalLine.steps.length > 0) {
      const firstStep = approvalLine.steps[0];
      await prisma.contractApprovalStep.update({
        where: { id: firstStep.id },
        data: { status: "PENDING" },
      });
    }

    const updated = await prisma.contract.update({
      where: { id },
      data: {
        employeeSignedAt: new Date(),
        status: approvalLine && approvalLine.steps.length > 0 ? "APPROVED" : "SIGNED",
        signedAt: !approvalLine || approvalLine.steps.length === 0 ? new Date() : undefined,
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

    // 승인자가 있으면 첫 승인자에게 알림, 없으면 완료 알림
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    if (approvalLine && approvalLine.steps.length > 0) {
      const firstApprover = approvalLine.steps[0];
      if (firstApprover.approver.email) {
        await sendApprovalRequest(
          firstApprover.approver.email,
          firstApprover.approver.name,
          updated.title,
          updated.user.name,
          firstApprover.order,
          appUrl
        );
      }
    } else {
      // 승인자가 없으면 계약 완료
      if (updated.user.email) {
        await sendContractCompletion(
          updated.user.email,
          updated.user.name,
          updated.title,
          updated.user.name,
          appUrl
        );
      }
    }

    return NextResponse.json({ success: true, contract: updated });
  }

  // 승인자 서명
  const approvalLine = contract.approvalLine;
  if (!approvalLine) return NextResponse.json({ error: "승인라인이 없습니다." }, { status: 400 });

  // 현재 사용자의 PENDING 단계 찾기
  const myStep = approvalLine.steps.find(
    (step) => step.approverId === session.userId && step.status === "PENDING"
  );

  if (!myStep) return NextResponse.json({ error: "승인할 항목이 없습니다." }, { status: 403 });

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
  if (nextStep && nextStep.approver && nextStep.approver.email) {
    // 다음 승인자에게 알림
    await sendApprovalRequest(
      nextStep.approver.email,
      nextStep.approver.name,
      finalContract.title,
      finalContract.user.name,
      nextStep.order,
      appUrl
    );
  } else if (!nextStep && finalContract.user.email) {
    // 계약 완료 - 모든 승인이 끝남
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