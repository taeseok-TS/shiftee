// ─── 계약 양식 칸 설정(2026-10-13 QA76 #22 1단계 「칸 설정 화면」) ─────────────────────────
// 끌어다 놓는 PDF 편집기(2단계) 전에, 워드 양식의 {칸}마다 **채우는 방식·필수·자동 값**을 본부가 정한다.
//  · mode  auto = 시스템이 채움(직원 정보·오늘 날짜·고정 문구) — 작성 화면에 안 보임
//          hq   = 본부가 작성할 때 입력(기본)
//          edit = 자동으로 채운 뒤 보내기 전에 본부가 고침(작성 화면에 자동 값이 채워진 채 보임)
//          sign = 서명할 때 직원이 입력
//  · required = 필수(작성 화면·서명 때 비면 막는다). 자동 칸에는 의미 없음
//  · source/text = auto 칸의 값 출처(직원 정보 등) 또는 고정 문구
//  · 설정이 없는 칸은 종전 규칙 그대로: SYSTEM_FIELDS 는 auto, 「사유·확인_·주민등록번호」는 sign, 나머지는 hq
export type FieldMode = "auto" | "hq" | "edit" | "sign";
export type FieldSetting = { mode?: FieldMode; required?: boolean; source?: string; text?: string };
export type FieldSettings = Record<string, FieldSetting>;

export const FIELD_MODES: { value: FieldMode; label: string; hint: string }[] = [
  { value: "auto", label: "자동 입력", hint: "직원 정보·오늘 날짜·고정 문구로 시스템이 채움" },
  { value: "edit", label: "보내기 전 수정", hint: "자동으로 채운 뒤 본부가 고쳐서 보냄" },
  { value: "hq", label: "본부 입력", hint: "작성할 때 본부가 적음" },
  { value: "sign", label: "서명 때 직원 입력", hint: "직원이 서명하며 직접 적음" },
];
/** 자동 값 출처 — buildContractMergeData 가 만드는 값의 이름 */
export const AUTO_SOURCES: { key: string; label: string }[] = [
  { key: "직원명", label: "직원 이름" }, { key: "이메일", label: "이메일" }, { key: "연락처", label: "연락처" }, { key: "지점", label: "지점" },
  { key: "지점명", label: "지점명(「지점」 뺀 이름)" }, { key: "직책", label: "직군(직책)" }, { key: "직급", label: "직급" }, { key: "입사일", label: "입사일" },
  { key: "사원번호", label: "사원번호" }, { key: "생년월일", label: "생년월일" }, { key: "주소", label: "주소" }, { key: "작성일", label: "오늘 날짜(작성일)" },
  { key: "제목", label: "계약 제목" }, { key: "계약시작일", label: "계약 시작일" }, { key: "계약종료일", label: "계약 종료일" }, { key: "지점주소", label: "지점 주소(지점 표)" },
];
const MODES = new Set<string>(FIELD_MODES.map((m) => m.value));
/** 원천 칸에서 서버가 만들어 내는 파생 표기 칸(2026-10-23 주말 학습실장·코디 오후판) → 그 원천 칸.
 *  양식에는 파생 칸만 있어도 작성 화면은 원천 칸을 입력란으로 띄우고(fields API·요약 칸이 원천을 덧붙인다) 파생 칸은 숨긴다.
 *  · 주말급여합계 = 기본급금액 + 주말수당금액 + 주휴수당금액(「1,234원」, 빈 칸은 0, 셋 다 비면 빈칸)
 *  · 출근시각12·퇴근시각12 = 「14:00」→「2:00」(12시간제 숫자만 — 오전/오후 글자는 양식 문장에 적는다)
 *  · 주휴수당표기 = 요일 표(월~일 근로시간) 합계가 주 15시간 이상이면 {주휴수당금액}, 미만이면 「해당 없음」(근로기준법 제18조 3항, 10/23 본부)
 *    — 주 15시간 미만이면 {주말급여합계}도 주휴수당을 0 으로 더한다 */
export const WEEK_DAYS = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"] as const;
export const DAY_TABLE_HOURS = WEEK_DAYS.map((d) => `${d}근로시간`);
export const DERIVED_FIELD_SOURCES: Record<string, string[]> = {
  주말급여합계: ["기본급금액", "주말수당금액", "주휴수당금액"],
  출근시각12: ["출근시각"],
  퇴근시각12: ["퇴근시각"],
  주휴수당표기: ["주휴수당금액", ...DAY_TABLE_HOURS],
};

// 시간 칸은 적힌 숫자 중 **가장 큰 값** — 「1일 9시간」→9, 「주 5일 45시간」→45(첫 숫자만 읽으면 초과를 놓친다, 재검증 F7)
// 「7시간 30분」→7.5 처럼 시간·분 표기는 합쳐 읽고, 연도 같은 4자리 이상 숫자는 무시한다(재검증 N2). 검사(contract-validate)·파생 칸 공용
export const hoursNum = (v: string | undefined | null): number | null => {
  const t = v || "";
  const hm = [...t.matchAll(/(\d+(?:\.\d+)?)\s*시간(?:\s*(\d+)\s*분)?/g)].map((m) => Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0));
  if (hm.length) return Math.max(...hm);
  // 「7:30」→7.5(하루 시간 표기), 「30분」→0.5
  const colon = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(t);
  if (colon) return Number(colon[1]) + Number(colon[2]) / 60;
  const onlyMin = /^\s*(\d+)\s*분\s*$/.exec(t);
  if (onlyMin) return Number(onlyMin[1]) / 60;
  const all = [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter((n) => Number.isFinite(n) && n < 1000);
  return all.length ? Math.max(...all) : null;
};
/** 요일 표(주말 학습실장 {월요일근로시간}~{일요일근로시간}) 1주 합계 — 빈 칸은 0 */
export const dayTableWeekHours = (merge: Record<string, string>): number =>
  DAY_TABLE_HOURS.reduce((sum, k) => sum + (hoursNum(merge[k]) ?? 0), 0);
/** 주휴수당 대상 여부 — 요일 표 합계 15시간 이상. 요일 표가 비어 있으면(합계 0) 판단할 수 없어 null(종전처럼 금액을 그대로 쓴다) */
export const weeklyRestPayApplies = (merge: Record<string, string>): boolean | null => {
  const wk = dayTableWeekHours(merge);
  return wk > 0 ? wk >= 15 : null;
};
/** 요일 값 읽기 — 「월요일」·「월」(앞뒤 공백·괄호 허용) → 「월요일」. 못 읽으면 null */
export const normalizeWeekday = (v: string | undefined | null): string | null => {
  const m = /^\s*[(（]?\s*([월화수목금토일])\s*(?:요일)?\s*[)）]?\s*$/.exec(v || "");
  return m ? `${m[1]}요일` : null;
};
/** 칸 이름 목록에 파생 칸의 원천 칸을 덧붙인다(이미 있으면 그대로) — 작성 화면 입력란·요약 칸 거르기용 */
export function withDerivedSources(names: string[]): string[] {
  const out = [...names];
  for (const n of names) for (const src of DERIVED_FIELD_SOURCES[n] ?? []) if (!out.includes(src)) out.push(src);
  return out;
}
/** 설정으로 건드릴 수 없는 칸 — 서명 이미지 자리 마커와 서버가 다른 값에서 만들어내는 파생 표기(설정 실수 한 번에 서명본이 깨진다, 10/13 검증 7) */
export const PROTECTED_FIELDS = new Set([
  "근로자서명", "대표서명", "원장서명", "본부서명",
  "지점명", "지급기타표기", "동의필수표기", "신규입사", "재계약", "동의고유식별", "동의채용정보",
  "연봉한글", "연봉총액", "월급여합계", "기본급", "식대", "연봉숫자",
  ...Object.keys(DERIVED_FIELD_SOURCES),
]);
const SOURCES = new Set(AUTO_SOURCES.map((s) => s.key));
const MAX_FIELDS = 150;

/** 저장값(JSON) → 설정. 모르는 값은 버린다(저장소에 뭐가 있어도 화면·치환이 안 깨지게) */
export function parseFieldSettings(raw: unknown, opts: { keepProtected?: boolean } = {}): FieldSettings {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return {}; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: FieldSettings = {};
  for (const [k, s] of Object.entries(v as Record<string, unknown>).slice(0, MAX_FIELDS)) {
    const name = k.trim();
    if (!name || name.length > 30 || (PROTECTED_FIELDS.has(name) && !opts.keepProtected) || !s || typeof s !== "object" || Array.isArray(s)) continue;
    const o = s as Record<string, unknown>;
    const fs: FieldSetting = {};
    if (typeof o.mode === "string" && MODES.has(o.mode)) fs.mode = o.mode as FieldMode;
    if (o.required === true) fs.required = true;
    if (typeof o.source === "string" && SOURCES.has(o.source)) fs.source = o.source;
    if (typeof o.text === "string" && o.text.trim()) fs.text = o.text.trim().slice(0, 200);
    if (Object.keys(fs).length) out[name] = fs;
  }
  return out;
}

/** 감사 기록용 — 바뀐 칸만 「칸: 전→후」 */
export function fieldSettingsDiff(before: FieldSettings, after: FieldSettings): string[] {
  const label = (s: FieldSetting | undefined) => {
    if (!s) return "기본";
    const parts: string[] = [];
    if (s.mode) parts.push(FIELD_MODES.find((m) => m.value === s.mode)?.label ?? s.mode);
    if (s.required) parts.push("필수");
    if (s.source) parts.push(`출처 ${s.source}`);
    if (s.text) parts.push(`문구 「${s.text}」`);
    return parts.join("·") || "기본";
  };
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const out: string[] = [];
  for (const k of keys) { const a = label(before[k]), b = label(after[k]); if (a !== b) out.push(`{${k}} ${a}→${b}`); }
  return out;
}

/** 칸 이름 집합 — mode 별 */
export const fieldsWithMode = (settings: FieldSettings, mode: FieldMode) =>
  new Set(Object.entries(settings).filter(([, s]) => s.mode === mode).map(([k]) => k));
/** 사람이 적는 칸(보내기 전 수정·본부 입력·서명 때 직원 입력) — 자동 칸이라도 입력값이 자동값을 덮는다(10/13 검증 2) */
export const humanFields = (settings: FieldSettings) =>
  new Set(Object.entries(settings).filter(([, s]) => s.mode && s.mode !== "auto").map(([k]) => k));

/** 본부가 적는 칸(본부 입력·보내기 전 수정) 중 필수인데 비어 있는 칸 — 작성·묶음 작성이 직접 호출·일괄 경로에서도 막게(10/13 검증 11) */
export function requiredHqMissing(mergeData: Record<string, string>, settings: FieldSettings): string[] {
  return Object.entries(settings).filter(([k, s]) => (s.mode === "hq" || s.mode === "edit") && s.required && !String(mergeData[k] ?? "").trim()).map(([k]) => k);
}

/** auto 칸의 값을 치환 데이터에 넣는다 — 고정 문구가 있으면 그것, 아니면 출처 값. 출처가 없는 auto 칸은 건드리지 않는다 */
export function applyAutoSources(mergeData: Record<string, string>, settings: FieldSettings): void {
  const base = { ...mergeData };   // 출처는 적용 전 값을 본다 — 설정 순서에 따라 결과가 달라지지 않게(10/13 검증 8)
  for (const [name, s] of Object.entries(settings)) {
    if (s.mode !== "auto") continue;
    if (s.text) mergeData[name] = s.text;
    else if (s.source && (base[s.source] ?? "") !== "") mergeData[name] = base[s.source];   // 출처가 비면 건드리지 않는다(다른 채움이 살게)
  }
}
