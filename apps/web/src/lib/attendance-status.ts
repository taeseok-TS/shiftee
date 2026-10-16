import { kstHour, kstMinute } from "@/lib/kst";
import { isHoliday } from "@/lib/holidays";
import { prisma } from "@/lib/db";

// 출퇴근 상태 판정 — 한국시간 기준.
// 우선순위: LATE > EARLY_LEAVE (지각+조퇴면 LATE).
// dateYmd("YYYY-MM-DD")가 공휴일이면 지각/조퇴 판정을 하지 않는다 (공휴일 정책).
//
// ⚠ 기준 시각은 **본인이 승인받은 근무일정(Schedule)** 을 따른다 (2026-09-07 디렉터 지시).
//   종전에는 09:00/18:00 이 하드코딩이라, 오후 1시 출근이 정상인 근무자(승인 템플릿에
//   `1-10 (1PM-10PM)` 이 실제로 있다)가 **매일 지각으로 찍혔다.** 실측으로 40건 중
//   정상이 3건뿐이었다 — 그 상태의 근태 통계는 읽을 가치가 없다.
//
// ⚠ 근무일정이 없는 날은 **지각·조퇴를 판정하지 않는다** (2026-10-16 #219-2, 본부 10/7 답변 12번
//   「일정 없는 평일 출근은 출근으로 인정, 지각 판정 안 함」). 종전에는 09:00/18:00 기본값으로
//   판정해 일정 없는 날 17:05 출근이 「지각」으로 찍혔다. 기준이 없으면 판정도 없다 → 「정상」.
//   시각 형식이 깨진 일정도 그쪽 판정만 건너뛴다(엉뚱한 기본값으로 지각을 만들지 않는다).
//   ※ 이미 LATE 로 저장된 과거 기록은 다시 계산하지 않는다(관리자가 그 기록을 수정·보정하면 이 규칙으로 다시 매겨진다).

/** "HH:mm" → 분. 형식이 아니면 null(=그쪽은 판정하지 않는다). */
export function hhmmToMin(v: string | null | undefined): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export type WorkWindow = {
  /** 그날 승인된 근무일정(WORK)이 있는가 */
  hasSchedule: boolean;
  /** 근무 시작(분, KST). 일정이 없거나 형식이 깨졌으면 null — 지각 판정 안 함 */
  startMin: number | null;
  /** 근무 종료(분, KST). 일정이 없거나 형식이 깨졌으면 null — 조퇴 판정 안 함 */
  endMin: number | null;
};

const NO_WINDOW: WorkWindow = { hasSchedule: false, startMin: null, endMin: null };

/** 그날 그 사람의 근무 시작·종료 시각(분). 승인된 근무일정(WORK)이 있으면 그것, 없으면 null(판정 안 함). */
export async function workWindowFor(userId: string, dateYmd: string): Promise<WorkWindow> {
  try {
    // Schedule.date 는 @db.Date — clock-in 과 같은 규칙으로 UTC 자정을 만든다.
    const [y, m, d] = dateYmd.split("-").map(Number);
    const sched = await prisma.schedule.findFirst({
      where: { userId, date: new Date(Date.UTC(y, m - 1, d)), type: "WORK" },
      select: { startTime: true, endTime: true },
    });
    if (!sched) return NO_WINDOW;
    return { hasSchedule: true, startMin: hhmmToMin(sched.startTime), endMin: hhmmToMin(sched.endTime) };
  } catch {
    // 조회가 깨져도 판정 자체가 죽으면 안 된다 — 판정 없이(정상) 간다.
    return NO_WINDOW;
  }
}

/** 출근 시각이 지각인가 — 시작 기준이 없으면(일정 없음) 지각이 아니다 */
export function isLateAt(clockIn: Date | null, startMin: number | null): boolean {
  return !!clockIn && startMin != null && kstHour(clockIn) * 60 + kstMinute(clockIn) > startMin;
}

/** 퇴근 시각이 조퇴인가 — 종료 기준이 없으면(일정 없음) 조퇴가 아니다 */
export function isEarlyLeaveAt(clockOut: Date | null, endMin: number | null): boolean {
  return !!clockOut && endMin != null && kstHour(clockOut) * 60 + kstMinute(clockOut) < endMin;
}

export async function calcStatus(
  clockIn: Date | null,
  clockOut: Date | null,
  dateYmd: string,
  userId?: string
): Promise<"NORMAL" | "LATE" | "EARLY_LEAVE"> {
  const holiday = await isHoliday(dateYmd);
  if (holiday) return "NORMAL";

  // userId 가 없으면 일정을 알 수 없다 — 판정하지 않는다(#219-2, 종전에는 09:00/18:00 으로 판정)
  const { startMin, endMin } = userId ? await workWindowFor(userId, dateYmd) : NO_WINDOW;

  const isLate = isLateAt(clockIn, startMin);
  const isEarlyLeave = isEarlyLeaveAt(clockOut, endMin);
  return isLate ? "LATE" : isEarlyLeave ? "EARLY_LEAVE" : "NORMAL";
}
