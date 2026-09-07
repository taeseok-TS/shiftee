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
//   근무일정이 없는 날은 종전 기준(09:00/18:00)으로 되돌아간다.

const DEFAULT_START_MIN = 9 * 60;   // 09:00
const DEFAULT_END_MIN = 18 * 60;    // 18:00

/** "HH:mm" → 분. 형식이 아니면 null(=기본값을 쓴다). */
function hhmmToMin(v: string | null | undefined): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 그날 그 사람의 근무 시작·종료 시각(분). 승인된 근무일정이 있으면 그것, 없으면 09:00/18:00. */
export async function workWindowFor(userId: string, dateYmd: string): Promise<{ startMin: number; endMin: number }> {
  try {
    // Schedule.date 는 @db.Date — clock-in 과 같은 규칙으로 UTC 자정을 만든다.
    const [y, m, d] = dateYmd.split("-").map(Number);
    const sched = await prisma.schedule.findFirst({
      where: { userId, date: new Date(Date.UTC(y, m - 1, d)), type: "WORK" },
      select: { startTime: true, endTime: true },
    });
    return {
      startMin: hhmmToMin(sched?.startTime) ?? DEFAULT_START_MIN,
      endMin: hhmmToMin(sched?.endTime) ?? DEFAULT_END_MIN,
    };
  } catch {
    // 조회가 깨져도 판정 자체가 죽으면 안 된다 — 기본 기준으로 간다.
    return { startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN };
  }
}

export async function calcStatus(
  clockIn: Date | null,
  clockOut: Date | null,
  dateYmd: string,
  userId?: string
): Promise<"NORMAL" | "LATE" | "EARLY_LEAVE"> {
  const holiday = await isHoliday(dateYmd);
  if (holiday) return "NORMAL";

  const { startMin, endMin } = userId
    ? await workWindowFor(userId, dateYmd)
    : { startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN };

  const isLate = !!clockIn && kstHour(clockIn) * 60 + kstMinute(clockIn) > startMin;
  const isEarlyLeave = !!clockOut && kstHour(clockOut) * 60 + kstMinute(clockOut) < endMin;
  return isLate ? "LATE" : isEarlyLeave ? "EARLY_LEAVE" : "NORMAL";
}
