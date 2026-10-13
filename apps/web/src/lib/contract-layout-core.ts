// ─── PDF 양식 칸 배치 — 순수 모듈(타입·파서·설정 변환·감사 diff). 브라우저(편집기)와 서버가 함께 쓴다.
// 그리기(pdf-lib·fs)는 lib/contract-layout.ts 에 있다 — 클라이언트에서 그 파일을 import 하면 번들이 fs 를 찾다 깨진다(10/13 빌드 실패).
// ─── PDF 양식 칸 배치(2026-10-13 QA76 #22 2단계 「끌어다 놓는 편집기」) ──────────────────────
// 워드 양식은 {칸} 태그로 자리를 잡지만, PDF 양식은 글자를 바꿔 넣을 수 없다. 그래서 본부가 편집기에서
// PDF 위에 칸(텍스트·날짜·체크·드롭다운·이미지·서명·직인)을 끌어다 놓고, 그 **좌표를 템플릿에 저장**한다.
// 문서를 만들 때 pdf-lib 으로 값을 그 자리에 그려 넣고(fillPdfLayout), 서명이 끝나면 서명·직인 이미지를
// 서명 칸에 얹는다(stampLayoutSignatures). 칸의 채우는 방식·필수·자동 출처는 1단계 칸 설정과 같은 뜻이다
// (layoutToFieldSettings 가 fieldSettings 로 풀어 저장하므로 작성 화면·서명 화면은 1단계 코드 그대로 동작한다).
//
// 좌표계: 쪽 번호는 1부터, x·y·w·h 는 **화면에 보이는 쪽(PDF.js viewport = CropBox + /Rotate 반영) 너비·높이에 대한
// 비율(0~1), 원점은 왼쪽 위**. 그릴 때는 pageFrame 이 CropBox 원점과 회전을 되돌려 pdf-lib 좌표(왼쪽 아래)로 바꾼다
// (10/13 검증 1·2: 스캔 PDF 의 /Rotate 90·CropBox 오프셋에서 값이 엉뚱한 자리에 찍혔다).
import { AUTO_SOURCES, FIELD_MODES, PROTECTED_FIELDS, type FieldMode, type FieldSettings } from "@/lib/contract-field-settings";

export type LayoutFieldType = "text" | "date" | "checkbox" | "select" | "image" | "signature" | "seal";
export type LayoutRole = "HQ" | "MANAGER" | "EMPLOYEE";
export type LayoutField = {
  id: string;
  name: string;                 // 칸 이름 — 치환 데이터의 키({직원명} 의 「직원명」). 서명·직인 칸은 역할로 정해진다
  type: LayoutFieldType;
  page: number;                 // 1부터
  x: number; y: number; w: number; h: number;   // 보이는 쪽 비율(0~1), 원점 왼쪽 위
  role?: LayoutRole;            // 서명 칸: 누가 서명하나
  mode?: FieldMode;             // auto | hq | edit | sign (1단계와 같다)
  required?: boolean;
  source?: string;              // auto 칸의 출처(AUTO_SOURCES)
  text?: string;                // auto 칸의 고정 문구
  options?: string[];           // 드롭다운 선택지
  fontSize?: number;            // pt (6~24), 기본 10
  align?: "left" | "center" | "right";
};
export type TemplateLayout = { v: 1; fields: LayoutField[] };
/** 작성·서명 화면에 내려주는 칸 종류(이름만으로는 체크박스·드롭다운을 알 수 없다 — 10/13 검증 4) */
export type LayoutFieldTypes = Record<string, { type: LayoutFieldType; options?: string[] }>;

export const LAYOUT_TYPES: { value: LayoutFieldType; label: string }[] = [
  { value: "text", label: "텍스트" }, { value: "date", label: "날짜" }, { value: "checkbox", label: "체크박스" },
  { value: "select", label: "드롭다운" }, { value: "image", label: "이미지" }, { value: "signature", label: "서명" }, { value: "seal", label: "직인" },
];
export const LAYOUT_ROLES: { value: LayoutRole; label: string }[] = [
  { value: "EMPLOYEE", label: "직원" }, { value: "MANAGER", label: "지점 원장" }, { value: "HQ", label: "직영사업본부" },
];
/** 서명·직인 칸이 치환 데이터에서 차지하는 이름(워드 양식의 《마커》와 같은 이름) */
export const SIGN_MARKER_NAME: Record<string, string> = { EMPLOYEE: "근로자서명", MANAGER: "원장서명", HQ: "본부서명", seal: "대표서명" };

const TYPES = new Set<string>(LAYOUT_TYPES.map((t) => t.value));
const ROLES = new Set<string>(LAYOUT_ROLES.map((r) => r.value));
const MODES = new Set<string>(FIELD_MODES.map((m) => m.value));
const SOURCES = new Set(AUTO_SOURCES.map((s) => s.key));
const MAX_FIELDS = 300;
const clamp01 = (n: unknown, d = 0) => { const v = typeof n === "number" && Number.isFinite(n) ? n : d; return Math.min(1, Math.max(0, v)); };

/** 저장값(JSON) → 배치. 모르는 값은 버린다(저장소에 뭐가 있어도 문서 생성이 안 깨지게). 칸이 없으면 null */
export function parseLayout(raw: unknown): TemplateLayout | null {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const arr = (v as { fields?: unknown }).fields;
  if (!Array.isArray(arr)) return null;
  const fields: LayoutField[] = [];
  const ids = new Set<string>();
  for (const f of arr.slice(0, MAX_FIELDS)) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const type = typeof o.type === "string" && TYPES.has(o.type) ? (o.type as LayoutFieldType) : null;
    if (!type) continue;
    const role = typeof o.role === "string" && ROLES.has(o.role) ? (o.role as LayoutRole) : undefined;
    // 서명·직인 칸 이름은 역할이 정한다(본부가 마음대로 바꾸면 서명본이 안 붙는다)
    let name = typeof o.name === "string" ? o.name.trim().replace(/[{}]/g, "").slice(0, 30) : "";
    if (type === "signature") name = SIGN_MARKER_NAME[role ?? "EMPLOYEE"];
    else if (type === "seal") name = SIGN_MARKER_NAME.seal;
    if (!name) continue;
    let id = typeof o.id === "string" ? o.id.slice(0, 40) : "";
    if (!id || ids.has(id)) id = `f_${Math.random().toString(36).slice(2, 10)}`;
    ids.add(id);
    const w = clamp01(o.w, 0.2), h = clamp01(o.h, 0.03);
    const field: LayoutField = {
      id, name, type,
      page: Math.max(1, Math.min(500, Math.floor(typeof o.page === "number" ? o.page : 1) || 1)),
      x: clamp01(o.x), y: clamp01(o.y), w: Math.max(0.005, w), h: Math.max(0.005, h),
    };
    if (role) field.role = role;
    if (type === "signature" && !field.role) field.role = "EMPLOYEE";
    if (type !== "signature" && type !== "seal") {
      if (typeof o.mode === "string" && MODES.has(o.mode)) field.mode = o.mode as FieldMode;
      if (o.required === true && field.mode !== "auto") field.required = true;
      if (field.mode === "auto") {
        if (typeof o.source === "string" && SOURCES.has(o.source)) field.source = o.source;
        if (typeof o.text === "string" && o.text.trim()) field.text = o.text.trim().slice(0, 200);
      }
      if (type === "select" && Array.isArray(o.options))
        field.options = [...new Set(o.options.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 50)).filter(Boolean))].slice(0, 30);
      if (typeof o.fontSize === "number" && Number.isFinite(o.fontSize)) field.fontSize = Math.min(24, Math.max(6, Math.round(o.fontSize)));
      if (o.align === "center" || o.align === "right") field.align = o.align;
    }
    fields.push(field);
  }
  return fields.length ? { v: 1, fields } : null;
}

export const isSignField = (f: LayoutField) => f.type === "signature" || f.type === "seal";

/** 배치가 쓰는 칸 이름(서명·직인은 마커 이름) — 워드 양식의 templateFieldNames 와 같은 역할 */
export function layoutFieldNames(layout: TemplateLayout | null): string[] {
  const out: string[] = [];
  for (const f of layout?.fields ?? []) if (!out.includes(f.name)) out.push(f.name);
  return out;
}

/** 입력 칸의 종류·선택지 — 작성 화면(본부 입력)·서명 화면(직원 입력)이 체크박스/드롭다운/날짜를 맞게 그리도록 */
export function layoutFieldTypes(layout: TemplateLayout | null): LayoutFieldTypes {
  const out: LayoutFieldTypes = {};
  for (const f of layout?.fields ?? []) {
    if (isSignField(f) || out[f.name]) continue;
    out[f.name] = { type: f.type, ...(f.options?.length ? { options: f.options } : {}) };
  }
  return out;
}

/**
 * 배치 → 1단계 칸 설정. 서명·직인·보호 칸은 뺀다. 같은 이름이 여러 칸이면 첫 칸의 설정(필수는 하나라도 있으면).
 * 시스템 값 이름(직원명·주소·생년월일…)을 「자동 입력」으로 둔 칸은 설정을 남기지 않는다 — 설정 없음 = 종전 규칙이라
 * 주소·생년월일이 비어 있으면 서명 때 직원에게 묻는다(워드 {주소} 와 같게, 10/13 검증 6).
 */
export function layoutToFieldSettings(layout: TemplateLayout | null): FieldSettings {
  const out: FieldSettings = {};
  for (const f of layout?.fields ?? []) {
    if (isSignField(f) || PROTECTED_FIELDS.has(f.name)) continue;
    if (f.mode === "auto" && !f.source && !f.text && SOURCES.has(f.name) && !f.required) continue;
    const cur = out[f.name] ?? {};
    if (!cur.mode && f.mode) cur.mode = f.mode;
    if (f.required) cur.required = true;
    if (f.mode === "auto" && !cur.source && !cur.text) { if (f.source) cur.source = f.source; if (f.text) cur.text = f.text; }
    if (Object.keys(cur).length) out[f.name] = cur;
  }
  return out;
}

/** 감사 기록용 — 추가·삭제·이동·설정 변경을 칸 단위로 */
export function layoutDiff(before: TemplateLayout | null, after: TemplateLayout | null): string[] {
  const label = (f: LayoutField) => {
    const parts = [LAYOUT_TYPES.find((t) => t.value === f.type)?.label ?? f.type, `${f.page}쪽`];
    if (f.role) parts.push(LAYOUT_ROLES.find((r) => r.value === f.role)?.label ?? f.role);
    if (f.mode) parts.push(FIELD_MODES.find((m) => m.value === f.mode)?.label ?? f.mode);
    if (f.required) parts.push("필수");
    if (f.source) parts.push(`출처 ${f.source}`);
    if (f.text) parts.push(`문구 「${f.text}」`);
    if (f.options?.length) parts.push(`선택지 ${f.options.length}개`);
    return parts.join("·");
  };
  const pos = (f: LayoutField) => [f.x, f.y, f.w, f.h].map((n) => Math.round(n * 1000)).join(",");
  const a = new Map((before?.fields ?? []).map((f) => [f.id, f]));
  const b = new Map((after?.fields ?? []).map((f) => [f.id, f]));
  const out: string[] = [];
  for (const [id, f] of b) {
    const o = a.get(id);
    if (!o) { out.push(`{${f.name}} 추가(${label(f)})`); continue; }
    const changes: string[] = [];
    if (o.name !== f.name) changes.push(`이름 ${o.name}→${f.name}`);
    if (label(o) !== label(f)) changes.push(`${label(o)}→${label(f)}`);
    if (pos(o) !== pos(f)) changes.push("위치·크기");
    if (changes.length) out.push(`{${f.name}} ${changes.join(", ")}`);
  }
  for (const [id, o] of a) if (!b.has(id)) out.push(`{${o.name}} 삭제`);
  return out;
}

