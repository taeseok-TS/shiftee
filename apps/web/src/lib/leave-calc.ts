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

/** 1일 통상임금 = (연봉/12)/209시간 × 8시간 */
export function dailyOrdinaryWage(annualSalary: number): number {
  return Math.round((annualSalary / 12 / 209) * 8);
}

/** 연차수당 = 1일 통상임금 × 잔여연차 */
export function leaveAllowance(annualSalary: number, remainingDays: number): number {
  return Math.round(dailyOrdinaryWage(annualSalary) * remainingDays);
}
