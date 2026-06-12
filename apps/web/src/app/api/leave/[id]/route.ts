import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isLeaveDeductible } from "@/lib/leave-types";

// 휴가 신청 취소 (직원 본인 · PENDING만)
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const leave = await prisma.leaveRequest.findUnique({ where: { id } });

  if (!leave) return NextResponse.json({ error: "신청 내역이 없습니다." }, { status: 404 });

  // 본인 확인 (관리자는 어떤 건이든 취소 가능)
  if (session.role === "EMPLOYEE" && leave.userId !== session.userId) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  // 이미 처리된 건은 취소 불가 (승인된 건은 관리자만 취소 가능)
  if (leave.status === "CANCELLED") {
    return NextResponse.json({ error: "이미 취소된 신청입니다." }, { status: 400 });
  }
  if (session.role === "EMPLOYEE" && leave.status !== "PENDING") {
    return NextResponse.json({ error: "대기 중인 신청만 취소할 수 있습니다." }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    // 승인된 건을 관리자가 취소하면 잔여 복원 (연차 차감 유형만)
    if (leave.status === "APPROVED" && isLeaveDeductible(leave.type)) {
      await tx.leaveBalance.updateMany({
        where: { userId: leave.userId },
        data: {
          used:      { decrement: leave.days },
          remaining: { increment: leave.days },
        },
      });
    }
  });

  return NextResponse.json({ success: true });
}
