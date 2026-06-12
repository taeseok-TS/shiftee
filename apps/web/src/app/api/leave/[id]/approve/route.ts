import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  sendLeaveApprovalRequest,
  sendLeaveApprovalCompletion,
  sendLeaveRejectionNotification,
} from "@/lib/email";
import { isLeaveDeductible } from "@/lib/leave-types";

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
      user: { select: { id: true, name: true, email: true, branch: true } },
      approvalSteps: {
        orderBy: { order: "asc" },
        include: { approver: { select: { id: true, name: true, email: true } } },
      },
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

    // 결재라인을 우회하는 경우 (지정된 결재 차례가 아님)
    if (!myStep && session.role !== "EMPLOYEE") {
      // MANAGER는 자기 지점 휴가만 우회 처리 가능 (지정 결재자인 경우는 지점 무관)
      if (session.role === "MANAGER" && leaveRequest.user.branch !== session.branch) {
        return NextResponse.json({ error: "다른 지점 직원의 휴가는 승인할 수 없습니다." }, { status: 403 });
      }
      return await adminOverride(id, leaveRequest.userId, leaveRequest.days, action, reason, session.userId, session.role, session.branch);
    }

    // 단계별 처리
    let emailAction: "approve" | "reject" | "next_approver" | null = null;
    let nextApprover: any = null;

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
        emailAction = "reject";
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
          emailAction = "next_approver";
          nextApprover = nextStep.approver;
          // 아직 다음 결재자가 있으면 전체 상태는 PENDING 유지
        } else {
          // 모든 단계 승인 완료 → 전체 승인
          await tx.leaveRequest.update({
            where: { id },
            data:  { status: "APPROVED", approverId: session.userId },
          });
          // 잔여 휴가 차감 (연차 차감 유형만 — 대체휴무/특별휴가/민방위/예비군은 미차감)
          if (isLeaveDeductible(leaveRequest.type)) {
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
          emailAction = "approve";
        }
      }
    });

    // 이메일 발송 (트랜잭션 후)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const requesterName = leaveRequest.user.name;
    const requesterEmail = leaveRequest.user.email;
    const approverName = (await prisma.user.findUnique({ where: { id: session.userId } }))?.name || "관리자";
    const leaveTypeLabel: Record<string, string> = {
      ANNUAL: "연차",
      SICK: "병가",
      PERSONAL: "개인휴가",
      MATERNITY: "출산휴가",
      BEREAVEMENT: "상주휴가",
    };
    const leaveTypeStr = leaveTypeLabel[leaveRequest.type] || leaveRequest.type;
    const startDateStr = leaveRequest.startDate ? leaveRequest.startDate.toISOString().split('T')[0] : '';
    const endDateStr = leaveRequest.endDate ? leaveRequest.endDate.toISOString().split('T')[0] : '';

    if (emailAction === "reject") {
      await sendLeaveRejectionNotification(
        requesterEmail,
        requesterName,
        leaveTypeStr,
        startDateStr,
        endDateStr,
        approverName,
        reason || null,
        appUrl
      );
    } else if (emailAction === "approve") {
      await sendLeaveApprovalCompletion(
        requesterEmail,
        requesterName,
        leaveTypeStr,
        startDateStr,
        endDateStr,
        approverName,
        appUrl
      );
    } else if (emailAction === "next_approver" && nextApprover) {
      await sendLeaveApprovalRequest(
        nextApprover.email,
        nextApprover.name,
        requesterName,
        leaveTypeStr,
        startDateStr,
        endDateStr,
        leaveRequest.reason || "",
        appUrl
      );
    }

    return NextResponse.json({ success: true });
  }

  // ── 결재라선 없음: 기존 방식 (관리자만) ────────────────────
  if (session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  return await adminOverride(id, leaveRequest.userId, leaveRequest.days, action, reason, session.userId, session.role, session.branch);
}

// 관리자 직접 승인/반려 (결재라인 우회)
async function adminOverride(
  id: string,
  userId: string,
  days: number,
  action: string,
  reason: string | undefined,
  approverId: string,
  role?: string,
  branch?: string
) {
  const leaveRequest = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, email: true, branch: true } } },
  });

  if (!leaveRequest) {
    return NextResponse.json({ error: "신청 내역을 찾을 수 없습니다." }, { status: 404 });
  }

  // MANAGER의 지점 검증
  if (role === "MANAGER" && leaveRequest.user.branch !== branch) {
    return NextResponse.json({ error: "다른 지점 직원의 휴가는 승인할 수 없습니다." }, { status: 403 });
  }

  await prisma.leaveRequest.update({
    where: { id },
    data: {
      status:         action === "approve" ? "APPROVED" : "REJECTED",
      approverId,
      rejectedReason: action === "reject" ? reason : null,
    },
  });

  // 잔여 휴가 차감 (연차 차감 유형만)
  if (action === "approve" && isLeaveDeductible(leaveRequest.type)) {
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

  // 이메일 발송
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const approver = await prisma.user.findUnique({ where: { id: approverId } });
  const approverName = approver?.name || "관리자";
  const requesterName = leaveRequest.user.name;
  const requesterEmail = leaveRequest.user.email;
  const leaveTypeLabel: Record<string, string> = {
    ANNUAL: "연차",
    SICK: "병가",
    PERSONAL: "개인휴가",
    MATERNITY: "출산휴가",
    BEREAVEMENT: "상주휴가",
  };
  const leaveTypeStr = leaveTypeLabel[leaveRequest.type] || leaveRequest.type;
  const startDateStr = leaveRequest.startDate ? leaveRequest.startDate.toISOString().split('T')[0] : '';
  const endDateStr = leaveRequest.endDate ? leaveRequest.endDate.toISOString().split('T')[0] : '';

  if (action === "approve") {
    await sendLeaveApprovalCompletion(
      requesterEmail,
      requesterName,
      leaveTypeStr,
      startDateStr,
      endDateStr,
      approverName,
      appUrl
    );
  } else {
    await sendLeaveRejectionNotification(
      requesterEmail,
      requesterName,
      leaveTypeStr,
      startDateStr,
      endDateStr,
      approverName,
      reason || null,
      appUrl
    );
  }

  return NextResponse.json({ success: true });
}
