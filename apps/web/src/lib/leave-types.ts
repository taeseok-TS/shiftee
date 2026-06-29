// 연차에서 차감되지 않는 휴가 유형
// (대체휴무·대체휴무반차·특별휴가·민방위·예비군훈련·경조사는 승인되어도 잔여 연차 미차감)
export const NON_DEDUCTIBLE_LEAVE_TYPES = new Set([
  "COMPENSATORY",
  "COMPENSATORY_HALF",
  "SPECIAL",
  "CIVIL_DEFENSE",
  "RESERVE_FORCES",
  "FAMILY_EVENT",
  "FAMILY_MARRIAGE",
  "FAMILY_BIRTH",
  "FAMILY_BEREAVEMENT",
]);

export function isLeaveDeductible(type: string): boolean {
  return !NON_DEDUCTIBLE_LEAVE_TYPES.has(type);
}
