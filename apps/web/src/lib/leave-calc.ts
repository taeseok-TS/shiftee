// 대한민국 근로기준법 기준 연차/근속/연차수당 계산 유틸

/** 입사일~기준일 사이 만(완성) 개월 수 */
export function completedMonths(hire: Date, asOf: Date): number {
  let months = (asOf.getFullYear() - hire.getFullYear()) * 12 + (asOf.getMonth() - hire.getMonth());
  if (asOf.getDate() < hire.getDate()) months -= 1;
  return Math.max(0, months);
}

/** 근속 연수(만) */
export function tenureYears(hire: Date, asOf: Date): number {
  return Math.floor(completedMonths(hire, asOf) / 12);
}

/** 근속기간 표시 "N년 M개월" */
export function tenureLabel(hire: Date, asOf: Date): string {
  const m = completedMonths(hire, asOf);
  return `${Math.floor(m / 12)}년 ${m % 12}개월`;
}

/**
 * 연차 부여 일수 (근로기준법)
 * - 1년 미만: 매월 개근 1일, 최대 11일
 * - 1~2년: 15일
 * - 3년 이상: 15 + floor((근속연수-1)/2), 최대 25일
 */
export function annualLeaveDays(hire: Date, asOf: Date): number {
  const months = completedMonths(hire, asOf);
  if (months < 12) return Math.min(months, 11);
  const years = Math.floor(months / 12);
  return Math.min(15 + Math.floor((years - 1) / 2), 25);
}

/** 연차 기준 연도 (KST — 서버 TZ가 UTC라 연말 자정 경계에서 연도가 하루 밀리는 문제 방지) */
export function currentLeaveYear(): number {
  return leaveYearOf(new Date());
}

/** 그 시각이 속한 달력 연도(KST). "지금" 연도는 currentLeaveYear() 로 쓴다. */
export function leaveYearOf(d: Date): number {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

/**
 * 휴가 **시작일의 연도**(2026-09-11 디렉터 "휴가를 쓰는 해 기준" — 승인한 해가 아니라 휴가 날짜의 해).
 * ⚠ 2026-10-19 부터 차감·복구·잔여·대장·정산은 이 함수가 아니라 **날짜별 해마다 몫**(lib/leave-days leaveDaysByYear,
 *   lib/leave-balance deductLeave/restoreLeave)을 쓴다 — 연도를 걸친 휴가(12/31~1/2)는 12/31 몫 그해, 1/2 몫 다음 해(본부 이예지 답).
 *   한 해 안 휴가는 둘이 같다. 이 함수는 「시작일 연도」 표시용으로만 남았다.
 * startDate 는 @db.Date(UTC 자정)라 UTC 연도가 곧 그 날짜의 연도다.
 */
export function leaveYearOfLeave(startDate: Date | string): number {
  return new Date(startDate).getUTCFullYear();
}

/** 1일 통상임금 = (연봉/12)/209시간 × 8시간 */
export function dailyOrdinaryWage(annualSalary: number): number {
  return Math.round((annualSalary / 12 / 209) * 8);
}

/** 연차수당 = 1일 통상임금 × 잔여연차 */
export function leaveAllowance(annualSalary: number, remainingDays: number): number {
  return Math.round(dailyOrdinaryWage(annualSalary) * remainingDays);
}
