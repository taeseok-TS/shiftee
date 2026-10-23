import { leaveLabel } from "@/lib/leave-catalog";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { kstTodayDateUTC } from "@/lib/kst";
import { absentUserIds } from "@/lib/attendance-absent";
import { autoCloseTime, autoOpenTime, autoFillSettings } from "@/lib/attendance-policy";
import { countableEmployeeWhere, headcountSummary, testRequesterExclusion } from "@/lib/employee-scope";
import { templateLabel } from "@/lib/schedule-label";

// 관리자 대시보드 통계 (오늘 근무 현황 + 대기 결재 + 직원 수)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 조회할 수 있습니다." }, { status: 403 });

  // 오늘 날짜 (UTC 자정 — @db.Date 컬럼과 동일 규칙)
  const nowDate = new Date();
  const today = kstTodayDateUTC();

  // 근태를 세는 사람 = 지점 직원(재직 · 휴직 빼고). 관리자 · 통계 제외 지점(본부 · 테스트지점) · 퇴사일 지난 사람 · 테스트 계정 제외 —
  // 인원 숫자 공용 기준(lib/employee-scope, 2026-10-23 ■0-9 · ■3). 퇴사일 조건은 AND 에 있어 아래 「최근 7일 누락」이 바꿔 끼운다
  // 결재 숫자 · 목록은 결재함과 같은 기준 — 테스트 계정이 올린 신청은 뺀다(2026-10-23 이예지 답, 결재함은 「테스트 포함」으로만 보인다)
  const testEx = await testRequesterExclusion(session);
  const pendingForMe = { status: "PENDING" as const, userId: { not: session.userId }, ...(testEx ? { user: testEx } : {}) };
  const employeeWhere = await countableEmployeeWhere({ activeOn: today });
  // 「전체 직원」 칸 = 지점 재직 + 휴직(인사카드 기준) — 인사 › 직원 · 현황과 같은 숫자
  const headcount = await headcountSummary({ activeOn: today });

  const [members, todayRecords, onLeave, pendingLeave, pendingSchedule, pendingLeaveItems, pendingScheduleItems, missingRecords] =
    // 관리자 결재함(my-approvals)은 **본인 신청을 뺀다.** 대시보드 숫자도 같아야
    // 카드를 눌렀을 때 빈 화면이 되지 않는다.
    await Promise.all([
      // 인원 — 미출근 계산(#219-3)에 id, 출퇴근 현황 「지점별 현황」(R10)에 지점이 필요하다
      prisma.user.findMany({ where: employeeWhere, select: { id: true, branch: true } }),

      // 오늘 출퇴근 기록
      prisma.attendance.findMany({
        where: { date: today, user: employeeWhere },
      }),

      // 오늘 휴가 중 (승인된 휴가)
      prisma.leaveRequest.count({
        where: {
          status: "APPROVED",
          startDate: { lte: today },
          endDate: { gte: today },
          user: employeeWhere,
        },
      }),

      // 대기 중인 휴가/근무일정 결재 — **결재함과 같은 기준**이어야 한다.
      // ⚠ 종전에는 대기 신청 전체를 셌다(본인 것 포함). 결재함은 본인 신청을 빼므로,
      //   관리자가 자기 신청을 내는 순간 "승인 대기 1건"이 뜨는데 결재함은 비어 있었다
      //   (2026-09-09 검증에서 적발 — 원장 대시보드에서 고친 그 버그의 세 번째 자리).
      prisma.leaveRequest.count({ where: pendingForMe }),
      prisma.scheduleRequest.count({ where: pendingForMe }),

      // 승인 대기 항목 목록 (최근순 5건씩) — 눌러 들어가면 결재함에 있어야 한다
      prisma.leaveRequest.findMany({
        where: pendingForMe,
        include: { user: { select: { name: true } }, approvalSteps: { select: { approverRole: true, status: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.scheduleRequest.findMany({
        where: pendingForMe,
        include: { user: { select: { name: true } }, approvalSteps: { select: { approverRole: true, status: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),

      // 최근 7일 출퇴근 누락 (출근 또는 퇴근 누락)
      // 집계 대상 직원만 — 관리자·통계 제외 지점(테스트·본부)은 뺀다. 퇴사자는 이 7일 안에 퇴사한 사람까지는 남긴다(퇴사 직전 누락을 보정할 수 있게, 재검증 N2)
      prisma.attendance.findMany({
        where: {
          date: { gte: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000), lt: today },
          OR: [{ clockIn: null }, { clockOut: null }],
          importBatch: null,   // 시프티에서 옮긴 기록(10/20까지)은 누락 목록에 넣지 않는다
          user: { ...employeeWhere, AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: new Date(today.getTime() - 7 * 86400000) } }] }] },
        },
        include: { user: { select: { name: true, email: true, branch: true } } },
        orderBy: { date: "desc" },
        take: 10,
      }),
    ]);

  const totalEmployees = headcount.total;
  const present = todayRecords.filter((r) => r.clockIn).length;
  const late = todayRecords.filter((r) => r.status === "LATE").length;
  const earlyLeave = todayRecords.filter((r) => r.status === "EARLY_LEAVE").length;
  // 미출근 = 오늘 근무일정(WORK)이 있는데 출근 기록이 없고 휴가도 아닌 사람(2026-10-16 #219-3).
  // 종전 「재직자 − 출근 − 휴가」는 일정 없는 날 전원(115명)을 미출근으로 셌다. 원장 대시보드와 같은 함수.
  const absentSet = await absentUserIds(members.map((m) => m.id), today);
  const absent = absentSet.size;

  // 출퇴근 현황 「지점별 현황」(2026-10-21 본부 시안 R10) — 지점 · 일정 · 출근 · 지각 · 미출근 · 휴가.
  // 일정 = 오늘 근무일정(WORK)이 있는 사람(미출근과 같은 기준 — lib/attendance-absent), 휴가 = 오늘 걸친 승인 휴가가 있는 사람(사람 수)
  const memberIds = members.map((m) => m.id);
  const [schedRows, leaveRows] = memberIds.length
    ? await Promise.all([
        prisma.schedule.findMany({
          where: {
            date: today, userId: { in: memberIds }, type: "WORK",
            user: { AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: today } }] }, { OR: [{ hireDate: null }, { hireDate: { lte: today } }] }] },
          },
          select: { userId: true },
        }),
        prisma.leaveRequest.findMany({ where: { userId: { in: memberIds }, status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } }, select: { userId: true } }),
      ])
    : [[], []];
  const schedSet = new Set(schedRows.map((r) => r.userId));
  const leaveSet = new Set(leaveRows.map((r) => r.userId));
  const recByUser = new Map(todayRecords.map((r) => [r.userId, r]));
  const branchOf = new Map(members.map((m) => [m.id, m.branch || "지점 없음"]));
  const byBranchMap = new Map<string, { branch: string; scheduled: number; present: number; late: number; absent: number; onLeave: number }>();
  for (const m of members) {
    const b = branchOf.get(m.id)!;
    const row = byBranchMap.get(b) ?? { branch: b, scheduled: 0, present: 0, late: 0, absent: 0, onLeave: 0 };
    const rec = recByUser.get(m.id);
    if (schedSet.has(m.id)) row.scheduled++;
    if (rec?.clockIn) row.present++;
    if (rec?.status === "LATE") row.late++;
    if (absentSet.has(m.id)) row.absent++;
    if (leaveSet.has(m.id)) row.onLeave++;
    byBranchMap.set(b, row);
  }
  const byBranch = [...byBranchMap.values()].sort((a, b) => a.branch.localeCompare(b.branch, "ko"));
  const scheduled = schedSet.size;

  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  // 대시보드 결재함 줄 아래 회색 한 줄(2026-10-21 본부 시안 R9) — 「휴가 승인 · 원장 승인 끝」처럼 지금 어디까지 왔는지
  const stepNote = (steps: { approverRole: string | null; status: string }[]) => {
    const mgr = steps.filter((x) => x.approverRole === "MANAGER");
    if (!mgr.length) return "";
    return mgr.every((x) => x.status === "APPROVED") ? " · 원장 승인 끝" : " · 원장 승인 전";
  };

  // 휴가 취소 결재 — 결재함(/api/leave/cancel-requests/my-approvals)과 같은 기준(본인 요청 제외)
  // 휴가 첫날부터는 승인할 수 없으니 숫자에서도 뺀다(결재함 cancelStepWhere 와 같은 기준)
  const cancelPendingWhere = { ...pendingForMe, leaveRequest: { startDate: { gt: today } } };
  const [pendingLeaveCancel, pendingCancelItems] = await Promise.all([
    prisma.leaveCancelRequest.count({ where: cancelPendingWhere }),
    prisma.leaveCancelRequest.findMany({
      where: cancelPendingWhere,
      include: {
        user: { select: { name: true } },
        leaveRequest: { select: { type: true, startDate: true, endDate: true, days: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const pendingItems = [
    ...pendingLeaveItems.map((r) => ({
      id: r.id,
      type: "leave" as const,
      title: `${leaveLabel(r.type)} ${fmt(r.startDate)}~${fmt(r.endDate)} (${r.days}일)`,
      requester: r.user.name,
      requestedAt: r.createdAt,
      note: `휴가 승인${stepNote(r.approvalSteps)}`,
    })),
    ...pendingScheduleItems.map((r) => ({
      id: r.id,
      type: "schedule" as const,
      title: `${r.templateName?.startsWith("근무일정") ? "" : "근무일정 "}${templateLabel(r.templateName)} ${fmt(r.startDate)}~${fmt(r.endDate)}`,
      requester: r.user.name,
      requestedAt: r.createdAt,
      note: `근무일정 승인${stepNote(r.approvalSteps)}`,
    })),
    ...pendingCancelItems.map((r) => ({
      id: r.id,
      type: "leaveCancel" as const,
      title: `휴가 취소 요청 · ${leaveLabel(r.leaveRequest.type)} ${fmt(r.leaveRequest.startDate)}~${fmt(r.leaveRequest.endDate)} (${r.leaveRequest.days}일)`,
      requester: r.user.name,
      requestedAt: r.createdAt,
      note: "휴가 취소 승인",
    })),
  ].sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());

  // 누르면 채워질 시각을 미리 계산해 보여 준다 — 보정 API 와 같은 함수(2026-10-16 #219-4, 종전 문구는 「9시간 기준」 고정).
  // 그 날 직원이 올린 출퇴근 요청(수정·퇴근 처리 등)이 대기 중이면 표시한다 — 보정 대신 결재로 처리한다
  //   (보정해 버리면 그 요청 승인이 「이미 퇴근 기록이 있습니다」로 막힌다. auto-fill 도 이 경우 409).
  const fillSettings = await autoFillSettings();
  const pendingReqs = missingRecords.length
    ? await prisma.attendanceRequest.findMany({
        where: {
          status: "PENDING",
          // 기기 변경 · 출퇴근 기록 요청(RECORD — 기록을 내 달라는 요청, 기록을 바꾸지 않는다)은 보정을 막지 않는다(10/23 검증 F)
          kind: { notIn: ["DEVICE", "RECORD"] },
          OR: missingRecords.map((r) => ({ userId: r.userId, workDate: r.date })),
        },
        select: { userId: true, workDate: true },
      })
    : [];
  const pendingKey = new Set(pendingReqs.map((p) => `${p.userId}:${p.workDate.toISOString().slice(0, 10)}`));
  const missingAttendance = [];
  for (const r of missingRecords) {
    const ymd = r.date.toISOString().slice(0, 10);
    const fill = r.clockIn && !r.clockOut
      ? await autoCloseTime(r.userId, ymd, r.clockIn, fillSettings)
      : !r.clockIn && r.clockOut
        ? await autoOpenTime(r.userId, ymd, r.clockOut, { fallbackHours: fillSettings.fallbackHours })
        : null;
    missingAttendance.push({
      id: r.id,
      name: r.user.name,
      email: r.user.email,
      branch: r.user.branch,
      date: r.date,
      // 용어는 「출근·퇴근」(2026-10-16 #219-5, 종전 「입실·퇴실 누락」)
      type: !r.clockIn ? "출근 누락" : "퇴근 누락",
      mode: !r.clockIn ? "in" : "out",
      fillAt: fill?.at ?? null,
      fillLabel: fill?.label ?? null,
      pendingRequest: pendingKey.has(`${r.userId}:${ymd}`),
    });
  }

  return NextResponse.json({
    totalEmployees,
    headcount: { total: headcount.total, staff: headcount.staff, onLeave: headcount.onLeave, managers: headcount.managers, basis: headcount.basis },
    // 휴가 = 오늘 걸친 승인 휴가가 있는 **사람 수**(지점별 표와 같은 기준 — 신청 건수(onLeave count)는 반차 두 건이면 2가 됐다, R10 검증)
    attendance: { present, late, absent, earlyLeave, onLeave: memberIds.length ? leaveSet.size : onLeave, scheduled },
    byBranch,
    pending: { leave: pendingLeave, schedule: pendingSchedule, leaveCancel: pendingLeaveCancel },
    pendingItems,
    missingAttendance,
  });
}
