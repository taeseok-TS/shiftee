import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { action, reason } = await request.json(); // action: 'approve' | 'reject'

  const leaveRequest = await prisma.leaveRequest.findUnique({
    where: { id },
    include: {
      approvalSteps: { orderBy: { order: "asc" } },
    },
  });
  if (!leaveRequest)
    return NextResponse.json({ error: "신청 내역을 찾을 수 없습니다." }, { status: 404 });

  const steps = leaveRequest.approvalSteps;

  // ── 결재라인이 있는 경우: 단계별 처리 ──────────────────────
  if (steps.length > 0) {
    // 내가 결재해야 할 PENDING 스텝 찾기
    const myStep = steps.find(
      (s) => s.approverId === session.userId && s.status === "PENDING"
    );

    // 관리자가 아니고 결재 차례도 아닌 경우
    if (!myStep && session.role === "EMPLOYEE") {
      return NextResponse.json({ error: "결재 권한이 없습니다." }, { status: 403 });
    }

    // 관리자가 직접 전체 처리하는 경우 (단계 우회)
    if (!myStep && session.role !== "EMPLOYEE") {
      return await adminOverride(id, leaveRequest.userId, leaveRequest.days, action, reason, session.userId);
    }

    // 단계별 처리
    await prisma.$transaction(async (tx) => {
      await tx.leaveApprovalStep.update({
        where: { id: myStep!.id },
        data: {
          status:    action === "approve" ? "APPROVED" : "REJECTED",
          comment:   reason ?? null,
          decidedAt: new Date(),
        },
      });

      if (action === "reject") {
        // 반려: 전체 요청 반려
        await tx.leaveRequest.update({
          where: { id },
          data: {
            status:         "REJECTED",
            approverId:     session.userId,
            rejectedReason: reason ?? null,
          },
        });
        // 나머지 WAITING 스텝 취소
        await tx.leaveApprovalStep.updateMany({
          where: { leaveRequestId: id, status: "WAITING" },
          data:  { status: "REJECTED" },
        });
      } else {
        // 승인: 다음 WAITING 스텝을 PENDING으로
        const nextStep = steps.find(
          (s) => s.order === myStep!.order + 1 && s.status === "WAITING"
        );
        if (nextStep) {
          await tx.leaveApprovalStep.update({
            where: { id: nextStep.id },
            data:  { status: "PENDING" },
          });
          // 아직 다음 결재자가 있으면 전체 상태는 PENDING 유지
        } else {
          // 모든 단계 승인 완료 → 전체 승인
          await tx.leaveRequest.update({
            where: { id },
            data:  { status: "APPROVED", approverId: session.userId },
          });
          // 잔여 휴가 차감
          await tx.leaveBalance.upsert({
            where:  { userId: leaveRequest.userId },
            create: {
              userId:    leaveRequest.userId,
              year:      new Date().getFullYear(),
              total:     15,
              used:      leaveRequest.days,
              remaining: 15 - leaveRequest.days,
            },
            update: {
              used:      { increment: leaveRequest.days },
              remaining: { decrement: leaveRequest.days },
            },
          });
        }
      }
    });

    return NextResponse.json({ success: true });
  }

  // ── 결재라인 없음: 기존 방식 (관리자만) ────────────────────
  if (session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  return await adminOverride(id, leaveRequest.userId, leaveRequest.days, action, reason, session.userId);
}

// 관리자 직접 승인/반려 (결재라인 우회)
async function adminOverride(
  id: string,
  userId: string,
  days: number,
  action: string,
  reason: string | undefined,
  approverId: string
) {
  await prisma.leaveRequest.update({
    where: { id },
    data: {
      status:         action === "approve" ? "APPROVED" : "REJECTED",
      approverId,
      rejectedReason: action === "reject" ? reason : null,
    },
  });

  if (action === "approve") {
    await prisma.leaveBalance.upsert({
      where:  { userId },
      create: {
        userId,
        year:      new Date().getFullYear(),
        total:     15,
        used:      days,
        remaining: 15 - days,
      },
      update: {
        used:      { increment: days },
        remaining: { decrement: days },
      },
    });
  }

  return NextResponse.json({ success: true });
}
