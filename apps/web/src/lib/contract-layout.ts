// ─── PDF 양식 칸 배치 — 서버 그리기(pdf-lib). 타입·파서는 lib/contract-layout-core.ts(순수, 브라우저 공용)
import { PDFDocument, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fs from "fs/promises";
import path from "path";
import { embedKoreanFont } from "@/lib/pdf-korean-font";
import { LAYOUT_ROLES, isSignField, type LayoutField, type LayoutRole, type TemplateLayout } from "@/lib/contract-layout-core";
export * from "@/lib/contract-layout-core";

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
