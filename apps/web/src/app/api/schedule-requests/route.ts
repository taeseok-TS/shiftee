import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { materializeSchedules } from "@/lib/schedule-materialize";
import { branchHasManager } from "@/lib/manager-branches";
import { getHolidaySet } from "@/lib/holidays";
import { SCHEDULE_REQUEST_STATUSES, pick } from "@/lib/enums";
import { parseScheduleData, breakHours, toMin } from "@/lib/schedule-payload";
import { botNotifyApprovalRequest } from "@/lib/bot";

// 근무일정 신청 조회 (자신의 신청)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = pick(SCHEDULE_REQUEST_STATUSES, searchParams.get("status"));

  const requests = await prisma.scheduleRequest.findMany({
    where: {
      userId: session.userId,
      ...(status && { status }),
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

  if (!templateId || !startDate || !endDate || !scheduleData) {
    return NextResponse.json({ error: "필수 정보가 부족합니다." }, { status: 400 });
  }

  // payload 를 **엄격하게** 검증하고 정규화한다. 결재 정책과 실제 반영이 같은 값을
  // 보게 하려는 것 — 형식이 어긋난 날짜 하나로 주말.공휴일 결재선이 통째로
  // 사라지던 구멍을 여기서 막는다(2026-09-08 검증에서 적발).
  const parsed = parseScheduleData(scheduleData, startDate, endDate);
  if (parsed.ok !== true) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const entries = parsed.entries;

  // 승인된 휴가가 걸친 날은 그만큼 뺀다 — 신청 화면과 **같은 규칙**이어야 결재자가
  // 보는 숫자가 화면과 일치한다(반차 0.5, 반반차 0.25 는 그 비율만큼).
  // 신청자가 보낸 totalHours 는 믿지 않는다. 이 값이 결재자가 보는 유일한 정량 정보다.
  let computedHours = parsed.totalHours;
  try {
    const leaves = await prisma.leaveRequest.findMany({
      where: {
        userId: session.userId,
        status: "APPROVED",
        startDate: { lte: new Date(entries[entries.length - 1].date) },
        endDate: { gte: new Date(entries[0].date) },
      },
      select: { startDate: true, endDate: true, days: true },
    });
    const frac: Record<string, number> = {};
    for (const lv of leaves) {
      const f = lv.days && lv.days < 1 ? lv.days : 1;
      for (let d = new Date(lv.startDate); d <= lv.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        frac[key] = Math.max(frac[key] ?? 0, f);
      }
    }
    let deduct = 0;
    for (const e of entries) {
      const f = frac[e.date];
      if (!f) continue;
      const span = (toMin(e.endTime) - toMin(e.startTime)) / 60;
      deduct += f * Math.max(span - breakHours(span), 0);
    }
    computedHours = Math.max(Math.round((computedHours - deduct) * 10) / 10, 0);
  } catch (e) {
    // 휴가 조회 실패는 신청을 막지 않는다 — 차감 없이 간다(과소가 아니라 과대로 남는다)
    console.error("[schedule-requests] 휴가 차감 계산 실패:", e);
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
  // 검증을 통과한 목록이므로 전부 실재하는 "YYYY-MM-DD" 이고 정렬돼 있다.
  const submittedDates = entries.map((e) => e.date);
  const holidaySet = submittedDates.length
    ? await getHolidaySet(new Date(submittedDates[0]), new Date(submittedDates[submittedDates.length - 1]))
    : new Set<string>();
  const hasWeekend = entries.some((e) => {
    if (holidaySet.has(e.date)) return true;
    const [y, m, d] = e.date.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
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
          scheduleData: entries,   // 정규화된 목록만 저장한다
          totalHours: computedHours,
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

    // 1단계 결재자에게 알린다. 종전에는 결재 "결과" 알림만 있어서, 결재자가 화면에
    // 직접 들어가야만 온 줄 알았다(미결이 7주 방치된 건이 실재했다).
    if (policySteps.length > 0) {
      const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
      botNotifyApprovalRequest(policySteps[0], {
        kind: "근무일정",
        requesterName: me?.name ?? "직원",
        period: `${entries[0].date} ~ ${entries[entries.length - 1].date}`,
        requesterId: session.userId,
      }).catch(() => {});
    }

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
