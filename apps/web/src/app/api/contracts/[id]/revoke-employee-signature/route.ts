import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

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

      // 2. 모든 결재 단계를 WAITING으로 초기화
      if (contract.approvalLine) {
        await tx.contractApprovalStep.updateMany({
          where: { approvalLineId: contract.approvalLine.id },
          data: { status: "WAITING", decidedAt: null, comment: null },
        });
      }

      return updatedContract;
    });

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
