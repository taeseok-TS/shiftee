import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

type ScheduleEntry = { date: string; startTime?: string; endTime?: string };

// 최종 승인된 신청의 scheduleData를 실제 근무일정(Schedule)으로 생성
async function materializeSchedules(
  tx: Pick<typeof prisma, "schedule">,
  req: { id: string; userId: string; scheduleData: unknown; templateName: string | null }
) {
  const entries = (Array.isArray(req.scheduleData) ? req.scheduleData : []) as ScheduleEntry[];
  for (const entry of entries) {
    if (!entry?.date) continue;
    const date = new Date(entry.date);
    if (isNaN(date.getTime())) continue;
    // 같은 날짜의 기존 일정은 승인된 일정으로 대체
    await tx.schedule.deleteMany({ where: { userId: req.userId, date } });
    await tx.schedule.create({
      data: {
        userId: req.userId,
        date,
        startTime: entry.startTime || "09:00",
        endTime: entry.endTime || "18:00",
        type: "WORK",
        note: req.templateName ? `근무일정 승인 (${req.templateName})` : "근무일정 승인",
      },
    });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { action, reason } = await request.json(); // action: 'approve' | 'reject'

  const scheduleRequest = await prisma.scheduleRequest.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, branch: true } },
      approvalSteps: {
        orderBy: { order: "asc" },
        include: { approver: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  if (!scheduleRequest) {
    return NextResponse.json({ error: "신청 내역을 찾을 수 없습니다." }, { status: 404 });
  }

  const steps = scheduleRequest.approvalSteps;

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
      // MANAGER는 자기 지점 신청만 우회 처리 가능 (지정 결재자인 경우는 지점 무관)
      if (session.role === "MANAGER" && scheduleRequest.user.branch !== session.branch) {
        return NextResponse.json({ error: "다른 지점 직원의 신청은 승인할 수 없습니다." }, { status: 403 });
      }
      return await adminOverride(id, action, reason, session.userId);
    }

    // 단계별 처리
    let emailAction: "approve" | "reject" | "next_approver" | null = null;
    let nextApprover: any = null;

    await prisma.$transaction(async (tx) => {
      await tx.scheduleApprovalStep.update({
        where: { id: myStep!.id },
        data: {
          status: action === "approve" ? "APPROVED" : "REJECTED",
          comment: reason ?? null,
          decidedAt: new Date(),
        },
      });

      if (action === "reject") {
        // 반려: 전체 요청 반려
        await tx.scheduleRequest.update({
          where: { id },
          data: {
            status: "REJECTED",
          },
        });
        // 나머지 WAITING 스텝 취소
        await tx.scheduleApprovalStep.updateMany({
          where: { scheduleRequestId: id, status: "WAITING" },
          data: { status: "REJECTED" },
        });
        emailAction = "reject";
      } else {
        // 승인: 다음 WAITING 스텝을 PENDING으로
        const nextStep = steps.find(
          (s) => s.order === myStep!.order + 1 && s.status === "WAITING"
        );
        if (nextStep) {
          await tx.scheduleApprovalStep.update({
            where: { id: nextStep.id },
            data: { status: "PENDING" },
          });
          emailAction = "next_approver";
          nextApprover = nextStep.approver;
          // 아직 다음 결재자가 있으면 전체 상태는 PENDING 유지
        } else {
          // 모든 단계 승인 완료 → 전체 승인
          await tx.scheduleRequest.update({
            where: { id },
            data: { status: "APPROVED" },
          });
          // 승인된 일정을 근무일정 캘린더에 반영
          await materializeSchedules(tx, scheduleRequest);
          emailAction = "approve";
        }
      }
    });

    // 이메일 발송 (실제로는 여기서 이메일을 보내면 됨)
    // 현재는 로그만 기록
    console.log("이메일 발송:", { emailAction, nextApprover });

    return NextResponse.json({ success: true });
  }

  // 결재라선 없음: 기존 방식 (관리자만)
  if (session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  return await adminOverride(id, action, reason, session.userId);
}

// 관리자 직접 승인/반려
async function adminOverride(
  id: string,
  action: string,
  reason: string | undefined,
  approverId: string
) {
  const scheduleRequest = await prisma.scheduleRequest.findUnique({
    where: { id },
  });

  if (!scheduleRequest) {
    return NextResponse.json({ error: "신청 내역을 찾을 수 없습니다." }, { status: 404 });
  }

  await prisma.scheduleRequest.update({
    where: { id },
    data: {
      status: action === "approve" ? "APPROVED" : "REJECTED",
    },
  });

  // 승인된 일정을 근무일정 캘린더에 반영
  if (action === "approve") {
    await materializeSchedules(prisma, scheduleRequest);
  }

  return NextResponse.json({ success: true });
}
