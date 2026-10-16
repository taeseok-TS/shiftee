import { NextResponse } from "next/server";
import { cancelStepWhere } from "@/lib/leave-cancel-flow";
import { getSession } from "@/lib/auth";
import { isAllowed } from "@/lib/permission-settings";
import { prisma } from "@/lib/db";
import { kstTodayDateUTC } from "@/lib/kst";
import { getManagerBranches } from "@/lib/manager-branches";
import { approverScopeFor, myStepOr } from "@/lib/approval-delegate";
import { countableEmployeeWhere } from "@/lib/employee-scope";
import { absentUserIds } from "@/lib/attendance-absent";

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

  // 퇴사일이 지난 사람은 팀 인원·미출근에서 뺀다 — 퇴사일 당일까지는 재직(lib/resign isResigned 와 같은 규칙, 2026-10-17 #219 검증 F3)
  const baseMemberWhere = await countableEmployeeWhere(session.role === "MANAGER" ? { branches: myBranches } : {});
  const memberWhere = {
    ...baseMemberWhere,
    AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: kstTodayDateUTC() } }] }],
  };
  // 지난 날을 보는 목록(금월 결근자)은 퇴사 거르기를 하지 않는다 — 이달 중 퇴사한 사람의 결근도 남아야 한다(재검증 N2)

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

      // 내 계약 결재 대기 — 팀 계약서 「내 결재 대기」(api/contracts/my-approvals)와 같은 조건(2026-10-16 이예지 QA R2:
      //   종전엔 「지점 직원에게 SENT 상태」를 세서 원장 차례 건(APPROVED)이 빠져 「내 결재 대기 5건」인데 0건으로 보였다)
      prisma.contractApprovalStep.count({
        where: { approverId: session.userId, status: "PENDING", approvalLine: { contract: { status: { not: "EXPIRED" }, isTest: false } } },
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
          user: baseMemberWhere,
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
  // 미출근 = 오늘 근무일정(WORK)이 있는데 출근 기록이 없고(출근 요청 대기도 아님) 휴가도 아닌 직원 — 관리자 대시보드와 같은 함수
  // (2026-10-16 #219-3). 종전에는 휴무·공휴일만 빼고 일정이 없는 직원도 근무로 봐서 미출근으로 셌다(a59a786 검증 F4 의 후속).
  const absentIds = await absentUserIds(members.map((m) => m.id), today);
  const missingNames = members.filter((m) => absentIds.has(m.id) && !presentIds.has(m.id) && !leaveIds.has(m.id)).map((m) => m.name);
  const late = lateNames.length;
  const earlyLeave = earlyLeaveNames.length;
  const absent = missingNames.length;

  // 본부가 「원장 지점 출퇴근 기록 열람」을 끄면(권한 설정 #39) 출퇴근 집계·이름은 내려보내지 않는다(10/14 검증 2)
  const attendanceHidden = session.role === "MANAGER" && !(await isAllowed("manager.viewAttendance"));
  return NextResponse.json({
    teamCount,
    attendance: attendanceHidden ? { present: 0, late: 0, absent: 0, earlyLeave: 0, onLeave } : { present, late, absent, earlyLeave, onLeave },
    names: attendanceHidden ? { late: [], missing: [], earlyLeave: [] } : { late: lateNames, missing: missingNames, earlyLeave: earlyLeaveNames },
    attendanceHidden,
    pendingContracts,
    pendingApprovals: pendingLeaveSteps + pendingScheduleSteps + pendingCancelSteps,
    monthAbsent: attendanceHidden ? 0 : monthAbsent.length,
  });
}
