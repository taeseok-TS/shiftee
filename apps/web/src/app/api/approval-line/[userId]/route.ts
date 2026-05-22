import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 특정 직원의 결재라인 설정 (관리자)
// body: { approverIds: string[] }  ← 순서대로
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { userId } = await params;
  const { approverIds } = await req.json();

  if (!Array.isArray(approverIds))
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  await prisma.$transaction(async (tx: any) => {
    if (approverIds.length === 0) {
      // 결재라인 삭제
      await tx.approvalLine.deleteMany({ where: { userId } });
      return;
    }

    // upsert ApprovalLine
    const line = await tx.approvalLine.upsert({
      where: { userId },
      create: { userId },
      update: { updatedAt: new Date() },
    });

    // 기존 스텝 전부 삭제 후 재생성
    await tx.approvalLineStep.deleteMany({ where: { approvalLineId: line.id } });
    await tx.approvalLineStep.createMany({
      data: approverIds.map((approverId, i) => ({
        approvalLineId: line.id,
        order: i + 1,
        approverId,
      })),
    });
  });

  return NextResponse.json({ success: true });
}
