import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eachDayOfInterval, getDay, format, differenceInDays } from "date-fns";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = await request.json();
  const { userIds, startDate, endDate, weekdays, startTime, endTime, type, note } = body;

  if (!userIds?.length || !startDate || !endDate || !weekdays?.length || !startTime || !endTime) {
    return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
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

  await prisma.$transaction(async (tx) => {
    // 기존 일정 삭제 (중복 방지)
    await tx.schedule.deleteMany({
      where: {
        userId: { in: userIds as string[] },
        date: { in: dateList },
      },
    });

    // 새 일정 일괄 생성
    await tx.schedule.createMany({
      data: (userIds as string[]).flatMap(userId =>
        dateList.map(date => ({
          userId,
          date,
          startTime,
          endTime,
          type: type || "WORK",
          note: note || null,
        }))
      ),
    });
  });

  return NextResponse.json({
    success: true,
    count: (userIds as string[]).length * dateList.length,
    days: dateList.length,
  });
}
