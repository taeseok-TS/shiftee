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

  if (!existing?.clockIn) {
    return NextResponse.json({ error: "출근 기록이 없습니다." }, { status: 400 });
  }
  if (existing.clockOut) {
    return NextResponse.json({ error: "이미 퇴근 처리가 되어 있습니다." }, { status: 400 });
  }

  const now = new Date();
  const body = await request.json().catch(() => ({}));

  // 18시 이전이면 조기퇴근
  const isEarlyLeave = now.getHours() < 18;
  const status = existing.status === "LATE"
    ? (isEarlyLeave ? "EARLY_LEAVE" : "LATE")
    : (isEarlyLeave ? "EARLY_LEAVE" : "NORMAL");

  const attendance = await prisma.attendance.update({
    where: { id: existing.id },
    data: {
      clockOut: now,
      status,
      latitude: body.latitude ?? existing.latitude,
      longitude: body.longitude ?? existing.longitude,
    },
  });

  return NextResponse.json({ success: true, attendance });
}
