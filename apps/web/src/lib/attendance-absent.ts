import { prisma } from "@/lib/db";
import { kstHour, kstMinute, kstTodayDateUTC } from "@/lib/kst";
import { trainingUserIds } from "@/lib/route-course-server";

// 「미출근」 공용 기준 (2026-10-16 #219-3, 이예지 QA)
//
// 미출근 = 그날 **근무일정(WORK)이 있는** 사람 중
//   · 출근 기록이 없고
//   · 출근 요청(지점 밖·사진·본부 출근)도 승인 대기 중이 아니고   ← 봇 출근 알림(lib/attendance-alerts)과 같은 규칙
//   · 승인된 휴가도 아닌 사람.
// 휴무(OFF)·공휴일(HOLIDAY) 일정이거나 일정이 없는 사람은 미출근이 아니다.
//
// 「출근 전」(2026-10-27 이예지 ①) — 오늘 기준으로 **근무 시작 시각이 아직 안 된** 사람은 미출근이 아니라 출근 전이다.
//   10/27 11:22 에 13:00 근무자 107명이 「미출근」으로 떠 원장 대시보드에 이름까지 나왔다. 시작 시각이 지나야 미출근.
//   지난 날은 시각이 다 지났으니 전부 미출근(종전과 같다).
// 「교육 중」(이예지 ②) — 입사일이 루트코스 입과일인 신입은 수료일까지 본사 교육이라 집계에서 통째로 뺀다(lib/route-course-server).
//
// ⚠ 종전 관리자 대시보드는 「재직자 − 출근 − 휴가」라, 일정이 하나도 없는 10/16 14시에
//   「미출근 115 · 관리 알림 115」가 떴다. 원장 대시보드는 휴무·공휴일만 뺐다(일정 없음 = 근무로 봄).
//   두 대시보드가 이 함수 하나를 쓴다.

export type AbsentSplit = {
  /** 근무 시작 시각이 지났는데 출근 기록이 없는 사람(진짜 미출근) */
  absent: Set<string>;
  /** 오늘 근무 시작 시각 전이라 아직 출근 전인 사람 */
  beforeStart: Set<string>;
  /** 루트코스 교육 중인 신입(일정·출근·미출근 어느 숫자에도 넣지 않는다) */
  training: Set<string>;
};

const hhmmToMin = (s: string) => { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };

/** day = @db.Date 규칙의 UTC 자정(kstTodayDateUTC()). now 는 시험용 주입(기본 지금) */
export async function absentSplit(userIds: string[], day: Date, now: Date = new Date()): Promise<AbsentSplit> {
  if (userIds.length === 0) return { absent: new Set(), beforeStart: new Set(), training: new Set() };
  const dayYmd = day.toISOString().slice(0, 10);
  const [scheduled, atts, pendIn, leaves, training] = await Promise.all([
    // 퇴사일이 그날보다 앞인 사람(퇴사일 당일은 재직 — lib/resign isResigned 와 같은 규칙)·입사일이 그날보다 뒤인 사람은 뺀다
    // (2026-10-17 #219 검증 F3 — 부르는 쪽 인원 조건과 따로 여기서도 막는다)
    prisma.schedule.findMany({
      where: {
        date: day, userId: { in: userIds }, type: "WORK",
        user: { AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: day } }] }, { OR: [{ hireDate: null }, { hireDate: { lte: day } }] }] },
      },
      select: { userId: true, startTime: true },
    }),
    prisma.attendance.findMany({ where: { date: day, userId: { in: userIds }, clockIn: { not: null } }, select: { userId: true } }),
    prisma.attendanceRequest.findMany({ where: { workDate: day, userId: { in: userIds }, action: "IN", status: "PENDING" }, select: { userId: true } }),
    prisma.leaveRequest.findMany({
      where: { userId: { in: userIds }, status: "APPROVED", startDate: { lte: day }, endDate: { gte: day } },
      select: { userId: true },
    }),
    trainingUserIds(userIds, dayYmd),
  ]);
  const came = new Set([...atts, ...pendIn].map((r) => r.userId));
  const onLeave = new Set(leaves.map((l) => l.userId));
  // 오늘이면 지금 시각(KST 분)과 비교, 지난 날은 전부 지난 것으로
  const isToday = kstTodayDateUTC(now).getTime() === day.getTime();
  const nowMin = kstHour(now) * 60 + kstMinute(now);
  const absent = new Set<string>();
  const beforeStart = new Set<string>();
  for (const s of scheduled) {
    if (came.has(s.userId) || onLeave.has(s.userId) || training.has(s.userId)) continue;
    if (isToday && hhmmToMin(s.startTime) > nowMin) beforeStart.add(s.userId);
    else absent.add(s.userId);
  }
  return { absent, beforeStart, training };
}

/** 미출근(시작 시각이 지난 사람)만 — 옛 호출처용 */
export async function absentUserIds(userIds: string[], day: Date): Promise<Set<string>> {
  return (await absentSplit(userIds, day)).absent;
}
