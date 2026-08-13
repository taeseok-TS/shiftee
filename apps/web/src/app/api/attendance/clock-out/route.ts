import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { haversineDistance } from "@/lib/geofence";
import { verifyAttendanceDevice } from "@/lib/device";
import { kstHour } from "@/lib/kst";
import { isHoliday, kstTodayYmd } from "@/lib/holidays";
import { getManagerBranches } from "@/lib/manager-branches";
import type { Attendance } from "@shiftee/api";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // 기기 검증: 비관리자는 등록된 본인 휴대폰 앱에서만 퇴근 가능 (대리 퇴근 방지)
  const deviceError = await verifyAttendanceDevice(session.userId, session.role, request.headers.get("x-device-id"));
  if (deviceError) return NextResponse.json({ error: deviceError }, { status: 403 });

  // 오늘 날짜를 UTC 자정으로 조회 (clock-in과 동일 규칙, @db.Date 시간대 문제 방지)
  const nowDate = new Date();
  const today = new Date(Date.UTC(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()));

  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId: session.userId, date: today } },
  });
  if (!existing?.clockIn) {
    return NextResponse.json({ error: "출근 기록이 없습니다." }, { status: 400 });
  }
  if (existing.clockOut) {
    return NextResponse.json({ error: "이미 퇴근 처리가 되어 있습니다." }, { status: 400 });
  }

  // 퇴근 시간 상한 (주 52시간 리스크 방지) — 초과 시 앱 퇴근 차단, 관리자가 수동 처리
  // 평일: 출근 후 10시간 30분까지. 주말: 승인 근무시간 + 휴게 30분 + 조기출근 여유 15분까지.
  if (session.role !== "ADMIN") {
    const elapsedMs = Date.now() - existing.clockIn.getTime();
    const kstIn = new Date(existing.clockIn.getTime() + 9 * 60 * 60 * 1000); // 출근 시각의 KST
    const kstDay = kstIn.getUTCDay(); // 0=일, 6=토
    let capMs = 10.5 * 60 * 60 * 1000;
    if (kstDay === 0 || kstDay === 6) {
      const schedDate = new Date(Date.UTC(kstIn.getUTCFullYear(), kstIn.getUTCMonth(), kstIn.getUTCDate()));
      const sched = await prisma.schedule.findFirst({
        where: { userId: session.userId, date: schedDate, type: "WORK" },
      });
      if (sched) {
        const [sh, sm] = sched.startTime.split(":").map(Number);
        const [eh, em] = sched.endTime.split(":").map(Number);
        const workMin = eh * 60 + em - (sh * 60 + sm);
        if (workMin > 0) {
          const capMin = workMin + 30 + 15; // 승인 근무시간 + 휴게 30분 + 조기출근 여유 15분
          capMs = capMin * 60 * 1000;
        }
      }
    }
    if (elapsedMs > capMs) {
      return NextResponse.json({ error: "관리자에게 문의해주세요." }, { status: 403 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const { latitude, longitude } = body;

  // ADMIN 외에는 지점 지오펜스 적용
  // 지점명은 세션(토큰 박제)이 아닌 DB 기준. 원장은 담당 지점(대표+겸직) 어디서든 퇴근 인정 (clock-in과 동일 규칙)
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
      if (latitude == null || longitude == null) {
        return NextResponse.json(
          { error: "위치 정보가 필요합니다. GPS를 허용해주세요.", needsLocation: true },
          { status: 400 }
        );
      }
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
  // 조퇴 판정은 한국시간 기준 (UTC getHours를 쓰면 KST 새벽 3시까지 조퇴로 찍히던 버그). 공휴일에는 조퇴 판정 안 함
  const holiday = await isHoliday(kstTodayYmd());
  const isEarlyLeave = !holiday && kstHour(now) < 18;
  const status = existing.status === "LATE"
    ? (isEarlyLeave ? "EARLY_LEAVE" : "LATE")
    : (isEarlyLeave ? "EARLY_LEAVE" : "NORMAL");

  const attendance = await prisma.attendance.update({
    where: { id: existing.id },
    data: {
      clockOut: now,
      status,
      latitude: latitude ?? existing.latitude,
      longitude: longitude ?? existing.longitude,
    },
  });

  return NextResponse.json({ success: true, attendance });
}
