import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
  const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const schedules = await prisma.schedule.findMany({
    where: {
      date: { gte: startDate, lte: endDate },
      ...(session.role === "EMPLOYEE" ? { userId: session.userId } : {}),
    },
    include: { user: { select: { name: true, department: true } } },
    orderBy: { date: "asc" },
  });

  return NextResponse.json({ schedules });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = await request.json();
  const { userId, date, startTime, endTime, type, note } = body;

  if (!userId || !date || !startTime || !endTime) {
    return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
  }

  const schedule = await prisma.schedule.upsert({
    where: {
      // 같은 날짜+직원의 일정이 있으면 업데이트
      id: (await prisma.schedule.findFirst({
        where: { userId, date: new Date(date) },
        select: { id: true },
      }))?.id ?? "new",
    },
    create: {
      userId,
      date: new Date(date),
      startTime,
      endTime,
      type: type || "WORK",
      note,
    },
    update: { startTime, endTime, type: type || "WORK", note },
  });

  return NextResponse.json({ success: true, schedule });
}
