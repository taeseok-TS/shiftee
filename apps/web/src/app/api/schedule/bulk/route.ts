import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eachDayOfInterval, getDay, format, differenceInDays } from "date-fns";
import { guardScheduleChange } from "@/lib/schedule-guard";
import { getManagerBranches } from "@/lib/manager-branches";
import { isRealDate, toMin, asHhmm, asScheduleType } from "@/lib/schedule-payload";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = await request.json();
  const { userIds, startDate, endDate, weekdays, startTime, endTime, type, note } = body;

  if (!userIds?.length || !startDate || !endDate || !weekdays?.length || !startTime || !endTime) {
    return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
  }

  // ⚠ **대상 직원마다 권한을 확인한다.** 종전에는 "직원이 아니면 통과"만 보고
  //   대상 검사가 하나도 없어서, 원장이 임의 userIds 로 **본인.타지점 직원.다른 원장**의
  //   일정을 3개월치 덮어쓸 수 있었다(기존 일정을 먼저 지운다).
  //   개별 등록.수정.삭제에는 붙어 있던 가드가 여기만 빠져 있었다(2026-09-08 적발).
  const ids = [...new Set((userIds as unknown[]).filter((v): v is string => typeof v === "string" && v !== ""))];
  if (ids.length === 0) return NextResponse.json({ error: "직원을 선택해주세요." }, { status: 400 });
  if (ids.length > 200) return NextResponse.json({ error: "한 번에 200명까지 등록할 수 있습니다." }, { status: 400 });
  // 담당 지점은 **한 번만** 읽어 넘긴다(대상마다 다시 읽으면 쿼리가 대상 수만큼 늘어난다)
  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : undefined;
  for (const uid of ids) {
    const denied = await guardScheduleChange(session, uid, myBranches);
    if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  }

  // 날짜.시간 형식을 먼저 본다 — Invalid Date 가 그대로 쿼리에 들어가면 500 이 된다.
  if (!isRealDate(startDate) || !isRealDate(endDate)) {
    return NextResponse.json({ error: "기간이 올바르지 않습니다." }, { status: 400 });
  }
  // ⚠ 뒤집힌 기간을 막는다. 종전에는 시작.종료를 바꿔 보내면 differenceInDays 가 음수라
  //   93일 상한을 그대로 통과했고, eachDayOfInterval 은 예외 없이 역순 배열을 돌려줬다
  //   — 10년치도 만들 수 있었다(2026-09-08 적발).
  if (startDate > endDate) {
    return NextResponse.json({ error: "시작일이 종료일보다 늦습니다." }, { status: 400 });
  }
  const st = asHhmm(startTime), et = asHhmm(endTime);
  if (!st || !et) {
    return NextResponse.json({ error: "근무 시간 형식이 올바르지 않습니다. 예: 09:00" }, { status: 400 });
  }
  if (toMin(et) <= toMin(st)) {
    return NextResponse.json({ error: "종료 시간이 시작 시간보다 빠릅니다." }, { status: 400 });
  }
  if (toMin(et) - toMin(st) > 12 * 60) {
    return NextResponse.json({ error: "하루 근무는 12시간을 넘을 수 없습니다." }, { status: 400 });
  }
  const kind = asScheduleType(type);
  if (!kind) return NextResponse.json({ error: "근무 유형이 올바르지 않습니다." }, { status: 400 });
  if (!Array.isArray(weekdays)) {
    return NextResponse.json({ error: "요일 선택이 올바르지 않습니다." }, { status: 400 });
  }
  if (!(weekdays as unknown[]).every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)) {
    return NextResponse.json({ error: "요일 선택이 올바르지 않습니다." }, { status: 400 });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  // 최대 3개월(93일)까지만 허용
  if (differenceInDays(end, start) > 93) {
    return NextResponse.json({ error: "기간은 최대 3개월까지 설정할 수 있습니다." }, { status: 400 });
  }

  // 요일 필터링된 날짜 목록
  const days = eachDayOfInterval({ start, end }).filter(d =>
    (weekdays as number[]).includes(getDay(d))
  );

  if (days.length === 0) {
    return NextResponse.json({ error: "해당 기간에 선택한 요일이 없습니다." }, { status: 400 });
  }

  const dateList = days.map(d => new Date(format(d, "yyyy-MM-dd")));

  let created = 0;
  await prisma.$transaction(async (tx) => {
    // 기존 일정 삭제 (중복 방지)
    await tx.schedule.deleteMany({
      where: {
        userId: { in: ids },
        date: { in: dateList },
      },
    });

    // 새 일정 일괄 생성
    const made = await tx.schedule.createMany({
      data: ids.flatMap(userId =>
        dateList.map(date => ({
          userId,
          date,
          startTime: st,
          endTime: et,
          type: kind,
          note: typeof note === "string" ? note : null,
        }))
      ),
      // (userId, date) 유니크 제약이 있다. 두 요청이 겹치면 충돌로 트랜잭션이
      // 통째로 죽는 대신 건너뛴다 — 어차피 같은 날짜는 하나만 남으면 된다.
      skipDuplicates: true,
    });
    created = made.count; // skipDuplicates 로 건너뛴 것이 있으면 예상치보다 적다
  });

  return NextResponse.json({
    success: true,
    count: created,
    days: dateList.length,
  });
}
