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
  const { approverIds, purpose: rawPurpose } = await req.json();
  const purpose = ["CONTRACT", "LEAVE_2PLUS", "LEAVE_SHORT"].includes(rawPurpose) ? rawPurpose : "LEAVE_2PLUS";

  if (!Array.isArray(approverIds))
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  // MANAGER의 지점 검증: 자신의 지점 직원만 설정 가능
  if (session.role === "MANAGER") {
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { branch: true }
    });
    if (!targetUser || targetUser.branch !== session.branch) {
      return NextResponse.json({ error: "자신의 지점 직원만 결재라인을 설정할 수 있습니다." }, { status: 403 });
    }
  }

  await prisma.$transaction(async (tx: any) => {
    if (approverIds.length === 0) {
      // 해당 용도 결재라인 삭제
      await tx.approvalLine.deleteMany({ where: { userId, purpose } });
      return;
    }

    // upsert ApprovalLine (용도별)
    const line = await tx.approvalLine.upsert({
      where: { userId_purpose: { userId, purpose } },
      create: { userId, purpose },
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
