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
import { PDFDocument, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fs from "fs/promises";
import path from "path";
import { embedKoreanFont } from "@/lib/pdf-korean-font";
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

// ─── PDF 그리기 ───────────────────────────────────────────────────────────────────────────────
// 체크로 치는 값 — 작성·서명 화면은 ☑ 를 보내고, 본부가 글자로 적은 O/V/예/동의 도 체크로 본다
const CHECKED = new Set(["☑", "☒", "✓", "✔", "1", "true", "on", "y", "yes", "o", "v", "예", "네", "동의", "동의함", "체크", "해당"]);
const EMPTY_SIGN_MARK = /^《.*》$/;
type Box = { x: number; y: number; w: number; h: number };   // 보이는 쪽 기준(pt), 원점 왼쪽 위
type Pt = { x: number; y: number };

/**
 * 보이는 쪽(PDF.js viewport: CropBox 크기, /Rotate 반영) ↔ pdf-lib 쪽 좌표(CropBox 무시한 원점, 회전 전) 변환.
 * 편집기는 보이는 쪽 비율로 저장하므로, 여기서 보이는 좌표(왼쪽 위 원점, 아래로 +y)를 회전 전 좌표(왼쪽 아래 원점)로 되돌린다.
 */
function pageFrame(page: PDFPage) {
  const cb = page.getCropBox();   // CropBox 가 없으면 pdf-lib 이 MediaBox 를 준다
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const swap = angle === 90 || angle === 270;
  const W = swap ? cb.height : cb.width, H = swap ? cb.width : cb.height;   // 보이는 쪽 크기
  // 보이는 점 (dx, dy) → pdf-lib 점. 회전 90 = 시계 방향으로 눕혀 보이는 쪽: 보이는 왼쪽 위 = 회전 전 왼쪽 아래
  const toPage = (dx: number, dy: number): Pt => {
    if (angle === 90) return { x: cb.x + dy, y: cb.y + dx };
    if (angle === 180) return { x: cb.x + cb.width - dx, y: cb.y + dy };
    if (angle === 270) return { x: cb.x + cb.width - dy, y: cb.y + cb.height - dx };
    return { x: cb.x + dx, y: cb.y + cb.height - dy };
  };
  const rotate = degrees(angle);
  return {
    W, H, angle, rotate,
    box: (f: LayoutField): Box => ({ x: f.x * W, y: f.y * H, w: f.w * W, h: f.h * H }),
    /** 글자 — 보이는 좌표의 기준선 왼쪽 끝을 원점으로, 회전만큼 돌려 그린다 */
    text: (font: PDFFont, s: string, dx: number, baselineDy: number, size: number, color: ReturnType<typeof rgb>) => {
      const p = toPage(dx, baselineDy);
      page.drawText(s, { x: p.x, y: p.y, size, font, color, rotate });
    },
    /** 이미지 — 보이는 상자의 왼쪽 아래 모서리를 원점으로 회전만큼 돌려 그린다(pdf-lib 은 원점 기준 회전) */
    image: (img: PDFImage, b: Box) => {
      const p = toPage(b.x, b.y + b.h);
      page.drawImage(img, { x: p.x, y: p.y, width: b.w, height: b.h, rotate });
    },
    rect: (b: Box, color: ReturnType<typeof rgb>, opacity: number) => {
      const p = toPage(b.x, b.y + b.h);
      page.drawRectangle({ x: p.x, y: p.y, width: b.w, height: b.h, color, opacity, rotate });
    },
    line: (a: Pt, b: Pt, thickness: number) => {
      page.drawLine({ start: toPage(a.x, a.y), end: toPage(b.x, b.y), thickness, color: rgb(0.05, 0.05, 0.05) });
    },
  };
}
type Frame = ReturnType<typeof pageFrame>;

/** 글자를 칸 너비에 맞춰 줄로 나눈다 — 공백에서 끊고, 공백 없는 긴 한글은 글자 단위로 */
function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const ch of para) {
      const cand = line + ch;
      if (font.widthOfTextAtSize(cand, size) <= maxW || !line) { line = cand; continue; }
      const sp = line.lastIndexOf(" ");
      if (sp > 0 && ch !== " ") { lines.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch; }
      else { lines.push(line); line = ch === " " ? "" : ch; }
    }
    lines.push(line);
  }
  return lines;
}

function drawTextInBox(fr: Frame, font: PDFFont, text: string, box: Box, opts: { size: number; align?: "left" | "center" | "right"; color?: ReturnType<typeof rgb> }) {
  const pad = 2;
  const maxW = Math.max(4, box.w - pad * 2);
  let size = opts.size;
  let lines = wrapText(text, font, size, maxW);
  // 칸 높이를 넘치면 글자를 줄인다(최소 6pt) — 긴 주소·사유가 칸 밖으로 새지 않게
  while (size > 6 && lines.length * size * 1.25 > box.h - pad * 2) { size -= 1; lines = wrapText(text, font, size, maxW); }
  const lineH = size * 1.25;
  // 여러 줄은 위에서부터, 한 줄이면 세로 가운데(양식의 밑줄·칸 선과 맞게). 보이는 좌표(아래로 +y)의 기준선 위치
  let baseline = lines.length === 1 ? box.y + (box.h + size) / 2 - size * 0.12 : box.y + pad + size;
  const color = opts.color ?? rgb(0.05, 0.05, 0.05);
  for (const line of lines) {
    const w = font.widthOfTextAtSize(line, size);
    const x = opts.align === "center" ? box.x + (box.w - w) / 2 : opts.align === "right" ? box.x + box.w - pad - w : box.x + pad;
    try { fr.text(font, line, x, baseline, size, color); } catch { /* 글꼴에 없는 글자 — 이 줄만 건너뛴다 */ }
    baseline += lineH;
    if (baseline > box.y + box.h + size) break;
  }
}

function drawCheck(fr: Frame, box: Box) {
  const s = Math.min(box.w, box.h) * 0.8;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const th = Math.max(1, s * 0.12);
  // 보이는 좌표(아래로 +y): 왼쪽 중간 → 아래 → 오른쪽 위
  fr.line({ x: cx - s * 0.4, y: cy }, { x: cx - s * 0.1, y: cy + s * 0.32 }, th);
  fr.line({ x: cx - s * 0.1, y: cy + s * 0.32 }, { x: cx + s * 0.42, y: cy - s * 0.36 }, th);
}

async function embedImageFile(doc: PDFDocument, file: string): Promise<PDFImage | null> {
  try {
    const buf = await fs.readFile(file);
    if (buf[0] === 0x89 && buf[1] === 0x50) return await doc.embedPng(buf);
    if (buf[0] === 0xff && buf[1] === 0xd8) return await doc.embedJpg(buf);
    return null;
  } catch { return null; }
}
const fitBox = (img: PDFImage, box: Box): Box => {
  const r = Math.min(box.w / img.width, box.h / img.height);
  const w = img.width * r, h = img.height * r;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
};

export type LayoutSigner = { role: LayoutRole | "seal"; imagePath: string };

/**
 * PDF 양식에 값을 그린다. 서명·직인 칸은 signers 가 주어진 역할만 얹는다(없으면 비워 둔다 — 서명 전 문서).
 * 서명 이미지를 못 읽으면 **던진다**(서명 없는 완료본이 조용히 저장되지 않게, 10/13 검증 9).
 * highlight: 미리보기용 — 값에 노란 바탕, 빈 본부 칸은 붉은 〔미입력〕, 서명 때 직원이 적는 칸은 〔계약자 입력〕.
 */
export async function fillPdfLayout(
  src: Buffer, layout: TemplateLayout, data: Record<string, string>,
  opts: { highlight?: boolean; signers?: LayoutSigner[]; isEmployeeInput?: (name: string) => boolean } = {},
): Promise<Buffer> {
  const doc = await PDFDocument.load(src, { ignoreEncryption: true });
  // 글꼴은 글자를 처음 그릴 때만 넣는다(통째로 2.5MB) — 서명만 얹는 호출(stampLayoutSignatures)이 글꼴을 한 벌 더 넣지 않게
  let fontP: Promise<PDFFont> | null = null;
  const font = () => (fontP ??= embedKoreanFont(doc).catch(() => doc.embedFont("Helvetica")));
  const pages = doc.getPages();
  const frames = new Map<number, Frame>();
  const frameOf = (n: number) => { let f = frames.get(n); if (!f) { f = pageFrame(pages[n - 1]); frames.set(n, f); } return f; };
  const imgCache = new Map<string, PDFImage | null>();
  const image = async (file: string) => { if (!imgCache.has(file)) imgCache.set(file, await embedImageFile(doc, file)); return imgCache.get(file) ?? null; };
  for (const f of layout.fields) {
    if (!pages[f.page - 1]) continue;
    const fr = frameOf(f.page);
    const box = fr.box(f);
    if (isSignField(f)) {
      const role = f.type === "seal" ? "seal" : (f.role ?? "EMPLOYEE");
      const s = opts.signers?.find((x) => x.role === role);
      if (s) {
        const img = await image(s.imagePath);
        if (!img) throw new Error(`서명 이미지를 읽지 못했습니다(${role}): ${path.basename(s.imagePath)}`);
        fr.image(img, fitBox(img, box));
      } else if (opts.highlight) {
        drawTextInBox(fr, await font(), f.type === "seal" ? "〔직인 자리〕" : `〔${LAYOUT_ROLES.find((r) => r.value === f.role)?.label ?? "직원"} 서명 자리〕`, box, { size: 8, align: "center", color: rgb(0.45, 0.45, 0.45) });
      }
      continue;
    }
    const raw = data[f.name] ?? "";
    const value = EMPTY_SIGN_MARK.test(raw) ? "" : raw;
    if (f.type === "checkbox") {
      const v = value.trim();
      if (CHECKED.has(v) || CHECKED.has(v.toLowerCase())) drawCheck(fr, box);
      continue;
    }
    if (f.type === "image") {
      if (value.startsWith("/api/uploads/") && !value.includes("..")) {
        const img = await image(path.join(process.cwd(), "uploads", value.replace(/^\/api\/uploads\//, "")));
        if (img) fr.image(img, fitBox(img, box));
      }
      continue;
    }
    if (!value) {
      if (opts.highlight) {
        const signTime = f.mode === "sign" || (!f.mode && opts.isEmployeeInput?.(f.name));
        drawTextInBox(fr, await font(), signTime ? "〔계약자 입력〕" : "〔미입력〕", box, { size: Math.min(f.fontSize ?? 10, 9), align: f.align, color: rgb(0.8, 0, 0) });
      }
      continue;
    }
    if (opts.highlight) fr.rect(box, rgb(1, 0.95, 0.4), 0.45);
    drawTextInBox(fr, await font(), value, box, { size: f.fontSize ?? 10, align: f.align });
  }
  return Buffer.from(await doc.save());
}

/** 서명 완료본 — 이미 값이 들어간 문서(계약 fileUrl)에 서명·직인만 얹는다 */
export async function stampLayoutSignatures(src: Buffer, layout: TemplateLayout, signers: LayoutSigner[]): Promise<Buffer> {
  const signOnly: TemplateLayout = { v: 1, fields: layout.fields.filter(isSignField) };
  if (!signOnly.fields.length || !signers.length) return src;
  return fillPdfLayout(src, signOnly, {}, { signers });
}

export const hasSignFields = (layout: TemplateLayout | null) => !!layout?.fields.some(isSignField);

/** PDF 쪽 수(파일 교체 때 배치가 맞는지 보는 용도). 못 읽으면 null */
export async function pdfPageCount(buf: Buffer): Promise<number | null> {
  try { return (await PDFDocument.load(buf, { ignoreEncryption: true })).getPageCount(); } catch { return null; }
}
