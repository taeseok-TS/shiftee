import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { materializeSchedules } from "@/lib/schedule-materialize";
import { branchHasManager } from "@/lib/manager-branches";
import { getHolidaySet } from "@/lib/holidays";

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

  // ── 역할/지점 기반 자동 결재 정책 (근무일정) ──
  //  주말 근무 포함: 연차 2일+ 와 동일 → 직원: 지점원장→관리자, 원장: 관리자
  //  평일 근무만:    직원: 지점원장(1단계),                원장: 관리자
  //  관리자 본인: 다른 관리자 1명 결재(없으면 자동 승인)
  const submitter = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { role: true, branch: true },
  });

  // scheduleData(날짜 배열)에 휴일 근무가 포함되는지 판별 (서버 시간대 무관하게 달력 날짜로 계산)
  // 공휴일(추석·설 등) 근무도 주말과 같이 사전 승인 대상이므로 함께 본다
  // 조회 범위는 startDate~endDate 가 아니라 실제 제출된 날짜의 최소~최대로 잡는다.
  // (신청 화면에서 기간을 좁혀도 이미 선택된 날짜는 payload 에 남을 수 있어, 범위 밖 공휴일을 놓친다)
  const submittedDates = (Array.isArray(scheduleData) ? scheduleData : [])
    .map((e: any) => (typeof e?.date === "string" ? e.date : ""))
    .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const holidaySet = submittedDates.length
    ? await getHolidaySet(new Date(submittedDates[0]), new Date(submittedDates[submittedDates.length - 1]))
    : new Set<string>();
  const hasWeekend = Array.isArray(scheduleData) && scheduleData.some((e: any) => {
    if (!e?.date || typeof e.date !== "string") return false;
    if (holidaySet.has(e.date)) return true;
    const [y, m, d] = e.date.split("-").map(Number);
    if (!y || !m || !d) return false;
    const dow = new Date(y, m - 1, d).getDay();
    return dow === 0 || dow === 6;
  });

  const adminStep = { approverRole: "ADMIN", branch: null as string | null };
  const managerStep = { approverRole: "MANAGER", branch: submitter?.branch ?? null };
  const hasBranchManager = submitter?.branch
    ? await branchHasManager(submitter.branch) // 대표/겸직 모두 인정
    : false;

  let policySteps: { approverRole: string; branch: string | null }[] = [];
  if (submitter?.role === "MANAGER") {
    policySteps = [adminStep];
  } else if (submitter?.role === "ADMIN") {
    const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { not: session.userId } } });
    policySteps = otherAdmins > 0 ? [adminStep] : [];
  } else {
    if (hasWeekend) policySteps = hasBranchManager ? [managerStep, adminStep] : [adminStep];
    else policySteps = hasBranchManager ? [managerStep] : [adminStep];
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
          status: policySteps.length > 0 ? "PENDING" : "APPROVED",
        },
      });

      if (policySteps.length > 0) {
        await tx.scheduleApprovalStep.createMany({
          data: policySteps.map((s, i) => ({
            scheduleRequestId: scheduleRequest.id,
            order: i + 1,
            approverRole: s.approverRole,
            branch: s.branch,
            status: i === 0 ? "PENDING" : "WAITING",
          })),
        });
      } else {
        // 결재 단계 없음(관리자 본인 + 다른 관리자 없음) → 자동 승인 + 근무일정 반영
        await materializeSchedules(tx, scheduleRequest);
      }

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
