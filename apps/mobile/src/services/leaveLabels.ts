// 휴가 유형 이름 — 서버 apps/web/src/lib/leave-catalog.ts 와 같은 표(2026-10-07 QA #30, 본부 답변 #19).
// 신청 화면은 GET /leave/types 로 받은 값으로 덮어쓴다. 다른 화면(홈·결재·일정)은 이 표를 쓴다.
export const LEAVE_LABELS: Record<string, string> = {
  ANNUAL: "연차", HALF_AM: "오전 반차", HALF_PM: "오후 반차", QUARTER_AM: "오전 반반차", QUARTER_PM: "오후 반반차",
  COMP_LEAVE: "보상휴가", COMP_LEAVE_HALF: "보상휴가(반차)",
  COMPENSATORY: "대체휴일", COMPENSATORY_HALF: "대체휴일(반차)",
  PRENATAL_CHECKUP: "태아검진휴가", FAMILY_EVENT: "경조휴가",
  REWARD: "포상휴가", MATERNITY: "출산휴가", SPOUSE_BIRTH: "배우자출산휴가", FAMILY_CARE: "가족돌봄휴가",
  CIVIL_DEFENSE: "민방위 휴가", RESERVE_FORCES: "예비군 휴가", OTHER_PAID: "기타휴가(유급)", OTHER_UNPAID: "기타휴가(무급)",
  // 옛 유형(기록 표시용)
  SICK: "병가", SPECIAL: "특별휴가", FAMILY_MARRIAGE: "경조-결혼", FAMILY_BIRTH: "경조-출산", FAMILY_BEREAVEMENT: "경조-사망(조사)",
  PERSONAL: "개인휴가", BEREAVEMENT: "경조휴가",
};
