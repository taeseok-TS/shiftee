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
/** 설정으로 건드릴 수 없는 칸 — 서명 이미지 자리 마커와 서버가 다른 값에서 만들어내는 파생 표기(설정 실수 한 번에 서명본이 깨진다, 10/13 검증 7) */
export const PROTECTED_FIELDS = new Set([
  "근로자서명", "대표서명", "원장서명", "본부서명",
  "지점명", "지급기타표기", "동의필수표기", "신규입사", "재계약", "동의고유식별", "동의채용정보",
  "연봉한글", "연봉총액", "월급여합계", "기본급", "식대", "연봉숫자",
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

/** auto 칸의 값을 치환 데이터에 넣는다 — 고정 문구가 있으면 그것, 아니면 출처 값. 출처가 없는 auto 칸은 건드리지 않는다 */
export function applyAutoSources(mergeData: Record<string, string>, settings: FieldSettings): void {
  const base = { ...mergeData };   // 출처는 적용 전 값을 본다 — 설정 순서에 따라 결과가 달라지지 않게(10/13 검증 8)
  for (const [name, s] of Object.entries(settings)) {
    if (s.mode !== "auto") continue;
    if (s.text) mergeData[name] = s.text;
    else if (s.source && (base[s.source] ?? "") !== "") mergeData[name] = base[s.source];   // 출처가 비면 건드리지 않는다(다른 채움이 살게)
  }
}
