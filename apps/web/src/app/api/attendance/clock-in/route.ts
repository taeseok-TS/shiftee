import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { haversineDistance } from "@/lib/geofence";
import { verifyAttendanceDevice } from "@/lib/device";
import { kstHour, kstMinute } from "@/lib/kst";
import { isHoliday, kstTodayYmd } from "@/lib/holidays";
import { getManagerBranches } from "@/lib/manager-branches";
import type { Attendance } from "@shiftee/api";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // 기기 검증: 비관리자는 등록된 본인 휴대폰 앱에서만 출근 가능 (대리 출근 방지)
  const deviceError = await verifyAttendanceDevice(session.userId, session.role, request.headers.get("x-device-id"));
  if (deviceError) return NextResponse.json({ error: deviceError }, { status: 403 });

  // 주말(토·일, KST 기준) 출근은 사전 승인된 근무일정이 있어야 가능 (서버 TZ는 UTC이므로 +9h로 KST 계산)
  if (session.role !== "ADMIN") {
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const kstDay = kstNow.getUTCDay(); // 0=일, 6=토
    if (kstDay === 0 || kstDay === 6) {
      const schedDate = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()));
      const weekendSchedule = await prisma.schedule.findFirst({
        where: { userId: session.userId, date: schedDate, type: "WORK" },
      });
      if (!weekendSchedule) {
        return NextResponse.json(
          { error: "주말 근무는 사전에 근무일정을 신청하고 승인받은 후에만 출근할 수 있습니다." },
          { status: 403 }
        );
      }
    }
  }

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
  // 지점명은 세션(토큰 박제)이 아닌 DB 기준. 원장은 담당 지점(대표+겸직) 어디서든 출근 인정
  if (session.role !== "ADMIN") {
    const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { branch: true } });
    const names = session.role === "MANAGER"
      ? await getManagerBranches(session.userId)
      : me?.branch ? [me.branch] : [];
    const geoBranches = names.length > 0
      ? (await prisma.branch.findMany({ where: { name: { in: names }, isActive: true } }))
          .filter((b) => b.latitude != null && b.longitude != null)
      : [];

    if (geoBranches.length > 0) {
      // 위치 정보 없으면 거부
      if (latitude == null || longitude == null) {
        return NextResponse.json(
          { error: "위치 정보가 필요합니다. GPS를 허용해주세요.", needsLocation: true },
          { status: 400 }
        );
      }
      // 담당 지점 중 한 곳이라도 반경 안이면 통과, 전부 밖이면 가장 가까운 지점 기준으로 안내
      let nearest: { dist: number; radius: number } | null = null;
      let inside = false;
      for (const b of geoBranches) {
        const dist = haversineDistance(latitude, longitude, b.latitude!, b.longitude!);
        if (dist <= b.radius) { inside = true; break; }
        if (!nearest || dist < nearest.dist) nearest = { dist, radius: b.radius };
      }
      if (!inside && nearest) {
        return NextResponse.json(
          {
            error: `출퇴근 지역을 벗어나셨습니다.\n현재 위치: ${Math.round(nearest.dist)}m / 허용 반경: ${nearest.radius}m`,
            distance: Math.round(nearest.dist),
            radius: nearest.radius,
            outsideGeofence: true,
          },
          { status: 403 }
        );
      }
    }
  }

  const now = new Date();
  // 지각 판정은 한국시간 기준 (서버 TZ는 UTC). 공휴일에는 지각 판정 안 함
  const holiday = await isHoliday(kstTodayYmd());
  const isLate = !holiday && (kstHour(now) > 9 || (kstHour(now) === 9 && kstMinute(now) > 0));

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
