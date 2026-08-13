import { kstHour, kstMinute } from "@/lib/kst";
import { isHoliday } from "@/lib/holidays";

// 출퇴근 상태 판정 — auto-fill의 인라인 로직을 그대로 추출 (동작 불변).
// 우선순위: LATE > EARLY_LEAVE (지각+조퇴면 LATE). 판정은 한국시간 기준.
// dateYmd("YYYY-MM-DD")가 공휴일이면 지각/조퇴 판정을 하지 않는다 (공휴일 정책).
export async function calcStatus(
  clockIn: Date | null,
  clockOut: Date | null,
  dateYmd: string
): Promise<"NORMAL" | "LATE" | "EARLY_LEAVE"> {
  const holiday = await isHoliday(dateYmd);
  const isLate =
    !holiday && !!clockIn && (kstHour(clockIn) > 9 || (kstHour(clockIn) === 9 && kstMinute(clockIn) > 0));
  const isEarlyLeave = !holiday && !!clockOut && kstHour(clockOut) < 18;
  return isLate ? "LATE" : isEarlyLeave ? "EARLY_LEAVE" : "NORMAL";
}
