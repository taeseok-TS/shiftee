import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId: session.userId, date: today } },
  });

  if (existing?.clockIn) {
    return NextResponse.json({ error: "이미 출근 처리가 되어 있습니다." }, { status: 400 });
  }

  const now = new Date();
  const body = await request.json().catch(() => ({}));

  // 9시 이후면 지각
  const isLate = now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 0);

  const attendance = await prisma.attendance.upsert({
    where: { userId_date: { userId: session.userId, date: today } },
    create: {
      userId: session.userId,
      date: today,
      clockIn: now,
      status: isLate ? "LATE" : "NORMAL",
      latitude: body.latitude,
      longitude: body.longitude,
    },
    update: {
      clockIn: now,
      status: isLate ? "LATE" : "NORMAL",
      latitude: body.latitude,
      longitude: body.longitude,
    },
  });

  return NextResponse.json({ success: true, attendance });
}
