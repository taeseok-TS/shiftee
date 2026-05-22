import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eachDayOfInterval, getDay } from "date-fns";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  const year   = searchParams.get("year")   ? parseInt(searchParams.get("year")!) : undefined;
  const month  = searchParams.get("month")  ? parseInt(searchParams.get("month")!) : undefined; // 1~12

  let dateFilter = {};
  if (year && month) {
    // 해당 연월의 1일 ~ 말일
    const start = new Date(year, month - 1, 1);
    const end   = new Date(year, month, 0, 23, 59, 59); // month의 0일 = 전달 말일
    dateFilter = { startDate: { gte: start, lte: end } };
  } else if (year) {
    dateFilter = { startDate: { gte: new Date(year, 0, 1) }, endDate: { lte: new Date(year, 11, 31, 23, 59, 59) } };
  }

  const branchFilter =
    session.role === "MANAGER" ? { user: { branch: session.branch } } : {};

  const where =
    session.role === "EMPLOYEE"
      ? { userId: session.userId, ...(status ? { status: status as never } : {}), ...dateFilter }
      : { ...branchFilter, ...(status ? { status: status as never } : {}), ...dateFilter };

  const requests = await prisma.leaveRequest.findMany({
    where,
    include: {
      user:     { select: { name: true, department: true } },
      approver: { select: { name: true } },
      approvalSteps: {
        include: { approver: { select: { id: true, name: true, position: true } } },
        orderBy: { order: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ requests });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const body = await request.json();
  const { type, startDate, endDate, reason } = body;

  if (!type || !startDate || !endDate) {
    return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
  }

  const start = new Date(startDate);
  const end   = new Date(endDate);

  if (start > end) {
    return NextResponse.json({ error: "종료일이 시작일보다 빠릅니다." }, { status: 400 });
  }

  // 근무일(평일)만 계산
  let days: number;
  if (type === "HALF_AM" || type === "HALF_PM") {
    days = 0.5;
  } else if (type === "QUARTER_AM" || type === "QUARTER_PM") {
    days = 0.25;
  } else {
    const allDays = eachDayOfInterval({ start, end });
    days = allDays.filter(d => getDay(d) !== 0 && getDay(d) !== 6).length;
    if (days === 0) {
      return NextResponse.json({ error: "선택한 기간에 근무일이 없습니다." }, { status: 400 });
    }
  }

  // 잔여 휴가 확인
  const balance = await prisma.leaveBalance.findUnique({ where: { userId: session.userId } });
  if (balance && balance.remaining < days) {
    return NextResponse.json({
      error: `잔여 휴가가 부족합니다. (잔여 ${balance.remaining}일, 신청 ${days}일)`,
    }, { status: 400 });
  }

  const leaveRequest = await prisma.leaveRequest.create({
    data: {
      userId: session.userId,
      type,
      startDate: start,
      endDate:   end,
      days,
      reason,
      status: "PENDING",
    },
  });

  // 결재라인이 설정된 경우 결재 스텝 생성
  const approvalLine = await prisma.approvalLine.findUnique({
    where: { userId: session.userId },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (approvalLine && approvalLine.steps.length > 0) {
    await prisma.leaveApprovalStep.createMany({
      data: approvalLine.steps.map((step, i) => ({
        leaveRequestId: leaveRequest.id,
        order:          step.order,
        approverId:     step.approverId,
        status:         i === 0 ? "PENDING" : "WAITING",
      })),
    });
  }

  return NextResponse.json({ success: true, leaveRequest, days });
}
