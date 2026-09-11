import { NextRequest, NextResponse } from "next/server";
import { leaveCancelDenial, cancelFlags } from "@/lib/leave-cancel";
import { cancelViewerFor } from "@/lib/cancel-viewer";
import { kstTodayMidnight } from "@/lib/resign";
import { botNotifyApprovalRequest } from "@/lib/bot";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eachDayOfInterval, getDay } from "date-fns";
import { filterLeaveData } from "@/lib/api-response";
import { isLeaveDeductible } from "@/lib/leave-types";
import { currentLeaveYear } from "@/lib/leave-calc";
import { getHolidaySet, ymdUTC } from "@/lib/holidays";
import { getManagerBranches, branchHasManager, branchHasOtherManager, branchMainManager } from "@/lib/manager-branches";
import type { LeaveRequest, LeaveApprovalStep } from "@shiftee/api";
import { LEAVE_STATUSES, pick, LEAVE_TYPES, type LeaveTypeValue } from "@/lib/enums";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  // ⚠ 쿼리스트링 값을 그대로 넘기면 Prisma 가 enum 검증에서 던져 **500** 이 난다
  //   (2026-09-06 실측: `?status=BOGUS` → 500). 주소창에 오타 한 번이면 서버 오류다.
  //   아는 값만 받고, 모르는 값은 필터를 안 건 것으로 본다(빈 목록보다 전체가 안전하다).
  const status = pick(LEAVE_STATUSES, searchParams.get("status"));
  // parseInt 는 "9abc" 를 9 로 읽는다 — 조용히 엉뚱한 해.달의 목록을 준다.
  // 근무일정 조회와 **같은 기준**으로 숫자만 받는다(2026-09-09 검증에서 적발).
  const numParam = (k: string): number | undefined | null => {
    const v = searchParams.get(k);
    if (v === null) return undefined;
    return /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;   // null = 형식 오류
  };
  const year  = numParam("year");
  const month = numParam("month");
  if (year === null || month === null ||
      (year !== undefined && (year < 2000 || year > 2100)) ||
      (month !== undefined && (month < 1 || month > 12))) {
    return NextResponse.json({ error: "연월이 올바르지 않습니다." }, { status: 400 });
  }

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

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const branchFilter =
    session.role === "MANAGER" ? { user: { branch: { in: myBranches } } } : {};

  // current=1 — **진행 중·앞으로의** 대기·승인 휴가만(종료일 ≥ KST 오늘). 원장·관리자 "휴가 내역"
  // 화면의 평상시 보기다(9/11 디렉터). 지난 기록은 지우지 않는다 — 연도 조회로 찾는다.
  // 화면이 전부 받아서 거르면 1년에 수천 건이 쌓여도 매번 다 내려간다(9/10 검증 지적).
  const currentFilter = searchParams.get("current") === "1"
    ? { endDate: { gte: kstTodayMidnight() }, status: { in: ["PENDING", "APPROVED"] as ("PENDING" | "APPROVED")[] } }
    : {};

  const where =
    selfOnly
      ? { userId: session.userId, ...(status ? { status } : {}), ...dateFilter, ...currentFilter }
      : { ...branchFilter, ...(status ? { status } : {}), ...dateFilter, ...currentFilter };

  const requests = await prisma.leaveRequest.findMany({
    where,
    include: {
      user:     { select: { id: true, name: true, department: true, branch: true, role: true } },
      approver: { select: { name: true, branch: true, role: true } },   // role 은 canCancel 판정용 — 응답에서는 뺀다
      approvalSteps: {
        include: { approver: { select: { id: true, name: true, position: true, branch: true } } },
        orderBy: { order: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // 데이터 필터링 적용 (권한에 따라 민감한 정보 제외)
  // 휴가 조회는 이미 권한 검증이 되어 있음 (EMPLOYEE는 자신, MANAGER는 자신의 지점만)
  // canCancel — 화면은 취소 버튼을 이 값으로만 그린다. 취소 라우트와 **같은 함수**로 판정해서
  // "누르면 403" 버튼이나 "버튼은 없는데 id 로는 되는" 구멍이 생기지 않게 한다(2026-09-10).
  const viewer = await cancelViewerFor(session);
  const filteredRequests = requests.map(req => ({
    ...req,
    user: {
      id: req.user.id,
      name: req.user.name,
      department: req.user.department,
      branch: req.user.branch,
    },
    approver: req.approver ? { name: req.approver.name, branch: req.approver.branch } : null,
    ...cancelFlags(leaveCancelDenial(viewer, req)),   // canCancel + cancelBlock(못 하는 이유)
  }));

  return NextResponse.json({ requests: filteredRequests });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // try 밖이라 여기서 던지면 미처리 500 이 된다 — 본문 없이 부르면 누구나 오류 로그를
  // 하나씩 만들 수 있었다(결재 라우트만 고치고 신청 라우트를 빠뜨렸었다).
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }
  const { type, startDate, endDate, reason, attachmentUrl, attachmentName } = body;

  if (!type || !startDate || !endDate) {
    return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
  }
  // ⚠ 근무일정과 **같은 기준**으로 모양을 먼저 본다. 종전에는 검증이 없어
  //   `reason` 에 객체가 오면 String(...) 이 던져 500 이 됐고, 없는 휴가 유형이나
  //   깨진 날짜도 그대로 Prisma 까지 갔다(2026-09-09 검증에서 실증).
  const { isRealDate } = await import("@/lib/schedule-payload");
  if (!isRealDate(startDate) || !isRealDate(endDate)) {
    return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)" }, { status: 400 });
  }
  if (typeof type !== "string" || !(LEAVE_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: "휴가 유형이 올바르지 않습니다." }, { status: 400 });
  }
  const leaveType = type as LeaveTypeValue;
  for (const [label, v] of [["첨부 경로", attachmentUrl], ["첨부 파일명", attachmentName]] as const) {
    if (v !== undefined && v !== null && typeof v !== "string") {
      return NextResponse.json({ error: `${label} 형식이 올바르지 않습니다.` }, { status: 400 });
    }
  }
  // 신청 사유 필수(모든 유형)
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "신청 사유를 입력해주세요." }, { status: 400 });
  }
  // 대체휴무는 동의서 첨부 필수
  if (type === "COMPENSATORY" && !attachmentUrl) {
    return NextResponse.json({ error: "대체휴무는 대체휴무 동의서 첨부가 필요합니다." }, { status: 400 });
  }

  const start = new Date(startDate);
  const end   = new Date(endDate);

  if (start > end) {
    return NextResponse.json({ error: "종료일이 시작일보다 빠릅니다." }, { status: 400 });
  }
  // 기간 상한 — 근무일정 신청과 같은 366일. 종전에는 상한이 없어서, 연차를 차감하지 않는
  // 유형(특별휴가.경조사 등)은 잔여 검사도 안 받으므로 수십 년짜리 신청이 통과했다.
  // 그런 행이 하나 생기면 달력.집계.일자 루프에 영구히 얹힌다(2026-09-09 검증에서 적발).
  if ((end.getTime() - start.getTime()) / 86400000 > 366) {
    return NextResponse.json({ error: "휴가 신청 기간은 최대 1년까지 가능합니다." }, { status: 400 });
  }

  // 근무일(평일)만 계산 — 주말과 공휴일(Holiday 테이블) 제외
  let days: number;
  if (type === "HALF_AM" || type === "HALF_PM" || type === "COMPENSATORY_HALF" || type === "CIVIL_DEFENSE") {
    days = 0.5;
  } else if (type === "QUARTER_AM" || type === "QUARTER_PM") {
    days = 0.25;
  } else {
    const allDays = eachDayOfInterval({ start, end });
    const holidaySet = await getHolidaySet(start, end);
    days = allDays.filter(d => getDay(d) !== 0 && getDay(d) !== 6 && !holidaySet.has(ymdUTC(d))).length;
    if (days === 0) {
      return NextResponse.json({ error: "선택한 기간에 근무일이 없습니다. (주말·공휴일 제외)" }, { status: 400 });
    }
  }
  // 반차/반반차는 단일 날짜 — 주말·공휴일이면 차감이 무의미하므로 거부
  if (days === 0.5 || days === 0.25) {
    const startIsOff =
      getDay(start) === 0 || getDay(start) === 6 || (await getHolidaySet(start, start)).has(ymdUTC(start));
    if (startIsOff) {
      return NextResponse.json({ error: "주말·공휴일에는 반차/반반차를 신청할 수 없습니다." }, { status: 400 });
    }
  }

  // 잔여 휴가 확인 (연차 차감 유형만 — 대체휴무/특별휴가/민방위/예비군은 미차감이므로 검사 생략)
  if (isLeaveDeductible(type)) {
    const balance = await prisma.leaveBalance.findUnique({
      where: { userId_year: { userId: session.userId, year: currentLeaveYear() } },
    });
    if (balance && balance.remaining < days) {
      return NextResponse.json({
        error: `잔여 휴가가 부족합니다. (잔여 ${balance.remaining}일, 신청 ${days}일)`,
      }, { status: 400 });
    }
  }

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
    ? await branchHasManager(submitter.branch) // 대표/겸직 모두 인정
    : false;

  let policySteps: { approverRole: string; branch: string | null; approverId?: string }[] = [];
  if (submitter?.role === "MANAGER") {
    // ⚠ 원장도 **관리자 승인이 필수**다(디렉터 지시).
    //
    //  · **겸직(멀티) 원장이 신청자면 바로 관리자 결재로 간다** (2026-09-09 디렉터 지시).
    //    여러 지점을 총괄하는 사람이라 같은 급의 원장에게 먼저 받을 이유가 없다.
    //  · 단일 지점 원장은, 그 지점을 함께 보는 다른 원장이 있으면 그 원장이 먼저 결재한다
    //    — 한 지점에 원장이 2명이면 서로가 상대의 결재자가 되고, 겸직 원장은 자기가
    //    관리하는 다른 지점의 원장을 결재한다.
    //  · 그런 원장이 없으면 관리자 단독.
    //  (자기 신청을 자기가 결재하는 것은 결재 라우트에서 막는다)
    const myBranches = await getManagerBranches(session.userId);
    const isMultiBranch = myBranches.length > 1;

    // 메인 원장이 지정돼 있으면 **방향이 정해진다** — 메인이 두 번째를 결재한다.
    // 메인 원장 본인이 신청하면 겸직 원장과 같이 관리자에게 바로 간다.
    const main = !isMultiBranch && submitter.branch
      ? await branchMainManager(submitter.branch)
      : null;

    if (main && main.id !== session.userId) {
      // 두 번째 원장의 신청 → [메인 원장 → 관리자]. 지정 결재자로 못박는다.
      policySteps = [{ approverRole: "MANAGER", branch: submitter.branch ?? null, approverId: main.id }, adminStep];
    } else if (main) {
      policySteps = [adminStep];               // 메인 원장 본인 → 관리자 바로
    } else {
      // 메인 지정이 없으면 종전대로 — 같은 지점에 다른 원장이 있으면 그 원장이 먼저.
      const peer = !isMultiBranch && submitter.branch
        ? await branchHasOtherManager(submitter.branch, session.userId)
        : false;
      policySteps = peer ? [managerStep, adminStep] : [adminStep];
    }
  } else if (submitter?.role === "ADMIN") {
    const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { not: session.userId } } });
    policySteps = otherAdmins > 0 ? [adminStep] : [];
  } else {
    if (days >= 2) policySteps = hasBranchManager ? [managerStep, adminStep] : [adminStep];
    else policySteps = hasBranchManager ? [managerStep] : [adminStep];
  }

  // ⚠ 트랜잭션이 던지면 미처리 500 이 된다 — 근무일정에는 try/catch 가 있는데
  //   휴가만 빠져 있었다(2026-09-09 검증에서 적발).
  try {
    // ⚠ 신청과 결재 단계를 **한 트랜잭션으로** 만든다(근무일정과 같은 방식).
    //   종전에는 신청을 먼저 만들고 단계를 나중에 만들어서, 단계 생성이 실패하면
    //   **결재선 없는 대기 신청**이 남아 관리자의 "결재라인 없음" 목록으로 흘러가
    //   원장 단계를 건너뛰었다(2026-09-09 검증에서 적발).
    const leaveRequest = await prisma.$transaction(async (tx) => {
      const created = await tx.leaveRequest.create({
        data: {
          userId: session.userId,
          type: leaveType,   // 위에서 enum 값임을 확인한 것만 넣는다
          startDate: start,
          endDate:   end,
          days,
          reason,
          attachmentUrl: attachmentUrl ?? null,
          attachmentName: attachmentName ?? null,
          status: policySteps.length > 0 ? "PENDING" : "APPROVED",
          ...(policySteps.length > 0 ? {} : { approverId: session.userId }),
        },
      });

      if (policySteps.length > 0) {
        await tx.leaveApprovalStep.createMany({
          data: policySteps.map((st, idx) => ({
            leaveRequestId: created.id,
            order: idx + 1,
            approverRole: st.approverRole,
            branch: st.branch,
            approverId: st.approverId ?? null,   // 메인 원장처럼 **사람을 못박은** 단계
            status: idx === 0 ? "PENDING" : "WAITING",
          })),
        });
      } else if (isLeaveDeductible(leaveType)) {
        // 결재 단계 없음(관리자 본인 + 다른 관리자 없음) → 자동 승인 + 즉시 차감
        await tx.leaveBalance.upsert({
          where: { userId_year: { userId: session.userId, year: currentLeaveYear() } },
          create: { userId: session.userId, year: currentLeaveYear(), total: 15, used: days, remaining: 15 - days },
          update: { used: { increment: days }, remaining: { decrement: days } },
        });
      }

      return created;
    });

    // 1단계 결재자에게 알린다 — 근무일정과 같은 기준(지정 결재자 + 전체 관리자).
    // 종전에는 휴가에 결재 요청 알림이 아예 없어, 결재자가 화면에 직접 들어가야만 알았다.
    if (policySteps.length > 0) {
      const ymd = (d: Date) => d.toISOString().slice(0, 10);
      botNotifyApprovalRequest(policySteps[0], {
        kind: "휴가",
        requesterName: session.name,
        period: `${ymd(leaveRequest.startDate)} ~ ${ymd(leaveRequest.endDate)}`,
        requesterId: session.userId,
      }).catch(() => {});
    }

    return NextResponse.json({ success: true, leaveRequest, days });
  } catch (error) {
    console.error("휴가 신청 생성 오류:", error);
    return NextResponse.json({ error: "휴가 신청 중 오류가 발생했습니다." }, { status: 500 });
  }
}

