// ─── 휴가 유형 기준표(2026-10-07 QA #30, 본부 답변 #19) ─────────────────────
// 시프티 「휴가 유형 관리」 엑셀(17개)·「휴가 그룹 관리」 그대로. 이 표가 휴가 유형의 **단일 원천**이다 —
// 신청 화면(웹·앱)·서버 검증·일수 계산·연차 차감·엑셀(유급 시간)이 모두 여기를 본다.
//  · 연차휴가 그룹만 연차에서 차감한다. 나머지는 차감하지 않는다. 보상휴가·대체휴일은 부여 잔여를 넘으면 신청을 막는다
//    (2026-10-16 #219-7 디렉터 결정 — 종전 「초과 사용 제한 없음」을 바꿈, lib/leave-limit.ts).
//  · 병가는 신청 목록에서 뺐다(병가 없음 — 아프면 연차로 신청, 2026-10-07 #19 · 10-19 본부 재확인). 이미 있는 병가 기록·시프티에서 가져온
//    병가는 기록 표시용으로 SICK 그대로 두고 종전대로 연차 차감으로 센다(selectable:false — 웹·앱 신청 목록과 서버 신청 검사에서 빠진다).
//  · 옛 경조 세부 유형(결혼·출산·사망)·특별휴가도 신청 목록에서 빠졌다 — 기록은 그대로 보인다.
// 단위: FULL = 기간의 근무일 수(근무일정 기준 — 일정 WORK 는 셈·OFF/HOLIDAY 는 안 셈, 일정 없는 날은 평일·비공휴일, lib/leave-days.ts), HALF = 0.5일, QUARTER = 0.25일.
//  · calendarDays = FULL 인데 주말·공휴일까지 달력 날짜 그대로 센다 — 경조휴가(조사)·출산휴가(2026-10-22 본부 이예지: 조사는 주말 포함, 경사는 주말 미포함, 출산 90일).

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
  adminOnly?: boolean;        // 신청 목록엔 없고 본부 대리 등록만 받는다(육아휴직 — 10/23)
  calendarDays?: boolean;     // 주말·공휴일 포함 달력 날짜로 센다(FULL 유형만 — 위 설명)
  custom?: boolean;           // 본부가 화면에서 만든 유형(LeaveTypeDef, #216-1)
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

  // 경조휴가는 조사·경사로 나눠 고른다(2026-10-22 본부) — 조사는 주말·공휴일 포함, 경사는 근무일만. 종전 「경조휴가」는 기록 표시용으로 남긴다(아래 옛 유형)
  { code: "FAMILY_CONDOLENCE", label: "경조휴가(조사)", group: "경조휴가", paidHours: 8, unit: "FULL", deducts: false, calendarDays: true, attachRequired: "증빙 서류", notice: "부모·조부모·배우자 부모 사망 등 — 주말·공휴일을 포함해 셉니다. 부고 등 증빙 서류를 첨부해 주세요.", selectable: true },
  { code: "FAMILY_CELEBRATION", label: "경조휴가(경사)", group: "경조휴가", paidHours: 8, unit: "FULL", deducts: false, attachRequired: "증빙 서류", notice: "결혼·신혼여행·칠순·팔순 등 — 주말·공휴일은 빼고 셉니다. 청첩장 등 증빙 서류를 첨부해 주세요.", selectable: true },

  { code: "REWARD", label: "포상휴가", group: "기타휴가", paidHours: 8, unit: "FULL", deducts: false, notice: "10년 근속 포상 유급 휴가", selectable: true },
  // 출산휴가는 주말·공휴일 포함 달력 날짜(90일) — 2026-10-22 본부 이예지(시프티는 평일만 세어 64일로 남았다)
  { code: "MATERNITY", label: "출산휴가", group: "기타휴가", paidHours: 8, unit: "FULL", deducts: false, calendarDays: true, attachRequired: "출산휴가 신청서·증명서", notice: "출산휴가 신청서 및 증명서 첨부가 필요합니다. 주말·공휴일을 포함해 셉니다.", selectable: true },
  { code: "PARENTAL", label: "육아휴직", group: "기타휴가", paidHours: 0, unit: "FULL", deducts: false, calendarDays: true, notice: "본부가 등록합니다. 주말·공휴일을 포함해 셉니다(무급).", selectable: false, adminOnly: true },
  { code: "SPOUSE_BIRTH", label: "배우자출산휴가", group: "기타휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: true },
  { code: "FAMILY_CARE", label: "가족돌봄휴가", group: "기타휴가", paidHours: 0, unit: "FULL", deducts: false, notice: "무급휴가입니다(연차는 차감되지 않습니다).", selectable: true },   // 무급(2026-10-16 본부 결정 #220-1, 종전 유급 8h)
  { code: "CIVIL_DEFENSE", label: "민방위 휴가", group: "기타휴가", paidHours: 4, unit: "HALF", deducts: false, attachRequired: "민방위 참여 증빙", notice: "민방위 휴가 참여 증빙서류 제출이 필요합니다.", selectable: true },
  { code: "RESERVE_FORCES", label: "예비군 휴가", group: "기타휴가", paidHours: 8, unit: "FULL", deducts: false, attachRequired: "예비군 훈련 참여 확인증", notice: "예비군 훈련 참여 확인증 제출이 필요합니다.", selectable: true },
  { code: "OTHER_PAID", label: "기타휴가(유급)", group: "기타휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: true },
  { code: "OTHER_UNPAID", label: "기타휴가(무급)", group: "기타휴가", paidHours: 0, unit: "FULL", deducts: false, notice: "무급휴가 — 그달 급여에서 공제됩니다.", selectable: true },   // 「미사용 연차 정산 때 차감」 문구 삭제(2026-10-19 본부 답 — 정산에는 넣지 않는다, deducts:false 그대로)

  // ── 옛 유형(새 신청 목록에는 없음 — 기록 표시·계산용) ──
  { code: "SICK", label: "병가", group: "연차휴가", paidHours: 8, unit: "FULL", deducts: true, selectable: false },
  { code: "SPECIAL", label: "특별휴가", group: "기타휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: false },
  { code: "FAMILY_EVENT", label: "경조휴가", group: "경조휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: false },   // 2026-10-22 조사·경사로 나누기 전 기록·시프티 이관분
  { code: "FAMILY_MARRIAGE", label: "경조-결혼", group: "경조휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: false },
  { code: "FAMILY_BIRTH", label: "경조-출산", group: "경조휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: false },
  { code: "FAMILY_BEREAVEMENT", label: "경조-사망(조사)", group: "경조휴가", paidHours: 8, unit: "FULL", deducts: false, selectable: false },
];

const BY_CODE = new Map(LEAVE_CATALOG.map((t) => [t.code, t]));
// ── 본부가 만든 유형·숨긴 기본 유형(2026-10-12 #216-1) — 서버는 lib/leave-catalog-db 가 적재해 얹고, 화면은 GET /api/leave/types 로 받아 얹는다 ──
let EXTRA = new Map<string, LeaveTypeInfo>();
let HIDDEN = new Set<string>();
export function registerExtraLeaveTypes(list: LeaveTypeInfo[]): void { EXTRA = new Map(list.map((t) => [t.code, { ...t, custom: true }])); }
export function setHiddenLeaveTypes(codes: string[]): void { HIDDEN = new Set(codes); }
/** 기본 유형 + 본부 유형. 숨긴 기본 유형은 selectable=false 로 보인다(기록 표시는 그대로) */
export function allLeaveTypes(): LeaveTypeInfo[] {
  return [...LEAVE_CATALOG.map((t) => (HIDDEN.has(t.code) ? { ...t, selectable: false } : t)), ...EXTRA.values()];
}
export const leaveInfo = (code: string): LeaveTypeInfo | undefined => {
  const b = BY_CODE.get(code);
  if (b) return HIDDEN.has(code) ? { ...b, selectable: false } : b;
  return EXTRA.get(code);
};
/** 주말·공휴일까지 달력 날짜로 세는 유형인가(경조휴가(조사)) — 일수·리포트·출퇴근 표시가 같은 판정을 쓴다 */
export const countsCalendarDays = (code: string): boolean => !!leaveInfo(code)?.calendarDays;
export const leaveLabel = (code: string): string => BY_CODE.get(code)?.label ?? EXTRA.get(code)?.label ?? code;
/** 기본 유형 이름표(모듈 상수) — 본부 유형까지 포함하려면 leaveLabel() 또는 leaveLabels() 를 쓴다 */
export const LEAVE_LABELS: Record<string, string> = Object.fromEntries(LEAVE_CATALOG.map((t) => [t.code, t.label]));
export const leaveLabels = (): Record<string, string> => Object.fromEntries(allLeaveTypes().map((t) => [t.code, t.label]));
// 화면용 라이브 집합(#216-1) — 하루짜리 유형·고정 일수. 모듈 상수로 복사해 두면 본부가 만든 유형이 빠지므로 **같은 객체**를 참조하고,
// useLeaveCatalog 가 서버 기준표를 받으면 applyLiveCatalog 로 그 자리에서 채운다
export const LIVE_SINGLE_DAY: Set<string> = new Set(LEAVE_CATALOG.filter((t) => t.unit !== "FULL").map((t) => t.code));
export const LIVE_FIXED_DAYS: Record<string, number> = Object.fromEntries(LEAVE_CATALOG.filter((t) => t.unit !== "FULL").map((t) => [t.code, t.unit === "HALF" ? 0.5 : 0.25]));
export function applyLiveCatalog(all: LeaveTypeInfo[]): void {
  LIVE_SINGLE_DAY.clear();
  for (const k of Object.keys(LIVE_FIXED_DAYS)) delete LIVE_FIXED_DAYS[k];
  for (const t of all) {
    if (t.unit !== "FULL") { LIVE_SINGLE_DAY.add(t.code); LIVE_FIXED_DAYS[t.code] = t.unit === "HALF" ? 0.5 : 0.25; }
    LEAVE_LABELS[t.code] = t.label;
  }
}
export const LEAVE_GROUPS: LeaveGroup[] = ["연차휴가", "보상휴가", "대체휴일", "보건휴가", "경조휴가", "기타휴가"];
