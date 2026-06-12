import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { haversineDistance } from "@/lib/geofence";
import type { Attendance } from "@shiftee/api";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // 오늘 날짜를 UTC 자정으로 저장 (@db.Date 컬럼은 UTC 날짜만 보관하므로
  // 로컬 자정(KST 00:00 = 전날 15:00Z)을 쓰면 하루 전 날짜로 저장됨)
  const nowDate = new Date();
  const today = new Date(Date.UTC(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()));

  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId: session.userId, date: today } },
  });
  if (existing?.clockIn) {
    return NextResponse.json({ error: "이미 출근 처리가 되어 있습니다." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const { latitude, longitude } = body;

  // ADMIN 외에는 지점 지오펜스 적용
  if (session.role !== "ADMIN" && session.branch) {
    const branchData = await prisma.branch.findFirst({
      where: { name: session.branch, isActive: true },
    });

    if (branchData?.latitude != null && branchData?.longitude != null) {
      // 위치 정보 없으면 거부
      if (latitude == null || longitude == null) {
        return NextResponse.json(
          { error: "위치 정보가 필요합니다. GPS를 허용해주세요.", needsLocation: true },
          { status: 400 }
        );
      }
      const dist = haversineDistance(latitude, longitude, branchData.latitude, branchData.longitude);
      if (dist > branchData.radius) {
        return NextResponse.json(
          {
            error: `지점 반경 밖에서는 출근 처리가 불가합니다.\n현재 위치: ${Math.round(dist)}m / 허용 반경: ${branchData.radius}m`,
            distance: Math.round(dist),
            radius: branchData.radius,
            outsideGeofence: true,
          },
          { status: 403 }
        );
      }
    }
  }

  const now = new Date();
  const isLate = now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 0);

  const attendance = await prisma.attendance.upsert({
    where: { userId_date: { userId: session.userId, date: today } },
    create: {
      userId: session.userId,
      date: today,
      clockIn: now,
      status: isLate ? "LATE" : "NORMAL",
      latitude,
      longitude,
    },
    update: {
      clockIn: now,
      status: isLate ? "LATE" : "NORMAL",
      latitude,
      longitude,
    },
  });

  return NextResponse.json({ success: true, attendance });
}
