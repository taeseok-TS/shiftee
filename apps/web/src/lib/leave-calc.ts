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
 * **휴가가 속한 연차 연도 = 시작일의 연도**(2026-09-11 디렉터 "휴가를 쓰는 해 기준").
 * 차감·복구·잔여 확인이 모두 이 함수를 쓴다(lib/leave-balance.ts). 12월에 승인한 1월 휴가는 **새해** 연차에서
 * 깎이고, 취소하면 새해로 돌아온다 — 종전(승인한 해 기준)에는 1월에 취소하면 이미 마감된 작년 행으로 복구돼
 * 새해 잔여가 늘지 않았다. 해를 걸친 휴가(12/30~1/2)는 시작일의 해로 한꺼번에 센다.
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
