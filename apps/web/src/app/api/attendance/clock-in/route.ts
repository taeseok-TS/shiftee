import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { judgeGeofence, logGeofenceAttempt, parseAccuracy } from "@/lib/geofence-log";
import { verifyAttendanceDevice } from "@/lib/device";
import { kstTodayDateUTC } from "@/lib/kst";
import { isHoliday, kstTodayYmd } from "@/lib/holidays";
import { getManagerBranches } from "@/lib/manager-branches";
import type { Attendance } from "@shiftee/api";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // 기기 검증: 비관리자는 등록된 본인 휴대폰 앱에서만 출근 가능 (대리 출근 방지)
  const deviceError = await verifyAttendanceDevice(session.userId, session.role, request.headers.get("x-device-id"));
  if (deviceError) return NextResponse.json({ error: deviceError }, { status: 403 });

  // 휴일(토·일 또는 공휴일, KST 기준) 출근은 사전 승인된 근무일정이 있어야 가능
  // (서버 TZ는 UTC이므로 +9h로 KST 계산)
  if (session.role !== "ADMIN") {
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const kstDay = kstNow.getUTCDay(); // 0=일, 6=토
    // 공휴일도 주말과 동일 규칙 — 연휴 근무는 사전 승인이 있어야 한다
    const isHolidayToday = await isHoliday(kstTodayYmd());
    if (kstDay === 0 || kstDay === 6 || isHolidayToday) {
      const schedDate = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()));
      const weekendSchedule = await prisma.schedule.findFirst({
        where: { userId: session.userId, date: schedDate, type: "WORK" },
      });
      if (!weekendSchedule) {
        const kind = kstDay === 0 || kstDay === 6 ? "주말" : "공휴일";
        return NextResponse.json(
          { error: `${kind} 근무는 사전에 근무일정을 신청하고 승인받은 후에만 출근할 수 있습니다.` },
          { status: 403 }
        );
      }
    }
  }

  // 오늘(KST) 날짜를 @db.Date 용 UTC 자정으로 (kst.ts 참고 — 컨테이너 TZ 가 UTC 라
  // Date.UTC(now.getFullYear(), ...) 를 쓰면 하루 경계가 09:00 KST 가 된다)
  const today = kstTodayDateUTC();

  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId: session.userId, date: today } },
  });
  if (existing?.clockIn) {
    return NextResponse.json({ error: "이미 출근 처리가 되어 있습니다." }, { status: 400 });
  }
  // 지점 밖·사진·본부 출근 요청이 승인 대기 중이면 버튼 출근은 받지 않는다 — 승인 때 「이미 출근」으로 부딪힌다
  const pendingIn = await prisma.attendanceRequest.findFirst({
    where: { userId: session.userId, workDate: today, action: "IN", status: "PENDING" }, select: { id: true },
  });
  if (pendingIn) {
    return NextResponse.json({ error: "출근 요청이 승인을 기다리고 있습니다. 바로 출근하려면 출퇴근 화면에서 요청을 취소한 뒤 다시 눌러 주세요." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const { latitude, longitude } = body;
  const accuracy = parseAccuracy(body.accuracy);   // 폰 위치 오차(m) — 옛 앱은 안 보낸다(null)

  // 출근 장소(2026-10-07 #36) — 반경 안에 든 지점명. 위치 확인을 안 하는 경우(관리자·좌표 없는 지점)는 소속 지점명
  let place: string | null = null;

  // ADMIN 외에는 지점 지오펜스 적용
  // 지점명은 세션(토큰 박제)이 아닌 DB 기준. 원장은 담당 지점(대표+겸직) 어디서든 출근 인정
  if (session.role !== "ADMIN") {
    const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { branch: true } });
    place = me?.branch ?? null;
    const names = session.role === "MANAGER"
      ? await getManagerBranches(session.userId)
      : me?.branch ? [me.branch] : [];
    const geoBranches = names.length > 0
      ? (await prisma.branch.findMany({ where: { name: { in: names }, isActive: true } }))
          .filter((b) => b.latitude != null && b.longitude != null)
      : [];

    if (geoBranches.length > 0) {
      // 위치 정보 없으면 거부 — 시도는 남긴다(2026-10-27 이예지 「지점 밖 판정」 조사, lib/geofence-log)
      if (latitude == null || longitude == null) {
        logGeofenceAttempt({ userId: session.userId, action: "IN", latitude: null, longitude: null, accuracy, verdict: null, result: "NO_LOCATION", headers: request.headers });
        return NextResponse.json(
          { error: "위치 정보가 필요합니다. GPS를 허용해주세요.", needsLocation: true },
          { status: 400 }
        );
      }
      // 담당 지점 중 한 곳이라도 반경 안이면 통과, 전부 밖이면 가장 가까운 지점 기준으로 안내 — 판정은 공용 함수(judgeGeofence), 매 시도 기록
      const verdict = judgeGeofence(latitude, longitude, geoBranches);
      logGeofenceAttempt({ userId: session.userId, action: "IN", latitude, longitude, accuracy, verdict, result: verdict.inside ? "OK" : "OUTSIDE", headers: request.headers });
      if (verdict.inside) {
        place = verdict.branch;   // 장소 = 반경 안에 든 지점(#36)
      } else if (verdict.distance != null) {
        return NextResponse.json(
          {
            error: `출퇴근 지역을 벗어나셨습니다.\n현재 위치: ${verdict.distance}m / 허용 반경: ${verdict.radius}m`,
            distance: verdict.distance,
            radius: verdict.radius,
            accuracy,   // 앱이 「위치 오차 약 ○m」 안내에 쓴다
            outsideGeofence: true,
          },
          { status: 403 }
        );
      }
    }
  }

  const now = new Date();
  // 지각 판정은 **본인이 승인받은 근무일정 시작 시각** 기준 (2026-09-07 디렉터 지시).
  // 종전에는 09:00 하드코딩이라 오후 1시 출근이 정상인 근무자가 매일 지각으로 찍혔다.
  // 근무일정이 없는 날은 지각 판정을 하지 않는다(2026-10-16 #219-2, 본부 10/7 답변 12번 — 종전 09:00 기본값).
  // 공휴일에도 판정하지 않는다.
  const holiday = await isHoliday(kstTodayYmd());
  const { workWindowFor, isLateAt } = await import("@/lib/attendance-status");
  const { startMin } = await workWindowFor(session.userId, kstTodayYmd());
  const isLate = !holiday && isLateAt(now, startMin);

  const attendance = await prisma.attendance.upsert({
    where: { userId_date: { userId: session.userId, date: today } },
    create: {
      userId: session.userId,
      date: today,
      clockIn: now,
      status: isLate ? "LATE" : "NORMAL",
      latitude,
      longitude,
      clockInPlace: place,
    },
    update: {
      clockIn: now,
      status: isLate ? "LATE" : "NORMAL",
      latitude,
      longitude,
      clockInPlace: place,
    },
  });

  // 찍은 시각은 본부만(■0-11) — 응답에도 찍었는지만
  const { canSeeClockTimes, maskClock } = await import("@/lib/attendance-visibility");
  return NextResponse.json({ success: true, attendance: maskClock(attendance, await canSeeClockTimes(session.role)) });
}
