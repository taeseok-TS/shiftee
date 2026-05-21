import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { id } = await params;
  const { action, reason } = await request.json(); // action: 'approve' | 'reject'

  const leaveRequest = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!leaveRequest) return NextResponse.json({ error: "신청 내역을 찾을 수 없습니다." }, { status: 404 });

  const updated = await prisma.leaveRequest.update({
    where: { id },
    data: {
      status: action === "approve" ? "APPROVED" : "REJECTED",
      approverId: session.userId,
      rejectedReason: action === "reject" ? reason : null,
    },
  });

  // 승인 시 잔여 휴가 차감
  if (action === "approve") {
    await prisma.leaveBalance.upsert({
      where: { userId: leaveRequest.userId },
      create: {
        userId: leaveRequest.userId,
        year: new Date().getFullYear(),
        total: 15,
        used: leaveRequest.days,
        remaining: 15 - leaveRequest.days,
      },
      update: {
        used: { increment: leaveRequest.days },
        remaining: { decrement: leaveRequest.days },
      },
    });
  }

  return NextResponse.json({ success: true, leaveRequest: updated });
}
