import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eachDayOfInterval, format, startOfDay } from "date-fns";
import { getManagerBranches } from "@/lib/manager-branches";
import { countableEmployeeWhere } from "@/lib/employee-scope";
import { isRealDate, toMin } from "@/lib/schedule-payload";
import { kstTodayMidnight } from "@/lib/resign";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  // 기본값은 **KST 기준 이번 달**이다. 서버가 UTC 라 그냥 new Date() 를 쓰면
  // KST 오전 9시 이전에 파라미터 없이 부를 때 전날(= 지난달일 수 있음) 기준이 된다.
  const kstNow = kstTodayMidnight();
  const yearRaw  = parseInt(searchParams.get("year")  || String(kstNow.getUTCFullYear()));
  const monthRaw = parseInt(searchParams.get("month") || String(kstNow.getUTCMonth() + 1));
  // 잘못된 값을 조용히 이번 달로 바꿔치기하지 않는다 — 부르는 쪽이 틀린 줄 모르고
  // 엉뚱한 달을 받아 간다. 500 은 안 나야 하지만, 틀렸으면 틀렸다고 알려준다.
  if (!Number.isInteger(yearRaw) || yearRaw < 2000 || yearRaw > 2100 ||
      !Number.isInteger(monthRaw) || monthRaw < 1 || monthRaw > 12) {
    return NextResponse.json({ error: "연월이 올바르지 않습니다." }, { status: 400 });
  }
  const year = yearRaw;
  const month = monthRaw;

  // start/end(yyyy-MM-dd) 지정 시 해당 기간, 없으면 해당 월
  // ⚠ 형식이 어긋나면 Invalid Date 가 그대로 prisma 쿼리에 들어가 미처리 500 이 된다.
  const startParam = searchParams.get("start");
  const endParam   = searchParams.get("end");
  if ((startParam && !isRealDate(startParam)) || (endParam && !isRealDate(endParam))) {
    return NextResponse.json({ error: "기간 형식이 올바르지 않습니다. (YYYY-MM-DD)" }, { status: 400 });
  }

  const startDate = startParam ? startOfDay(new Date(startParam)) : new Date(year, month - 1, 1);
  const endDate   = endParam
    ? new Date(new Date(endParam).setHours(23, 59, 59, 999))
    : new Date(year, month, 0, 23, 59, 59, 999);
  // 기간 상한 — 한 번에 2년치를 넘겨 조회하면 응답이 수천 일로 부풀어 오른다.
  if (endDate < startDate) {
    return NextResponse.json({ error: "시작일이 종료일보다 늦습니다." }, { status: 400 });
  }
  if ((endDate.getTime() - startDate.getTime()) / 86400000 > 750) {
    return NextResponse.json({ error: "조회 기간은 2년까지 가능합니다." }, { status: 400 });
  }

  // 본인 일정만 조회: EMPLOYEE는 항상, 그 외 역할은 scope=self 요청 시
  const selfOnly = session.role === "EMPLOYEE" || searchParams.get("scope") === "self";

  // 지점 필터 (MANAGER는 담당 지점 — 대표+겸직)
  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const branchUserWhere = session.role === "MANAGER" ? { branch: { in: myBranches } } : {};

  // 집계 대상 = 지점 근무 직원만 (관리자 + "통계 포함" 꺼진 지점 제외)
  const countableUserWhere = await countableEmployeeWhere(
    session.role === "MANAGER" ? { branches: myBranches } : {}
  );

  // 지점 내 활성 직원 ID 목록 (집계 기준)
  const branchUserIds = !selfOnly && session.role === "MANAGER"
    ? (await prisma.user.findMany({ where: countableUserWhere, select: { id: true } })).map(u => u.id)
    : null; // null = 전체

  const userIdFilter = selfOnly
    ? { userId: session.userId }
    : branchUserIds ? { userId: { in: branchUserIds } } : {};

  // 병렬 조회: 일정 / 출퇴근 / 승인된 휴가 / 전체 직원 수
  const [schedules, attendances, leaves, totalEmployees] = await Promise.all([
    prisma.schedule.findMany({
      where: { date: { gte: startDate, lte: endDate }, ...userIdFilter },
      select: {
        id: true, userId: true, date: true, type: true,
        startTime: true, endTime: true, note: true,
        user: { select: { branch: true } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: startDate, lte: endDate }, ...userIdFilter },
      select: { userId: true, date: true, status: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        startDate: { lte: endDate },
        endDate: { gte: startDate },
        ...userIdFilter,
      },
      select: { userId: true, startDate: true, endDate: true },
    }),
    selfOnly
      ? Promise.resolve(1)
      : prisma.user.count({ where: countableUserWhere }),
  ]);

  // 날짜별 집계
  const days = eachDayOfInterval({
    start: startDate,
    end: endParam ? startOfDay(new Date(endParam)) : new Date(year, month, 0),
  });

  const monthData = days.map(day => {
    const dayStr  = format(day, "yyyy-MM-dd");
    const dayMidnight = startOfDay(day);

    const daySched = schedules.filter(s => format(new Date(s.date), "yyyy-MM-dd") === dayStr);
    const dayAtt   = attendances.filter(a => format(new Date(a.date), "yyyy-MM-dd") === dayStr);
    const dayLeave = leaves.filter(l => {
      const ls = startOfDay(new Date(l.startDate));
      const le = startOfDay(new Date(l.endDate));
      return ls <= dayMidnight && le >= dayMidnight;
    });

    const ct = (type: string)   => daySched.filter(s => s.type === type).length;
    const cs = (status: string) => dayAtt.filter(a => a.status === status).length;

    return {
      date:       dayStr,
      work:       ct("WORK"),
      off:        ct("OFF"),
      holiday:    ct("HOLIDAY"),
      checkedIn:  dayAtt.filter(a => a.status !== "ABSENT").length,
      late:       cs("LATE"),
      earlyLeave: cs("EARLY_LEAVE"),
      absent:     cs("ABSENT"),
      leave:      dayLeave.length,
    };
  });

  // 개별 일정 목록 (주간 캘린더용)
  const scheduleList = schedules.map(s => ({
    id: s.id,
    userId: s.userId,
    date: format(new Date(s.date), "yyyy-MM-dd"),
    startTime: s.startTime,
    endTime: s.endTime,
    type: s.type.toLowerCase(),
    note: s.note,
    branch: s.user?.branch ?? null,
  }));

  return NextResponse.json({ monthData, totalEmployees, schedules: scheduleList });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { userId, date, startTime, endTime, type, note } = await request.json();

  if (!userId || !date || !startTime || !endTime) {
    return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
  }

  // 원장은 본인 일정을 직접 못 만들고(관리자 승인 필요), 담당 지점 직원만 다룬다.
  const { guardScheduleChange } = await import("@/lib/schedule-guard");
  const denied = await guardScheduleChange(session, userId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (!isRealDate(date)) {
    return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)" }, { status: 400 });
  }
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!TIME_RE.test(String(startTime)) || !TIME_RE.test(String(endTime))) {
    return NextResponse.json({ error: "근무 시간 형식이 올바르지 않습니다. 예: 09:00" }, { status: 400 });
  }
  if (toMin(String(endTime)) <= toMin(String(startTime))) {
    return NextResponse.json({ error: "종료 시간이 시작 시간보다 빠릅니다." }, { status: 400 });
  }
  if (toMin(String(endTime)) - toMin(String(startTime)) > 12 * 60) {
    return NextResponse.json({ error: "하루 근무는 12시간을 넘을 수 없습니다." }, { status: 400 });
  }

  const [yy, mm, dd] = date.split("-").map(Number);
  const dateUtc = new Date(Date.UTC(yy, mm - 1, dd));   // @db.Date 는 UTC 자정 저장

  // 같은 사람.같은 날은 하나뿐이므로 **복합 유니크로 upsert** 한다.
  // 종전에는 findFirst 로 찾아 id 로 upsert 했는데, 두 요청이 동시에 오면 둘 다
  // "없음"을 보고 각자 생성해 중복이 생길 수 있었다(2026-09-08 검증에서 적발).
  const schedule = await prisma.schedule.upsert({
    where: { userId_date: { userId, date: dateUtc } },
    create: { userId, date: dateUtc, startTime, endTime, type: type || "WORK", note },
    update: { startTime, endTime, type: type || "WORK", note },
  });

  return NextResponse.json({ success: true, schedule });
}
