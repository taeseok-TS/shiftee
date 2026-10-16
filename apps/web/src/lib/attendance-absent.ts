import { prisma } from "@/lib/db";

// 「미출근」 공용 기준 (2026-10-16 #219-3, 이예지 QA)
//
// 미출근 = 그날 **근무일정(WORK)이 있는** 사람 중
//   · 출근 기록이 없고
//   · 출근 요청(지점 밖·사진·본부 출근)도 승인 대기 중이 아니고   ← 봇 출근 알림(lib/attendance-alerts)과 같은 규칙
//   · 승인된 휴가도 아닌 사람.
// 휴무(OFF)·공휴일(HOLIDAY) 일정이거나 일정이 없는 사람은 미출근이 아니다.
//
// ⚠ 종전 관리자 대시보드는 「재직자 − 출근 − 휴가」라, 일정이 하나도 없는 10/16 14시에
//   「미출근 115 · 관리 알림 115」가 떴다. 원장 대시보드는 휴무·공휴일만 뺐다(일정 없음 = 근무로 봄).
//   두 대시보드가 이 함수 하나를 쓴다.

/** day = @db.Date 규칙의 UTC 자정(kstTodayDateUTC()). userIds 중 미출근인 사람 id */
export async function absentUserIds(userIds: string[], day: Date): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const [scheduled, atts, pendIn, leaves] = await Promise.all([
    // 퇴사일이 그날보다 앞인 사람(퇴사일 당일은 재직 — lib/resign isResigned 와 같은 규칙)·입사일이 그날보다 뒤인 사람은 뺀다
    // (2026-10-17 #219 검증 F3 — 부르는 쪽 인원 조건과 따로 여기서도 막는다)
    prisma.schedule.findMany({
      where: {
        date: day, userId: { in: userIds }, type: "WORK",
        user: { AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: day } }] }, { OR: [{ hireDate: null }, { hireDate: { lte: day } }] }] },
      },
      select: { userId: true },
    }),
    prisma.attendance.findMany({ where: { date: day, userId: { in: userIds }, clockIn: { not: null } }, select: { userId: true } }),
    prisma.attendanceRequest.findMany({ where: { workDate: day, userId: { in: userIds }, action: "IN", status: "PENDING" }, select: { userId: true } }),
    prisma.leaveRequest.findMany({
      where: { userId: { in: userIds }, status: "APPROVED", startDate: { lte: day }, endDate: { gte: day } },
      select: { userId: true },
    }),
  ]);
  const came = new Set([...atts, ...pendIn].map((r) => r.userId));
  const onLeave = new Set(leaves.map((l) => l.userId));
  return new Set(scheduled.map((s) => s.userId).filter((id) => !came.has(id) && !onLeave.has(id)));
}
