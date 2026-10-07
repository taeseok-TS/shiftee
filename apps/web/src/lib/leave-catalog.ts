// ─── 휴가 유형 기준표(2026-10-07 QA #30, 본부 답변 #19) ─────────────────────
// 시프티 「휴가 유형 관리」 엑셀(17개)·「휴가 그룹 관리」 그대로. 이 표가 휴가 유형의 **단일 원천**이다 —
// 신청 화면(웹·앱)·서버 검증·일수 계산·연차 차감·엑셀(유급 시간)이 모두 여기를 본다.
//  · 연차휴가 그룹만 연차에서 차감한다. 나머지는 차감하지 않는다(그룹마다 「초과 사용 제한」 없음).
//  · 병가는 신청 목록에서 뺐다(연차로 쓴다). 이미 있는 병가 기록은 종전대로 연차 차감으로 둔다.
//  · 옛 경조 세부 유형(결혼·출산·사망)·특별휴가도 신청 목록에서 빠졌다 — 기록은 그대로 보인다.
// 단위: FULL = 기간의 근무일(주말·공휴일 제외) 수, HALF = 0.5일, QUARTER = 0.25일.

export type LeaveUnit = "FULL" | "HALF" | "QUARTER";
export type LeaveGroup = "연차휴가" | "보상휴가" | "대체휴일" | "보건휴가" | "경조휴가" | "기타휴가";

export type LeaveTypeInfo = {
  code: string;
  label: string;
  group: LeaveGroup;
  paidHours: number;          // 하루(또는 반차) 당 유급 시간 — 엑셀·리포트용
  unit: LeaveUnit;
  deducts: boolean;           // 연차 차감
  attachRequired?: string;    // 필수 첨부(있으면 신청 때 받아야 한다) — 화면 안내 문구
  notice?: string;            // 신청 화면 안내
  selectable: boolean;        // 새 신청 목록에 보이나
};

export const LEAVE_CATALOG: LeaveTypeInfo[] = [
  { code: "ANNUAL", label: "연차", group: "연차휴가", paidHours: 8, unit: "FULL", deducts: true, selectable: true },
  { code: "HALF_AM", label: "오전 반차", group: "연차휴가", paidHours: 4, unit: "HALF", deducts: true, selectable: true },
  { code: "HALF_PM", label: "오후 반차", group: "연차휴가", paidHours: 4, unit: "HALF", deducts: true, selectable: true },
  { code: "QUARTER_AM", label: "오전 반반차", group: "연차휴가", paidHours: 2, unit: "QUARTER", deducts: true, selectable: true },
  { code: "QUARTER_PM", label: "오후 반반차", group: "연차휴가", paidHours: 2, unit: "QUARTER", deducts: true, selectable: true },

  { code: "COMP_LEAVE", label: "보상휴가", group: "보상휴가", paidHours: 8, unit: "FULL", deducts: false, attachRequired: "보상휴가제 동의서", notice: "5/1 근로자의 날 근무 → 보상휴가제 동의서 제출이 필요합니다.", selectable: true },
  { code: "COMP_LEAVE_HALF", label: "보상휴가(반차)", group: "보상휴가", paidHours: 4, unit: "HALF", deducts: false, attachRequired: "보상휴가제 동의서", notice: "5/1 근로자의 날 근무 → 보상휴가제 동의서 제출이 필요합니다.", selectable: true },

  { code: "COMPENSATORY", label: "대체휴일", group: "대체휴일", paidHours: 8, unit: "FULL", deducts: false, attachRequired: "휴일대체 동의서", notice: "휴일대체 동의서 제출이 필요합니다.", selectable: true },
  { code: "COMPENSATORY_HALF", label: "대체휴일(반차)", group: "대체휴일", paidHours: 4, unit: "HALF", deducts: false, attachRequired: "휴일대체 동의서", notice: "휴일대체 동의서 제출이 필요합니다.", selectable: true },

  { code: "PRENATAL_CHECKUP", label: "태아검진휴가", group: "보건휴가", paidHours: 4, unit: "HALF", deducts: false, notice: "4시간 유급휴가", selectable: true },

  { code: "FAMILY_EVENT", label: "경조휴가", group: "경조휴가", paidHours: 8, unit: "FULL", deducts: false, attachRequired: "증빙 서류", notice: "증빙 서류(청첩장·부고 등)를 첨부해 주세요.", selectable: true },

  { code: "REWARD", label: "포상휴가", group: "기타휴가", paidHours: 8, unit: "FULL", deducts: false, notice: "10년 근속 포상 유급 휴가", selectable: true },
  { code: "MATERNITY", label: "출산휴가", group: "기타휴가", paidHours: 8, unit: "FULL", deducts: false, attachRequired: "출산휴가 신청서·증명서", notice: "출산휴가 신청서 및 증명서 첨부가 필요합니다.", selectable: true },
  { code: "SPOUSE_BIRTH", label: "배우자출산휴가", group: "기타휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: true },
  { code: "FAMILY_CARE", label: "가족돌봄휴가", group: "기타휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: true },
  { code: "CIVIL_DEFENSE", label: "민방위 휴가", group: "기타휴가", paidHours: 4, unit: "HALF", deducts: false, attachRequired: "민방위 참여 증빙", notice: "민방위 휴가 참여 증빙서류 제출이 필요합니다.", selectable: true },
  { code: "RESERVE_FORCES", label: "예비군 휴가", group: "기타휴가", paidHours: 8, unit: "FULL", deducts: false, attachRequired: "예비군 훈련 참여 확인증", notice: "예비군 훈련 참여 확인증 제출이 필요합니다.", selectable: true },
  { code: "OTHER_PAID", label: "기타휴가(유급)", group: "기타휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: true },
  { code: "OTHER_UNPAID", label: "기타휴가(무급)", group: "기타휴가", paidHours: 0, unit: "FULL", deducts: false, notice: "무급휴가 — 그달 급여에서 공제되거나 미사용 연차 정산 때 차감됩니다.", selectable: true },

  // ── 옛 유형(새 신청 목록에는 없음 — 기록 표시·계산용) ──
  { code: "SICK", label: "병가", group: "연차휴가", paidHours: 8, unit: "FULL", deducts: true, selectable: false },
  { code: "SPECIAL", label: "특별휴가", group: "기타휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: false },
  { code: "FAMILY_MARRIAGE", label: "경조-결혼", group: "경조휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: false },
  { code: "FAMILY_BIRTH", label: "경조-출산", group: "경조휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: false },
  { code: "FAMILY_BEREAVEMENT", label: "경조-사망(조사)", group: "경조휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: false },
];

const BY_CODE = new Map(LEAVE_CATALOG.map((t) => [t.code, t]));
export const leaveInfo = (code: string): LeaveTypeInfo | undefined => BY_CODE.get(code);
export const leaveLabel = (code: string): string => BY_CODE.get(code)?.label ?? code;
export const LEAVE_LABELS: Record<string, string> = Object.fromEntries(LEAVE_CATALOG.map((t) => [t.code, t.label]));
export const LEAVE_GROUPS: LeaveGroup[] = ["연차휴가", "보상휴가", "대체휴일", "보건휴가", "경조휴가", "기타휴가"];
