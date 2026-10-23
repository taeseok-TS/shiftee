import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { kstTodayDateUTC } from "@/lib/kst";
import { getManagerBranches } from "@/lib/manager-branches";
import { isAllowed } from "@/lib/permission-settings";
import { showTestRows, testAccountWhere } from "@/lib/employee-scope";

// 오늘 출퇴근한 직원 목록 (관리자=전체, 원장=자기 지점)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  if (session.role === "MANAGER" && !(await isAllowed("manager.viewAttendance")))
    return NextResponse.json({ error: "지점 출퇴근 기록 열람이 꺼져 있습니다(본부 > 권한 설정)." }, { status: 403 });   // 권한 설정 #39

  // 오늘 날짜 (UTC 자정 — @db.Date 컬럼과 동일 규칙)
  const now = new Date();
  const today = kstTodayDateUTC();

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const branchWhere =
    session.role === "MANAGER" ? { branch: { in: myBranches } } : {};

  // 본부는 대시보드·출퇴근 현황 숫자 칸과 같은 범위(R10 검증 2) — 통계 제외 지점(테스트·본부)·휴지통·퇴사일 지난 사람은 뺀다
  const excludedBranches = session.role === "ADMIN"
    ? (await prisma.branch.findMany({ where: { countInStats: false }, select: { name: true } })).map((b) => b.name)
    : [];
  // 테스트 계정은 뺀다(■0-9) — 보는 사람이 테스트 계정이거나 담당 지점이 모두 테스트지점이면 넣는다(board 와 같은 showTestRows, 10/23 검증 M3)
  const withTests = await showTestRows(session, { branches: session.role === "MANAGER" ? myBranches : null });
  const records = await prisma.attendance.findMany({
    where: {
      date: today,
      clockIn: { not: null }, // 출근 찍은 직원만
      user: {
        role: { not: "ADMIN" }, isActive: true, deletedAt: null, ...branchWhere,
        ...(withTests ? {} : { NOT: await testAccountWhere() }),
        AND: [
          { OR: [{ resignDate: null }, { resignDate: { gte: today } }] },
          ...(excludedBranches.length ? [{ OR: [{ branch: null }, { branch: { notIn: excludedBranches } }] }] : []),
        ],
      },
    },
    include: {
      user: { select: { id: true, name: true, branch: true, jobGroup: true, position: true } },
    },
    orderBy: { clockIn: "asc" },
  });

  // 찍은 시각 · 일한 시간은 본부만(■0-11) — 원장(「출퇴근 시각 보기」 끔)에게는 상태와 찍었는지만. 순서도 시각 대신 이름
  const { canSeeClockTimes, maskClock } = await import("@/lib/attendance-visibility");
  const showTimes = await canSeeClockTimes(session.role);
  if (!showTimes) records.sort((a, b) => a.user.name.localeCompare(b.user.name, "ko"));
  const list = records.map((r) => maskClock({
    id: r.id,
    userId: r.userId,
    name: r.user.name,
    branch: r.user.branch,
    jobGroup: r.user.jobGroup,
    position: r.user.position,
    status: r.status,
    clockIn: r.clockIn,
    clockOut: r.clockOut,
    clockInPlace: r.clockInPlace,    // 출근·퇴근 장소(2026-10-07 #36)
    clockOutPlace: r.clockOutPlace,
    minutes: showTimes && r.clockIn && r.clockOut
      ? Math.round((r.clockOut.getTime() - r.clockIn.getTime()) / 60000)
      : 0,
  }, showTimes));

  return NextResponse.json({ date: today.toISOString().slice(0, 10), records: list, timesHidden: !showTimes });
}
