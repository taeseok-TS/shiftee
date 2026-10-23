import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isRealDate } from "@/lib/schedule-payload";
import { prisma } from "@/lib/db";
import { startOfDay, endOfDay } from "date-fns";
import { getManagerBranches } from "@/lib/manager-branches";
import { countableEmployeeWhere } from "@/lib/employee-scope";
import { isAllowed } from "@/lib/permission-settings";
import { kstHour, kstMinute } from "@/lib/kst";
import { canSeeClockTimes } from "@/lib/attendance-visibility";

// 출퇴근 시각은 한국 시각으로 — 서버는 UTC 라 format(…, "HH:mm") 이 9시간 이르게 보였다(2026-10-06 QA 조사)
const kstHHmm = (d: Date) => `${String(kstHour(d)).padStart(2, "0")}:${String(kstMinute(d)).padStart(2, "0")}`;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateStr = searchParams.get("date");
  if (!dateStr) return NextResponse.json({ error: "날짜가 필요합니다." }, { status: 400 });
  // Invalid Date 가 그대로 prisma 쿼리에 들어가면 미처리 500 이 된다(2026-09-08 적발).
  if (!isRealDate(dateStr)) return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)" }, { status: 400 });

  const date    = new Date(dateStr);
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  // 본인 정보만 조회: EMPLOYEE는 항상, 그 외 역할은 scope=self 요청 시
  const selfOnly = session.role === "EMPLOYEE" || searchParams.get("scope") === "self";
  // 본부가 「원장 지점 출퇴근 기록 열람」을 끄면(권한 설정 #39) 원장에게는 출퇴근 시각·상태를 섞지 않는다 — 일정·휴가만(10/14 검증 1)
  // 직원은 「본인 출퇴근 기록 열람」(기본 끔)이 꺼져 있으면 출근·퇴근 시각·지각 상태를 섞지 않는다 — 일정·휴가만(2026-10-16 #219-14)
  // 2026-10-23 ■0-11: 직원 본인 상태(출근 · 지각 · 퇴근)는 늘 섞는다 — 시각은 아래 showTimes 로 늘 빠지므로, 「본인 출퇴근 기록 열람(웹)」은 웹 메뉴만 정한다
  const hideAtt = session.role === "MANAGER" && !selfOnly && !(await isAllowed("manager.viewAttendance"));

  // 찍은 시각은 본부만(2026-10-23 ■0-11) — 직원 · 원장(「출퇴근 시각 보기」 끔)에게는 상태와 찍었는지(clockedIn · clockedOut)만
  const showTimes = await canSeeClockTimes(session.role);

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  // 현황 명단 = 지점 근무 직원만 (관리자 + "통계 포함" 꺼진 지점 제외)
  // 입사일 기준은 이 날짜 — 입사 예정자도 그날 이미 입사했으면 일정이 보이게(10/23 검증 H2, 기본은 오늘이라 앞날 일정에서 빠졌다)
  const userWhere   = selfOnly
    ? { id: session.userId }
    : await countableEmployeeWhere({ ...(session.role === "MANAGER" ? { branches: myBranches } : {}), hiredBy: dayEnd });
  const recordWhere = selfOnly ? { userId: session.userId } : {};

  const [employees, schedules, attendances, leaves] = await Promise.all([
    prisma.user.findMany({
      where: userWhere,
      select: { id: true, name: true, department: true, position: true, branch: true, phone: true },
      orderBy: [{ department: "asc" }, { name: "asc" }],
    }),
    prisma.schedule.findMany({
      where: { date: { gte: dayStart, lte: dayEnd }, ...recordWhere },
      select: { id: true, userId: true, type: true, startTime: true, endTime: true, note: true },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: dayStart, lte: dayEnd }, ...recordWhere, ...(hideAtt ? { userId: "" } : {}) },   // 열람이 꺼지면 아무 기록도 안 읽는다
      select: { id: true, userId: true, clockIn: true, clockOut: true, status: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        startDate: { lte: dayEnd },
        endDate: { gte: dayStart },
        ...recordWhere,
      },
      select: { id: true, userId: true, type: true },
    }),
  ]);

  const schedMap = new Map(schedules.map(s  => [s.userId, s] as const));
  const attMap   = new Map(attendances.map(a => [a.userId, a] as const));
  const leaveMap = new Map(leaves.map(l     => [l.userId, l] as const));

  const result = employees.map(emp => {
    const sched = schedMap.get(emp.id) as typeof schedules[number] | undefined ?? null;
    const att   = attMap.get(emp.id) as typeof attendances[number] | undefined ?? null;
    const leave = leaveMap.get(emp.id) as typeof leaves[number] | undefined ?? null;

    // 종합 상태 결정
    let status: string;
    if (leave)                           status = "LEAVE";
    else if (!sched)                     status = "NO_SCHEDULE";
    else if (sched.type === "OFF")       status = "OFF";
    else if (sched.type === "HOLIDAY")   status = "HOLIDAY";
    else if (hideAtt)                    status = "WORK";              // 출퇴근 열람이 꺼짐 — 「미등록」이라 하지 않고 근무 예정만(#219-14)
    else if (att)                        status = att.status;          // NORMAL/LATE/EARLY_LEAVE/ABSENT
    else                                 status = "NOT_YET";           // 근무 예정이나 미입력

    return {
      id:          emp.id,
      name:        emp.name,
      department:  emp.department ?? "-",
      position:    emp.position   ?? "-",
      branch:      emp.branch     ?? null,
      scheduleId:  sched?.id      ?? null,
      scheduleType: sched?.type   ?? null,
      startTime:   sched?.startTime ?? null,
      endTime:     sched?.endTime   ?? null,
      note:        sched?.note      ?? null,
      clockIn:     showTimes && att?.clockIn  ? kstHHmm(new Date(att.clockIn))  : null,
      clockOut:    showTimes && att?.clockOut ? kstHHmm(new Date(att.clockOut)) : null,
      clockedIn:   !!att?.clockIn,
      clockedOut:  !!att?.clockOut,
      hasClockIn:  !!att?.clockIn,    // 앱이 읽는 이름(clockedIn 과 같다)
      hasClockOut: !!att?.clockOut,
      // 미출근 「전화」 버튼용 — 원장 · 본부가 지점 현황을 볼 때만(본인 줄만 보는 직원 · scope=self 에는 싣지 않는다)
      phone:       !selfOnly && (session.role === "MANAGER" || session.role === "ADMIN") ? emp.phone ?? null : null,
      leaveType:   leave?.type   ?? null,
      status,
    };
  });

  // 요약 집계
  const summary = {
    total:       result.length,
    checkedIn:   result.filter(r => ["NORMAL","LATE","EARLY_LEAVE"].includes(r.status)).length,
    late:        result.filter(r => r.status === "LATE").length,
    earlyLeave:  result.filter(r => r.status === "EARLY_LEAVE").length,
    absent:      result.filter(r => r.status === "ABSENT").length,
    leave:       result.filter(r => r.status === "LEAVE").length,
    notYet:      result.filter(r => r.status === "NOT_YET").length,
    off:         result.filter(r => ["OFF","NO_SCHEDULE"].includes(r.status)).length,
  };

  return NextResponse.json({ date: dateStr, employees: result, summary, attendanceHidden: hideAtt, timesHidden: !showTimes });
}
