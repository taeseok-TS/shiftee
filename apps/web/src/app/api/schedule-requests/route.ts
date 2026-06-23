import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 근무일정 신청 조회 (자신의 신청)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const requests = await prisma.scheduleRequest.findMany({
    where: {
      userId: session.userId,
      ...(status && { status: status as any }),
    },
    include: {
      approvalSteps: {
        include: {
          approver: { select: { id: true, name: true, position: true } },
        },
        orderBy: { order: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ requests });
}

// 근무일정 신청 생성
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const body = await request.json();
  const { templateId, templateName, startDate, endDate, scheduleData, totalHours, approvalLineId } = body;

  if (!templateId || !startDate || !endDate || !scheduleData || totalHours === undefined) {
    return NextResponse.json({ error: "필수 정보가 부족합니다." }, { status: 400 });
  }

  // 사용자의 결재라인 조회 (근무일정 신청은 연차 2일+ 라인 사용)
  const approvalLine = await prisma.approvalLine.findUnique({
    where: { userId_purpose: { userId: session.userId, purpose: "LEAVE_2PLUS" } },
    include: {
      steps: {
        include: { approver: { select: { id: true, name: true } } },
        orderBy: { order: "asc" },
      },
    },
  });

  if (!approvalLine || approvalLine.steps.length === 0) {
    return NextResponse.json(
      { error: "결재라인이 설정되지 않았습니다. 관리자에게 문의하세요." },
      { status: 400 }
    );
  }

  try {
    // 트랜잭션으로 신청과 결재 단계 생성
    const newRequest = await prisma.$transaction(async (tx) => {
      // 근무일정 신청 생성
      const scheduleRequest = await tx.scheduleRequest.create({
        data: {
          userId: session.userId,
          templateId,
          templateName,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          scheduleData,
          totalHours,
          status: "PENDING",
        },
      });

      // 결재 단계 생성
      const steps = approvalLine.steps.map((step, index) => ({
        scheduleRequestId: scheduleRequest.id,
        order: step.order,
        approverId: step.approverId,
        status: index === 0 ? "PENDING" : "WAITING",
      }));

      await tx.scheduleApprovalStep.createMany({
        data: steps,
      });

      return scheduleRequest;
    });

    return NextResponse.json({
      success: true,
      request: newRequest,
      message: "근무일정 신청이 완료되었습니다.",
    });
  } catch (error: any) {
    console.error("근무일정 신청 생성 오류:", error);
    return NextResponse.json(
      { error: "근무일정 신청 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
