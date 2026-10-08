import { NextResponse } from "next/server";
import { cancelStepWhere } from "@/lib/leave-cancel-flow";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { kstTodayDateUTC } from "@/lib/kst";
import { getManagerBranches } from "@/lib/manager-branches";
import { approverScopeFor, myStepOr } from "@/lib/approval-delegate";
import { countableEmployeeWhere } from "@/lib/employee-scope";

// 원장(팀) 대시보드 통계 — 자기 지점 기준
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  // MANAGER는 담당 지점(대표+겸직), ADMIN(테스트용)은 전체
  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  // "통계 포함" 꺼진 지점(본부·테스트지점)은 팀 인원에서 뺀다
  // 결재함(my-approvals)과 **같은 조건**을 쓴다 — 숫자와 목록이 어긋나면 안 된다.
  // 지정 결재자로 못박힌 건 + 내 담당 지점의 (못박히지 않은) 원장 단계.
  // ⚠ 결재함(my-approvals)과 **같은 조건**이어야 한다 — 숫자와 목록이 어긋나면
  //   "1건 있다"고 떠서 눌러 보면 빈 화면이 된다(2026-09-09 검증에서 양방향으로 적발).
  //   · 본인 신청은 뺀다(결재함이 그렇게 한다)
  //   · 관리자는 대기 중인 **모든** 단계를 본다(결재함과 동일)
  //   · 원장은 못박힌 건 + 담당 지점의 못박히지 않은 단계
  //
  // ⚠ 관계명이 달라 **두 개를 따로 만든다.** 하나를 만들어 `scheduleRequest: undefined`
  //   로 덮어쓰는 방식은 tsc 가 잡지 못하고, Prisma 가 undefined 처리를 바꾸는 순간
  //   대시보드 전체가 500 이 된다(2026-09-09 검증에서 지적).
  //   · 원장대행 중인 지점도 결재함처럼 센다(lib/approval-delegate.ts myStepOr)
  const scope = await approverScopeFor(session);
  const scheduleOr = session.role === "ADMIN" ? undefined : myStepOr(session, scope, "scheduleRequest");
  const leaveOr = session.role === "ADMIN" ? undefined : myStepOr(session, scope, "leaveRequest");
  const scheduleStepWhere = {
    status: "PENDING" as const,
    scheduleRequest: { userId: { not: session.userId } },
    ...(scheduleOr ? { OR: scheduleOr } : {}),
  };
  const leaveStepWhere = {
    status: "PENDING" as const,
    leaveRequest: { userId: { not: session.userId } },
    ...(leaveOr ? { OR: leaveOr } : {}),
  };
  // 휴가 취소 결재도 **결재함과 같은 함수**로 센다(lib/leave-cancel-flow.ts cancelStepWhere)
  const pendingCancelSteps = await prisma.leaveCancelStep.count({ where: cancelStepWhere(session, scope) });

  const memberWhere = await countableEmployeeWhere(
    session.role === "MANAGER" ? { branches: myBranches } : {}
  );

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  // 오늘 날짜 (UTC 자정 — @db.Date 컬럼과 동일 규칙)
  const today = kstTodayDateUTC();

  const [members, todayRecords, onLeaveRows, pendingContracts, pendingLeaveSteps, pendingScheduleSteps, monthAbsent] =
    await Promise.all([
      // 팀 인원(이름까지 — 미출근 명단용 #215-6)
      prisma.user.findMany({ where: memberWhere, select: { id: true, name: true }, orderBy: { name: "asc" } }),

      // 오늘 출퇴근 기록 (지점 직원) — 지각·조퇴 명단용으로 이름 포함
      prisma.attendance.findMany({
        where: { date: today, user: memberWhere },
        select: { userId: true, clockIn: true, status: true, user: { select: { name: true } } },
      }),

      // 오늘 휴가 중 (승인된 휴가, 지점 직원) — 사람 수로 센다(한 사람의 겹친 신청은 1명)
      prisma.leaveRequest.findMany({
        where: {
          status: "APPROVED",
          startDate: { lte: today },
          endDate: { gte: today },
          user: memberWhere,
        },
        select: { userId: true },
        distinct: ["userId"],
      }),

      // 대기 중인 계약 (지점 직원에게 발송되어 서명 대기 중)
      prisma.contract.count({
        where: { status: "SENT", user: memberWhere, isTest: false },
      }),

      // 내가 결재해야 할 휴가/근무일정.
      // ⚠ 결재함(my-approvals)과 **같은 조건**이어야 한다. 종전에는 지정 결재자만 세서
      //   역할.지점 기반 단계가 빠졌고, 실제로 대기 중인데 화면에는 **0건**으로 떴다
      //   (2026-09-09 검증에서 라이브 실측 — 주예나 2건, 김원장 1건이 안 보였다).
      prisma.leaveApprovalStep.count({ where: leaveStepWhere }),
      prisma.scheduleApprovalStep.count({ where: scheduleStepWhere }),

      // 금월 결근자 (지점 직원, 중복 제거)
      prisma.attendance.findMany({
        where: {
          status: "ABSENT",
          date: { gte: monthStart, lte: monthEnd },
          user: memberWhere,
        },
        select: { userId: true },
        distinct: ["userId"],
      }),
    ]);

  // 오늘 근무 현황 집계 — 숫자와 함께 **누구인지**(#215-6, 박정인 제안: 숫자만 나와 누가 지각·미입력인지 모른다)
  const teamCount = members.length;
  const onLeave = onLeaveRows.length;
  const presentIds = new Set(todayRecords.filter((r) => r.clockIn).map((r) => r.userId));
  const leaveIds = new Set(onLeaveRows.map((r) => r.userId));
  const present = presentIds.size;
  const lateNames = todayRecords.filter((r) => r.status === "LATE").map((r) => r.user.name);
  const earlyLeaveNames = todayRecords.filter((r) => r.status === "EARLY_LEAVE").map((r) => r.user.name);
  // 오늘 일정이 휴무(OFF)·공휴일(HOLIDAY)인 직원은 미출근이 아니다(a59a786 검증 F4). 일정이 없는 직원은 근무로 본다(종전과 같음)
  const offIds = new Set(
    (await prisma.schedule.findMany({ where: { date: today, userId: { in: members.map((m) => m.id) }, type: { in: ["OFF", "HOLIDAY"] } }, select: { userId: true } }))
      .map((s) => s.userId),
  );
  const missingNames = members.filter((m) => !presentIds.has(m.id) && !leaveIds.has(m.id) && !offIds.has(m.id)).map((m) => m.name);
  const late = lateNames.length;
  const earlyLeave = earlyLeaveNames.length;
  const absent = missingNames.length;

  return NextResponse.json({
    teamCount,
    attendance: { present, late, absent, earlyLeave, onLeave },
    names: { late: lateNames, missing: missingNames, earlyLeave: earlyLeaveNames },
    pendingContracts,
    pendingApprovals: pendingLeaveSteps + pendingScheduleSteps + pendingCancelSteps,
    monthAbsent: monthAbsent.length,
  });
}
