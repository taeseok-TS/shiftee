import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eachDayOfInterval, getDay } from "date-fns";
import { filterLeaveData } from "@/lib/api-response";
import { isLeaveDeductible } from "@/lib/leave-types";
import type { LeaveRequest, LeaveApprovalStep } from "@shiftee/api";

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

  // 본인 휴가만 조회: EMPLOYEE는 항상, 그 외 역할은 scope=self 요청 시
  const selfOnly = session.role === "EMPLOYEE" || searchParams.get("scope") === "self";

  const branchFilter =
    session.role === "MANAGER" ? { user: { branch: session.branch } } : {};

  const where =
    selfOnly
      ? { userId: session.userId, ...(status ? { status: status as never } : {}), ...dateFilter }
      : { ...branchFilter, ...(status ? { status: status as never } : {}), ...dateFilter };

  const requests = await prisma.leaveRequest.findMany({
    where,
    include: {
      user:     { select: { id: true, name: true, department: true, branch: true } },
      approver: { select: { name: true, branch: true } },
      approvalSteps: {
        include: { approver: { select: { id: true, name: true, position: true, branch: true } } },
        orderBy: { order: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // 데이터 필터링 적용 (권한에 따라 민감한 정보 제외)
  // 휴가 조회는 이미 권한 검증이 되어 있음 (EMPLOYEE는 자신, MANAGER는 자신의 지점만)
  const filteredRequests = requests.map(req => ({
    ...req,
    user: {
      id: req.user.id,
      name: req.user.name,
      department: req.user.department,
      branch: req.user.branch,
    },
  }));

  return NextResponse.json({ requests: filteredRequests });
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
  if (type === "HALF_AM" || type === "HALF_PM" || type === "COMPENSATORY_HALF" || type === "CIVIL_DEFENSE") {
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

  // 잔여 휴가 확인 (연차 차감 유형만 — 대체휴무/특별휴가/민방위/예비군은 미차감이므로 검사 생략)
  if (isLeaveDeductible(type)) {
    const balance = await prisma.leaveBalance.findUnique({ where: { userId: session.userId } });
    if (balance && balance.remaining < days) {
      return NextResponse.json({
        error: `잔여 휴가가 부족합니다. (잔여 ${balance.remaining}일, 신청 ${days}일)`,
      }, { status: 400 });
    }
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

  // ── 역할/지점 기반 자동 결재 정책 ──
  //  2일 이상: 직원 → [소속 지점 원장 → 관리자],  원장 → [관리자]
  //  1일 이하: 직원 → [소속 지점 원장],          원장 → [관리자]
  //  관리자 본인: 다른 관리자 1명 결재(없으면 자동 승인)
  const submitter = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { role: true, branch: true },
  });
  const adminStep = { approverRole: "ADMIN", branch: null as string | null };
  const managerStep = { approverRole: "MANAGER", branch: submitter?.branch ?? null };
  const hasBranchManager = submitter?.branch
    ? (await prisma.user.count({ where: { role: "MANAGER", branch: submitter.branch, isActive: true } })) > 0
    : false;

  let policySteps: { approverRole: string; branch: string | null }[] = [];
  if (submitter?.role === "MANAGER") {
    policySteps = [adminStep];
  } else if (submitter?.role === "ADMIN") {
    const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { not: session.userId } } });
    policySteps = otherAdmins > 0 ? [adminStep] : [];
  } else {
    if (days >= 2) policySteps = hasBranchManager ? [managerStep, adminStep] : [adminStep];
    else policySteps = hasBranchManager ? [managerStep] : [adminStep];
  }

  if (policySteps.length > 0) {
    await prisma.leaveApprovalStep.createMany({
      data: policySteps.map((s, i) => ({
        leaveRequestId: leaveRequest.id,
        order: i + 1,
        approverRole: s.approverRole,
        branch: s.branch,
        status: i === 0 ? "PENDING" : "WAITING",
      })),
    });
  } else {
    // 결재 단계 없음(관리자 본인 + 다른 관리자 없음) → 자동 승인
    await prisma.leaveRequest.update({ where: { id: leaveRequest.id }, data: { status: "APPROVED", approverId: session.userId } });
    if (isLeaveDeductible(type)) {
      await prisma.leaveBalance.upsert({
        where: { userId: session.userId },
        create: { userId: session.userId, year: new Date().getFullYear(), total: 15, used: days, remaining: 15 - days },
        update: { used: { increment: days }, remaining: { decrement: days } },
      });
    }
  }

  return NextResponse.json({ success: true, leaveRequest, days });
}
