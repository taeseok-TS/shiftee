import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { lockSteps } from "@/lib/contract-reset";
import { recordContractEvent } from "@/lib/contract-events";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    // 직원 서명 회수는 ADMIN만 가능
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ error: "관리자만 직원 서명을 회수할 수 있습니다." }, { status: 403 });
    }

    const { id } = await params;

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ error: "요청 본문이 유효하지 않습니다." }, { status: 400 });
    }

    const { reason } = body;

    if (!reason || reason.trim() === "") {
      return NextResponse.json({ error: "회수 사유를 입력해주세요." }, { status: 400 });
    }

    // 계약서 조회
    const contract = await prisma.contract.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
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

    if (!contract) {
      return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });
    }

    // 직원 서명 여부 확인
    if (!contract.employeeSignedAt) {
      return NextResponse.json({ error: "서명된 계약서가 아닙니다." }, { status: 400 });
    }

    // 트랜잭션으로 처리
    const result = await prisma.$transaction(async (tx) => {
      // 단계 행을 먼저 잠근다 — 다른 쓰기 경로(수정·서명 확정·반려·초기화)와 같은 순서(단계 → 계약)로 교착을 막는다(#205 검증 A3)
      await lockSteps(tx, id);
      // revocationLog JSON 배열로 관리
      const newLog = {
        type: "employee",
        reason,
        revokedBy: session.userId,
        revokedAt: new Date().toISOString(),
      };

      const existingLogs = (contract.revocationLog as any[]) || [];
      const updatedLogs = [...existingLogs, newLog];

      // 1. 직원 서명 회수
      const updatedContract = await tx.contract.update({
        where: { id },
        data: {
          employeeSignedAt: null,
          status: "SENT", // 상태를 다시 SENT로 변경
          // 저장된 완료본도 지운다 — 남으면 미리보기 폴백이 회수 전 문서를 되살린다
          signedUrl: null,
          signedAt: null,
          docNo: null, signedPdfUrl: null, signedSha256: null, signedPdfAt: null, tsaToken: null, tsaAt: null, tsaUrl: null, // 고정 완료본도(#205-5) — 다시 완료되면 새 문서번호로
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

      // 2. 모든 결재 단계를 WAITING으로 초기화 후 1단계를 PENDING으로 복원
      // (전부 WAITING이면 결재함·게스트 서명 링크가 앞 단계 완료를 영원히 기다리는 데드락)
      if (contract.approvalLine) {
        await tx.contractApprovalStep.updateMany({
          where: { approvalLineId: contract.approvalLine.id },
          data: { status: "WAITING", decidedAt: null, comment: null, signatureUrl: null },
        });
        const firstStep = await tx.contractApprovalStep.findFirst({
          where: { approvalLineId: contract.approvalLine.id },
          orderBy: { order: "asc" },
          select: { id: true },
        });
        if (firstStep) {
          await tx.contractApprovalStep.update({
            where: { id: firstStep.id },
            data: { status: "PENDING" },
          });
        }
      }

      return updatedContract;
    });

    // 감사 기록(#205-4)
    await recordContractEvent({ contractId: id, type: "REVOKED", actorId: session.userId, actorName: session.name, request, meta: { kind: "직원 서명 회수", reason } });

    return NextResponse.json({
      success: true,
      message: "직원 서명이 회수되었습니다. 다시 서명을 진행해주세요.",
      contract: result,
    });
  } catch (error) {
    console.error("직원 서명 회수 중 오류:", error);
    return NextResponse.json(
      { error: "직원 서명 회수 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
