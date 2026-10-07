import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { materializeSchedules } from "@/lib/schedule-materialize";
import { branchHasApprover } from "@/lib/approval-delegate";
import { branchHasOtherManager, getManagerBranches, branchMainManager } from "@/lib/manager-branches";
import { getHolidaySet } from "@/lib/holidays";
import { SCHEDULE_REQUEST_STATUSES, pick } from "@/lib/enums";
import { parseScheduleData, breakHours, toMin } from "@/lib/schedule-payload";
import { botNotifyApprovalRequest } from "@/lib/bot";
import { scheduleCancelDenial, cancelFlags } from "@/lib/leave-cancel";
import { cancelViewerFor } from "@/lib/cancel-viewer";

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

  // 취소 버튼은 화면이 이 값으로만 그린다 — 취소 라우트와 **같은 함수**(대기 중 + 지난 신청 아님).
  // 종전엔 화면이 status==="PENDING" 만 보고 그려서, 지난 대기 건에 누르면 409 인 버튼이 떴다
  // (9/11 검증 D1). 본인 신청만 오므로 범위 판정은 늘 통과한다 — user 는 쓰이지 않는다.
  const viewer = await cancelViewerFor(session);
  return NextResponse.json({
    requests: requests.map((r) => ({ ...r, ...cancelFlags(scheduleCancelDenial(viewer, { ...r, user: null })) })),
  });
}

// 근무일정 신청 생성
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // try 밖이라 여기서 던지면 미처리 500 이 된다 — 본문 없이 부르면 누구나 오류 로그를
  // 하나씩 만들 수 있었다(결재 라우트만 고치고 신청 라우트를 빠뜨렸었다).
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }
  const { startDate, endDate, scheduleData, totalHours, approvalLineId } = body;
  let { templateId, templateName } = body;
  // 신청 종류(2026-10-07 #49) — CREATE 새 일정 / UPDATE 기존 일정 수정 / DELETE 기존 일정 삭제
  const kind: "CREATE" | "UPDATE" | "DELETE" = body.kind === "UPDATE" || body.kind === "DELETE" ? body.kind : "CREATE";
  if (kind === "DELETE") { templateId = "DELETE"; templateName = "근무일정 삭제"; }

  if (!templateId || !startDate || !endDate || !scheduleData) {
    return NextResponse.json({ error: "필수 정보가 부족합니다." }, { status: 400 });
  }

  // payload 를 **엄격하게** 검증하고 정규화한다. 결재 정책과 실제 반영이 같은 값을
  // 보게 하려는 것 — 형식이 어긋난 날짜 하나로 주말.공휴일 결재선이 통째로
  // 사라지던 구멍을 여기서 막는다(2026-09-08 검증에서 적발).
  const parsed = parseScheduleData(scheduleData, startDate, endDate);
  if (parsed.ok !== true) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const entries = parsed.entries;

  // 수정·삭제는 **이미 근무일정이 있는 날**만, 그리고 오늘 이후만(지난 기록은 출퇴근기록 수정 요청으로)
  if (kind !== "CREATE") {
    const todayYmd = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    if (entries.some((e) => e.date < todayYmd))
      return NextResponse.json({ error: "지난 날짜의 근무일정은 수정·삭제를 요청할 수 없습니다." }, { status: 400 });
    const dates = entries.map((e) => { const [y, m, d] = e.date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); });
    const have = await prisma.schedule.findMany({
      where: { userId: session.userId, date: { in: dates }, type: "WORK" }, select: { date: true },
    });
    const haveSet = new Set(have.map((h) => h.date.toISOString().slice(0, 10)));
    const missing = entries.filter((e) => !haveSet.has(e.date)).map((e) => e.date);
    if (missing.length)
      return NextResponse.json({ error: `근무일정이 없는 날이 있습니다: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " 외" : ""} — 새 일정은 「일정 신청」으로 해 주세요.` }, { status: 400 });
    if (kind === "UPDATE" && typeof templateName === "string" && !templateName.startsWith("수정 · ")) templateName = `수정 · ${templateName}`;
  }

  // 같은 날짜에 대기 중인 요청이 있으면 받지 않는다 — 수정·삭제가 끼면 승인 순서에 따라 결과가 갈린다(#49 검증).
  // 새 일정 신청끼리는 종전대로(겹치면 나중 승인이 덮는다) 두고, 어느 한쪽이 수정·삭제일 때만 막는다.
  {
    const pend = await prisma.scheduleRequest.findMany({
      where: {
        userId: session.userId, status: "PENDING",
        ...(kind === "CREATE" ? { kind: { not: "CREATE" } } : {}),
        startDate: { lte: new Date(entries[entries.length - 1].date) },
        endDate: { gte: new Date(entries[0].date) },
      },
      select: { scheduleData: true },
    });
    const mine = new Set(entries.map((e) => e.date));
    const clash = pend.some((p) => (Array.isArray(p.scheduleData) ? p.scheduleData : [])
      .some((x) => mine.has(String((x as { date?: unknown })?.date ?? ""))));
    if (clash)
      return NextResponse.json({ error: "같은 날짜에 승인을 기다리는 근무일정 요청이 있습니다. 그 요청이 처리되거나 취소된 뒤 다시 보내 주세요." }, { status: 409 });
  }

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

  if (kind === "DELETE") computedHours = 0;   // 삭제 요청은 근무시간이 늘지 않는다

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
    ? await branchHasApprover(submitter.branch, session.userId) // 대표/겸직 원장, 또는 오늘 원장대행(원장 공석 때)
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
          kind,
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
            approverId: s.approverId ?? null,   // 메인 원장처럼 **사람을 못박은** 단계
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
        requesterName: kind === "CREATE" ? (me?.name ?? "직원") : `${me?.name ?? "직원"} (${kind === "DELETE" ? "삭제 요청" : "수정 요청"})`,
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
