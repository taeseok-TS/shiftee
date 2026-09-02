import { prisma } from "@/lib/db";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import PizZip from "pizzip";
import fs from "fs/promises";
import path from "path";

// 한글 PDF 폰트 경로. 배포 환경(Linux 컨테이너)에서는 FONT_PATH 환경변수로 지정,
// 로컬(Windows) 개발 시에는 기본값(맑은 고딕) 사용.
const MALGUN = process.env.FONT_PATH || "C:/Windows/Fonts/malgun.ttf";

export function firstFile(fileUrl: string): string | null {
  try {
    const arr = JSON.parse(fileUrl);
    return Array.isArray(arr) ? arr[0] : fileUrl;
  } catch {
    return fileUrl || null;
  }
}
export function diskPath(url: string): string {
  const rel = url.replace(/^\/api\/uploads\//, "");
  return path.join(process.cwd(), "uploads", rel);
}
const fmt = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "");

export type Signer = { label: string; name: string; date: Date | null; sigPath: string; role?: string | null };

// 이미지 픽셀 크기 읽기 (PNG IHDR / JPEG SOF) — 서명 이미지의 실제 가로세로비를 알아야
// 줄 높이에 맞춰 넣어도 눌리거나 늘어나지 않는다. 외부 라이브러리 없이 헤더만 파싱한다.
function imageSize(buf: Buffer): { w: number; h: number } | null {
  try {
    // PNG: 8바이트 시그니처 + IHDR(길이4+타입4) → 폭·높이 각 4바이트
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    // JPEG: SOF0~SOF3 마커에서 높이·폭
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xc3) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch { /* 헤더가 예상과 다르면 비율 계산 생략 */ }
  return null;
}

// 서명·직인 크기와 위치 (디렉터 확정 2026-09-01, #184·#185·#198)
//
//  · 결재 표 칸  → 칸을 채운다 (targetCy 로 행 높이 기준 크기를 받는다). 인라인.
//  · 본문 (인) 자리 → 높이 1.0cm 로 키우고, "떠 있는" 이미지로 넣어 글자 줄 가운데에 맞춘다.
//
// 왜 떠 있는 이미지인가: 인라인 이미지는 아래 끝이 글자 바닥선에 놓여서, 이미지가 글자보다
// 크면 무조건 위로 솟는다(#185 "직인만 위로 올라감"). 이걸 내리려고 w:position 을 줬더니
// **변환기(LibreOffice)가 무시**했다 — 값만 바꾼 PDF 4개가 바이트까지 동일했다(2026-09-01 실측).
// wp:anchor + positionV 는 반영되므로 그쪽으로 넣는다.
const BODY_SIG_CY = 360000;        // 본문 서명·직인 높이 1.0cm
const SIG_OFF_V = -90000;          // 줄 기준 0.25cm 위 — 이름 글자와 위아래가 맞는 지점
const SIG_OFF_H = 72000;           // 이름 끝에서 0.2cm 띄움
const SIG_MAX_CX = 2160000;        // 가로 상한 6cm — 길게 흘려 쓴 서명이 칸을 넘지 않게
export const SIG_AFTER_TW = 500;   // 서명 줄 아래 여백 25pt (서명이 표 선에 닿지 않게)
// 우측 정렬 줄에서 서명 오른쪽에 남길 여백.
// 227(0.4cm)을 줬더니 실물에서 여유가 0 이 되어 서명이 표 선에 닿았다 — 우측 정렬 줄은
// 끝의 공백이 버려져 글자 끝 위치가 계산과 어긋난다. 실측으로 두 배를 준다(2026-09-01).
export const SIG_RIGHT_PAD = 454;

// maxCx: 삽입 위치(표 셀)의 폭 상한(EMU) — 칸보다 크면 비율 유지로 축소해 칸 밖 이탈 방지 (#132, 2026-08-27)
function inlineSigDrawing(
  rId: string, docPrId: number, square = false, maxCx?: number, ratio?: number,
  opts?: { targetCy?: number; baseline?: boolean }
): string {
  let cy = opts?.targetCy ?? (opts?.baseline ? BODY_SIG_CY : square ? 270000 : 198000);
  // 가로: 이미지 실제 비율대로 (비율을 못 읽으면 종래 비율로 폴백)
  let cx = ratio && ratio > 0 ? Math.round(cy * ratio) : (square ? 270000 : Math.round(cy * (1080000 / 378000)));
  // 손서명이 지나치게 길어지지 않게 상한 (가로로 흘려 쓴 서명 대비)
  // 결재 칸을 채울 때(targetCy)는 상한을 걸지 않는다 — 칸 크기가 이미 상한이다
  const HARD_MAX = opts?.targetCy ? Infinity : opts?.baseline ? SIG_MAX_CX : square ? 360000 : 1300000;
  if (cx > HARD_MAX) { cy = Math.round((cy * HARD_MAX) / cx); cx = HARD_MAX; }
  if (maxCx && maxCx > 0 && cx > maxCx) {
    cy = Math.round((cy * maxCx) / cx);
    cx = maxCx;
  }
  // 본문 (인) 자리 — 떠 있는 이미지로 넣어 줄 기준으로 위치를 잡는다.
  // 글자를 밀지 않으므로, 부르는 쪽에서 문단 오른쪽에 자리를 비워 준다(sigWidthTw).
  if (opts?.baseline) {
    return (
      `<w:drawing>` +
      `<wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
      `<wp:simplePos x="0" y="0"/>` +
      `<wp:positionH relativeFrom="character"><wp:posOffset>${SIG_OFF_H}</wp:posOffset></wp:positionH>` +
      `<wp:positionV relativeFrom="line"><wp:posOffset>${SIG_OFF_V}</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:wrapNone/><wp:docPr id="${docPrId}" name="sig${docPrId}"/>` +
      `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="sig${docPrId}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`
    );
  }
  return (
    `<w:drawing>` +
    `<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="inlineSig${docPrId}"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="inlineSig${docPrId}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
  );
}

// 서명이 들어가는 문단을 손본다 (2026-09-01)
//  ① 아래 여백 — 서명을 1.0cm 로 키웠으니 그대로 두면 표 아래 선에 닿는다
//  ② 우측 정렬 줄이면 오른쪽에 서명 자리를 비운다 — 떠 있는 이미지는 글자를 밀지 않아서,
//     이름이 이미 오른쪽 끝에 붙어 있으면 서명이 표 밖으로 나간다(#185 서약서에서 실제로 났다).
//     ※ 공백 문자로는 안 된다. 우측 정렬 줄 끝의 공백은 렌더링에서 버려진다(실측).
// OOXML `CT_PPr` 는 자식 순서가 **고정**이다. 순서를 어기면 렌더러(LibreOffice)가 그 요소를
// 조용히 무시하고, 최악에는 pPr 전체를 버려 정렬.스타일까지 날아간다.
// 2026-09-01 에 w:ind 를 w:jc 뒤에 넣었다가 서명이 페이지 밖으로 나갔고, 그때 w:ind 만
// 특례로 고쳤다. 2026-09-02 검증에서 **w:spacing 이 같은 함정에 걸려 있는 것**이 드러났다 —
// pPr 이 <w:pStyle> 로 시작하는 템플릿(코디 근로계약서 4종.임신기 신청서 2종, 10곳)에서
// spacing 이 pStyle 앞에 들어가 순서 위반이 됐다. 이제 특례 없이 스펙 순서대로 넣는다.
const PPR_ORDER = [
  "w:pStyle", "w:keepNext", "w:keepLines", "w:pageBreakBefore", "w:framePr", "w:widowControl",
  "w:numPr", "w:suppressLineNumbers", "w:pBdr", "w:shd", "w:tabs", "w:suppressAutoHyphens",
  "w:kinsoku", "w:wordWrap", "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE",
  "w:autoSpaceDN", "w:bidi", "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind",
  "w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc", "w:textDirection",
  "w:textAlignment", "w:textboxTightWrap", "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr",
  "w:sectPr", "w:pPrChange",
];

/** pPr 의 **최상위** 자식만 훑는다 (w:rPr 안의 w:spacing 같은 런 속성을 문단 것으로 오인하지 않게) */
function pPrTopChildren(inner: string): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  const re = /<(\/?)(w:[A-Za-z0-9]+)((?:"[^"]*"|[^>"])*?)(\/?)>/g;
  let depth = 0;
  let m: RegExpExecArray | null;
  let openName = "";
  let openStart = 0;
  while ((m = re.exec(inner))) {
    const isClose = m[1] === "/";
    const name = m[2];
    const selfClose = m[4] === "/";
    if (isClose) {
      depth--;
      if (depth === 0 && name === openName) out.push({ name, start: openStart, end: re.lastIndex });
      continue;
    }
    if (depth === 0) {
      if (selfClose) out.push({ name, start: m.index, end: re.lastIndex });
      else { openName = name; openStart = m.index; }
    }
    if (!selfClose) depth++;
  }
  return out;
}

/** pPr 에 자식을 **스펙 순서에 맞는 자리**로 넣는다. pPr 이 없으면 만든다. */
function putInPPr(para: string, tagName: string, tagXml: string): string {
  const pprRe = /<w:pPr(?:\s(?:"[^"]*"|[^>"])*)?>([\s\S]*?)<\/w:pPr>/;
  const m = pprRe.exec(para);
  if (!m) {
    // <w:pPr/> (빈 자기닫음) 또는 pPr 자체가 없음
    if (/<w:pPr\s*\/>/.test(para)) return para.replace(/<w:pPr\s*\/>/, `<w:pPr>${tagXml}</w:pPr>`);
    return para.replace(/<w:p(\s(?:"[^"]*"|[^>"])*)?>/, (open) => `${open}<w:pPr>${tagXml}</w:pPr>`);
  }
  const inner = m[1];
  const innerStart = m.index + m[0].indexOf(inner);
  const myIdx = PPR_ORDER.indexOf(tagName);
  const after = pPrTopChildren(inner).find((c) => {
    const i = PPR_ORDER.indexOf(c.name);
    return i === -1 ? false : i > myIdx;
  });
  const at = after ? innerStart + after.start : innerStart + inner.length;
  return para.slice(0, at) + tagXml + para.slice(at);
}

// 서명이 들어가는 문단을 손본다 (2026-09-01)
//  ① 아래 여백 — 서명을 1.0cm 로 키웠으니 그대로 두면 표 아래 선에 닿는다
//  ② 우측 정렬 줄이면 오른쪽에 서명 자리를 비운다 — 떠 있는 이미지는 글자를 밀지 않아서,
//     이름이 이미 오른쪽 끝에 붙어 있으면 서명이 표 밖으로 나간다(#185 서약서에서 실제로 났다).
//     ※ 공백 문자로는 안 된다. 우측 정렬 줄 끝의 공백은 렌더링에서 버려진다(실측).
function padSigParagraph(para: string, sigCx: number): string {
  let out = para;
  // pPr 의 최상위 자식만 본다 — 런 속성(<w:rPr><w:spacing w:val=..>)을 문단 여백으로 오인하면
  // 엉뚱한 속성에 w:after 를 붙이고 정작 여백은 안 생긴다.
  const pprInner = /<w:pPr(?:\s(?:"[^"]*"|[^>"])*)?>([\s\S]*?)<\/w:pPr>/.exec(out)?.[1] ?? "";
  const pprTop = pPrTopChildren(pprInner);
  const spacingTop = pprTop.find((c) => c.name === "w:spacing");

  // ① 아래 여백
  if (spacingTop) {
    const tag = pprInner.slice(spacingTop.start, spacingTop.end);
    const fixed = /w:after="\d+"/.test(tag)
      ? tag.replace(/w:after="\d+"/, `w:after="${SIG_AFTER_TW}"`)
      : tag.replace(/^<w:spacing/, `<w:spacing w:after="${SIG_AFTER_TW}"`);
    out = out.replace(tag, fixed);
  } else {
    out = putInPPr(out, "w:spacing", `<w:spacing w:after="${SIG_AFTER_TW}"/>`);
  }

  // ② 우측 정렬일 때만 오른쪽 자리 확보 (가운데 정렬은 이름 뒤에 이미 여유가 있다)
  if (out.includes('<w:jc w:val="right"/>')) {
    const rightTw = Math.round((sigCx + SIG_OFF_H) / 635) + SIG_RIGHT_PAD;
    const indTop = pPrTopChildren(
      /<w:pPr(?:\s(?:"[^"]*"|[^>"])*)?>([\s\S]*?)<\/w:pPr>/.exec(out)?.[1] ?? ""
    ).find((c) => c.name === "w:ind");
    if (indTop) {
      out = out.replace(/(<w:ind\s(?:"[^"]*"|[^>"])*?)(\s*\/?>)/, (full, head: string, tail: string) =>
        /w:right="\d+"/.test(head)
          ? head.replace(/w:right="\d+"/, `w:right="${rightTw}"`) + tail
          : `${head} w:right="${rightTw}"${tail}`
      );
    } else {
      out = putInPPr(out, "w:ind", `<w:ind w:right="${rightTw}"/>`);
    }
  }
  return out;
}

// 문단 안의 마커 + 뒤따르는 "(인)"/"(서명 또는 인)" 문구를 지우고 그 자리에 인라인 서명을 넣는다 (#105).
// 표기가 docxtemplater 치환으로 여러 w:t 노드에 걸쳐 있어도 동작하도록, 문단의 w:t 들을 이어붙인
// 텍스트 좌표에서 삭제 범위를 계산해 노드별로 걷어낸다. (마커·표기 문자에는 XML 엔티티가 없어
// 엔티티 중간이 잘릴 일은 없다 — 삭제 범위 밖 텍스트는 원문 그대로 복사)
function replaceMarkerAndSeal(para: string, marker: string, drawing: string): string {
  const parts: { s: number; e: number; text: string; openEnd: number }[] = [];
  const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(para))) {
    parts.push({ s: m.index, e: m.index + m[0].length, text: m[1], openEnd: m.index + m[0].indexOf(">") + 1 });
  }
  const concat = parts.map((p) => p.text).join("");
  const mi = concat.indexOf(marker);
  if (mi === -1) return para.split(marker).join("");
  const tail = concat.slice(mi + marker.length);
  const sm = tail.match(/^\s*\((?:서명\s*(?:또는|\/)\s*)?인\)/);
  const delStart = mi;
  const delEnd = mi + marker.length + (sm ? sm[0].length : 0);
  let out = "";
  let cursor = 0;
  let acc = 0;
  let inserted = false;
  for (const p of parts) {
    out += para.slice(cursor, p.s);
    const openTag = para.slice(p.s, p.openEnd);
    let keptBefore = "";
    let keptAfter = "";
    let hitStart = false;
    for (let i = 0; i < p.text.length; i++) {
      const g = acc + i;
      if (g === delStart) hitStart = true;
      if (g < delStart) keptBefore += p.text[i];
      else if (g >= delEnd) keptAfter += p.text[i];
    }
    if (hitStart && !inserted) {
      inserted = true;
      out += openTag + keptBefore + `</w:t></w:r><w:r>${drawing}</w:r><w:r><w:t xml:space="preserve">` + keptAfter + "</w:t>";
    } else {
      out += openTag + keptBefore + keptAfter + "</w:t>";
    }
    cursor = p.e;
    acc += p.text.length;
  }
  out += para.slice(cursor);
  return out;
}

// (구방식 — 현재 미사용, 이력 보존) 떠 있는(앵커) 서명 이미지 — 마커 뒤의 "(인)"/"(서명 / 인)" 표기 위에 겹쳐 찍는다.
// 모두싸인처럼 도장이 글자 위에 올라가는 모양 (개선 제안 2026-08-24).
// wrapNone 이라 글자 배치는 전혀 밀리지 않고, (인) 글자도 그대로 남는다.
// 위치는 마커 지점 기준: 가로 -3mm(이름 끝에 살짝 걸침), 세로는 줄 중앙에 오도록 위로.
function overlaySigDrawing(rId: string, docPrId: number, square = false): string {
  // 오버레이 손서명은 인라인(2.86cm)보다 작게 2.0cm — 넓으면 왼쪽 절반이 이름을 덮는다
  // (디렉터 실물 확인 2026-08-25: "서명이 이름을 덮어버린다")
  const cx = square ? 468000 : 756000, cy = square ? 468000 : 310000;
  // 가로: 이미지 중심이 앵커점(마커 자리) 오른쪽 8mm — "(인)" 위. 이름 침범은 2mm 이내
  const offH = -Math.round(cx / 2) + 288000;
  const offV = square ? -158000 : -80000; // 줄 높이(~4.2mm) 중앙 정렬
  return (
    `<w:drawing>` +
    `<wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="character"><wp:posOffset>${offH}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="line"><wp:posOffset>${offV}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:wrapNone/><wp:docPr id="${docPrId}" name="overlaySig${docPrId}"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="overlaySig${docPrId}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`
  );
}

// ── 워드(.docx)에 서명 섹션 합성 ──
// 템플릿에 서명 마커(《근로자서명》/《대표서명》)가 있으면 그 자리에 서명 이미지를 인라인 배치하고
// 말미에는 서명 일시 텍스트만 남긴다. 마커가 없으면 기존처럼 문서 끝에 서명 섹션을 붙인다.
export async function buildSignedDocx(origPath: string, title: string, signers: Signer[]): Promise<Buffer> {
  const zip = new PizZip(await fs.readFile(origPath));

  // 1) Content_Types에 png 등록
  let ct = zip.file("[Content_Types].xml")!.asText();
  if (!ct.includes('Extension="png"')) {
    ct = ct.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>');
    zip.file("[Content_Types].xml", ct);
  }

  const employeeSigner = signers.find((s) => s.label === "직원 서명") || null;
  const approverSigners = signers.filter((s) => s.label !== "직원 서명");
  const repSigner = approverSigners[approverSigners.length - 1] || null;
  // 결재란 서명 — 역할 기반 매핑 (2026-08-27 #111): 실운영 순서가 본부→원장→근로자라
  // "첫 결재자=원장" 순서 가정이 깨질 수 있다. role 이 있으면 원장=MANAGER, 본부=ADMIN 으로
  // 정확히 배정하고, role 정보가 없는 옛 경로에서는 종전 순서 가정으로 폴백.
  const mgrSigner = approverSigners.find((s) => s.role === "MANAGER") || (approverSigners.some((s) => s.role) ? null : approverSigners[0] || null);
  const hqSigner = approverSigners.find((s) => s.role === "ADMIN") || (approverSigners.some((s) => s.role) ? null : approverSigners[approverSigners.length - 1] || null);
  let docXml = zip.file("word/document.xml")!.asText();
  const hasMarkers = docXml.includes("《근로자서명》") || docXml.includes("《대표서명》")
    || docXml.includes("《원장서명》") || docXml.includes("《본부서명》");

  if (hasMarkers) {
    const relsPath = "word/_rels/document.xml.rels";
    let rels = zip.file(relsPath)?.asText()
      || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

    // 회사 직인 — 서버 비공개 경로(uploads/private, URL 서빙 차단됨). 있으면 대표 (인) 자리에 직인 사용
    const SEAL_PATH = path.join(process.cwd(), "uploads", "private", "seal.png");
    const sealExists = await fs.access(SEAL_PATH).then(() => true).catch(() => false);

    let docPrId = 900001; // 템플릿에 이미 든 그림(docPr id, 보통 1~수백)과 충돌하지 않게 큰 값에서 시작
    const targets: { marker: string; signer: Signer | null; media: string; rId: string; imagePath?: string; square?: boolean }[] = [
      { marker: "《근로자서명》", signer: employeeSigner, media: "inlineSigEmp.png", rId: "rIdInlineSigEmp" },
      // 대표 (인): 직인 파일이 있으면 직인, 없으면 최종 결재자 손서명 (하위 호환)
      sealExists
        ? { marker: "《대표서명》", signer: repSigner, media: "inlineSealRep.png", rId: "rIdInlineSealRep", imagePath: SEAL_PATH, square: true }
        : { marker: "《대표서명》", signer: repSigner, media: "inlineSigRep.png", rId: "rIdInlineSigRep" },
      // 결재란 원장 — 원장 개인의 손서명 (사직원 등 결재 박스 문서)
      { marker: "《원장서명》", signer: mgrSigner, media: "inlineSigMgr.png", rId: "rIdInlineSigMgr" },
      // 결재란 본부 — 본부(관리자) 결재는 회사 직인으로 통일 (디렉터 확정 2026-08-25).
      // 직인 파일이 없으면 종전대로 결재자 손서명
      sealExists
        ? { marker: "《본부서명》", signer: hqSigner, media: "inlineSealHq.png", rId: "rIdInlineSealHq", imagePath: SEAL_PATH, square: true }
        : { marker: "《본부서명》", signer: hqSigner, media: "inlineSigHq.png", rId: "rIdInlineSigHq" },
    ];
    for (const t of targets) {
      if (!docXml.includes(t.marker)) continue;
      if (!t.signer) {
        // 해당 서명자가 없으면 마커만 제거 (직인도 최종 결재 완료가 전제)
        docXml = docXml.split(t.marker).join("");
        continue;
      }
      const imgBuf = await fs.readFile(t.imagePath || t.signer.sigPath);
      zip.file(`word/media/${t.media}`, imgBuf);
      const dim = imageSize(imgBuf);
      const ratio = dim && dim.h > 0 ? dim.w / dim.h : undefined; // 실제 가로세로비 (#166)
      rels = rels.replace(
        "</Relationships>",
        `<Relationship Id="${t.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${t.media}"/></Relationships>`
      );
      // 마커 처리 (개선 제안 2026-08-24 2차 → 2026-08-25 재수리 — 모두싸인처럼 (인) "위에" 겹쳐 찍기):
      //  · 마커 뒤에 "(인)"/"(서명 / 인)"/"(서명 또는 인)" 표기가 이어지면 → 글자는 남기고
      //    떠 있는(앵커) 이미지를 그 위에 오버레이 (글자 배치 안 밀림)
      //  · 그 외(결재표 칸처럼 마커 단독) → 기존대로 인라인 이미지
      // 판정은 "같은 텍스트 노드"가 아니라 **마커가 든 문단 전체의 텍스트**로 한다 —
      // docxtemplater 가 {근로자서명} 치환값을 자기만의 run 에 넣어 "(인)"과 노드가 분리되고
      // (근로계약서류), "(서명 또는 인)" 같은 변형 표기도 있어 노드 단위 매치가 계속 새었다
      // (QA 2026-08-25 이예지대리 — "어떤 양식은 되고 어떤 양식은 안 됨"의 실체).
      // (#105, 2026-08-27 김가산·디렉터 확정) 오버레이 대신 모두싸인처럼 "(서명 또는 인)" 문구를
      // 지우고 그 자리에 인라인 서명을 넣는다 — 겹침·어긋남 원천 차단.
      const sealAfter = new RegExp(t.marker + "\\s*\\((?:서명\\s*(?:또는|/)\\s*)?인\\)");
      while (docXml.includes(t.marker)) {
        const idx = docXml.indexOf(t.marker);
        // 마커가 속한 문단(w:p) 범위의 순수 텍스트를 이어붙여 (인) 동반 여부 판정
        const pStart = docXml.lastIndexOf("<w:p", idx);
        const pEndTag = docXml.indexOf("</w:p>", idx);
        const paraEnd = pEndTag === -1 ? -1 : pEndTag + 6;
        const para = pStart !== -1 && pEndTag !== -1 ? docXml.slice(pStart, paraEnd) : "";
        const paraText = (para.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
          .map((x) => x.replace(/<[^>]+>/g, ""))
          .join("");
        // 마커가 표 셀 안이면 셀 폭(tcW)의 85%를 이미지 폭 상한으로 — 칸 밖 이탈 방지 (#132)
        let maxCx: number | undefined;
        {
          const lastOpen = docXml.lastIndexOf("<w:tc>", idx) >= docXml.lastIndexOf("<w:tc ", idx)
            ? docXml.lastIndexOf("<w:tc>", idx) : docXml.lastIndexOf("<w:tc ", idx);
          const lastClose = docXml.lastIndexOf("</w:tc>", idx);
          if (lastOpen !== -1 && lastOpen > lastClose) {
            const tcw = docXml.slice(lastOpen, idx).match(/<w:tcW[^>]*w:w="(\d+)"[^>]*w:type="dxa"/);
            if (tcw) maxCx = Math.round(Number(tcw[1]) * 635 * 0.85);
          }
        }
        const inCell = maxCx !== undefined;
        const isBody = Boolean(para) && sealAfter.test(paraText);
        // 결재 표 칸(마커 단독 + 표 셀 안)은 칸을 채운다 — 행 높이의 75% (#198).
        // 행 높이를 못 읽으면 종전 크기 그대로 둔다(표가 깨지는 것보다 작은 게 낫다).
        let targetCy: number | undefined;
        if (!isBody && inCell) {
          const trOpen = Math.max(docXml.lastIndexOf("<w:tr>", idx), docXml.lastIndexOf("<w:tr ", idx));
          const trClose = docXml.lastIndexOf("</w:tr>", idx);
          if (trOpen !== -1 && trOpen > trClose) {
            const h = docXml.slice(trOpen, idx).match(/<w:trHeight[^>]*w:val="(\d+)"/);
            if (h) targetCy = Math.round(Number(h[1]) * 635 * 0.75);
          }
        }
        const drawing = inlineSigDrawing(t.rId, docPrId++, t.square, maxCx, ratio, {
          targetCy,
          baseline: isBody,   // 글자 줄 옆에 들어갈 때만 세로 중앙 보정 (#185)
        });
        if (isBody) {
          // 문단 안에서 마커 + 뒤따르는 "(서명 또는 인)" 문구를 지우고 서명 이미지로 대체.
          // 서명이 1.0cm 로 커졌으니 문단 아래 여백과(우측 정렬이면) 오른쪽 자리도 함께 확보한다.
          const sigCx = Number(drawing.match(/<wp:extent cx="(\d+)"/)?.[1] || 0);
          const replaced = replaceMarkerAndSeal(para, t.marker, drawing);
          docXml = docXml.slice(0, pStart) + padSigParagraph(replaced, sigCx) + docXml.slice(paraEnd);
        } else {
          // 결재표 칸처럼 마커 단독 — 마커 자리에 인라인 이미지
          docXml =
            docXml.slice(0, idx) +
            `</w:t></w:r><w:r>${drawing}</w:r><w:r><w:t xml:space="preserve">` +
            docXml.slice(idx + t.marker.length);
        }
      }
    }
    zip.file(relsPath, rels);

    // 말미에 서명 일시 텍스트 (증빙용, 이미지는 본문 (인) 자리에 배치됨)
    const stamp = signers
      .map((s) => `${escapeXml(s.label)} ${escapeXml(s.name)} (${fmt(s.date)})`)
      .join(" · ");
    const footer = `<w:p><w:pPr><w:spacing w:before="240"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="888888"/></w:rPr><w:t xml:space="preserve">전자 서명 완료 — ${stamp}</w:t></w:r></w:p>`;
    const sIdx = docXml.lastIndexOf("<w:sectPr");
    docXml = sIdx !== -1 ? docXml.slice(0, sIdx) + footer + docXml.slice(sIdx) : docXml.replace("</w:body>", footer + "</w:body>");
    zip.file("word/document.xml", docXml);
    return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  }

  // 2) rels에 서명 이미지 관계 추가
  const relsPath = "word/_rels/document.xml.rels";
  let rels = zip.file(relsPath)?.asText()
    || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

  const drawings: string[] = [];
  for (let i = 0; i < signers.length; i++) {
    const s = signers[i];
    const rId = `rIdSig${i + 1}`;
    const mediaName = `sig${i + 1}.png`;
    zip.file(`word/media/${mediaName}`, await fs.readFile(s.sigPath));
    rels = rels.replace(
      "</Relationships>",
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`
    );
    // 라벨 문단 + 서명 이미지 문단 (이미지 약 200x70px → EMU)
    const cx = 1905000, cy = 666750;
    drawings.push(
      `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(s.label)} : ${escapeXml(s.name)}  (서명일 ${fmt(s.date)})</w:t></w:r></w:p>` +
      `<w:p><w:r><w:drawing>` +
      `<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" distT="0" distB="0" distL="0" distR="0">` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${100 + i}" name="sig${i + 1}"/>` +
      `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:nvPicPr><pic:cNvPr id="${100 + i}" name="sig${i + 1}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    );
  }
  zip.file(relsPath, rels);

  // 3) document.xml body 끝(sectPr 직전)에 서명 섹션 삽입
  let doc = zip.file("word/document.xml")!.asText();
  const heading =
    `<w:p><w:pPr><w:spacing w:before="240"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>■ 전자 서명</w:t></w:r></w:p>`;
  const block = heading + drawings.join("");

  const sectIdx = doc.lastIndexOf("<w:sectPr");
  if (sectIdx !== -1) {
    doc = doc.slice(0, sectIdx) + block + doc.slice(sectIdx);
  } else {
    doc = doc.replace("</w:body>", block + "</w:body>");
  }
  zip.file("word/document.xml", doc);

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}

// ── PDF에 서명 페이지 합성 ──
export async function buildSignedPdf(origPath: string | null, title: string, signers: Signer[]): Promise<Buffer> {
  const pdf = origPath && origPath.toLowerCase().endsWith(".pdf")
    ? await PDFDocument.load(await fs.readFile(origPath), { ignoreEncryption: true }).catch(() => null)
    : null;
  const doc = pdf || (await PDFDocument.create());

  doc.registerFontkit(fontkit);
  let font;
  try {
    font = await doc.embedFont(await fs.readFile(MALGUN), { subset: true });
  } catch {
    font = await doc.embedFont("Helvetica");
  }

  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  let y = height - 60;
  const draw = (text: string, size: number, x = 50) => { page.drawText(text, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) }); y -= size + 10; };

  draw("전자 서명 완료 증명", 20);
  y -= 6;
  draw(`계약서: ${title}`, 12);
  draw(`생성일: ${fmt(new Date())}`, 11);
  y -= 10;
  page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 24;

  for (const s of signers) {
    page.drawText(`${s.label} : ${s.name}   (서명일 ${fmt(s.date)})`, { x: 50, y, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
    y -= 12;
    try {
      const png = await doc.embedPng(await fs.readFile(s.sigPath));
      const w = 180, h = (png.height / png.width) * 180 || 60;
      page.drawImage(png, { x: 50, y: y - h, width: w, height: Math.min(h, 80) });
      y -= Math.min(h, 80) + 24;
    } catch {
      y -= 30;
    }
    page.drawLine({ start: { x: 50, y: y + 8 }, end: { x: width - 50, y: y + 8 }, thickness: 0.5, color: rgb(0.9, 0.9, 0.9) });
  }

  return Buffer.from(await doc.save());
}


// 계약 완료 시 서명본을 생성해 uploads에 저장하고 Contract.signedUrl 기록.
// 저장된 파일은 뷰어(MS 오피스)·앱 "서명 완료본 보기"에서 사용된다.
export async function generateAndStoreSignedDoc(contractId: string): Promise<string | null> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: {
      approvalLine: { include: { steps: { orderBy: { order: "asc" }, include: { approver: { select: { name: true, role: true } } } } } },
    },
  });
  if (!contract || contract.status !== "SIGNED") return null;

  const steps = contract.approvalLine?.steps || [];
  const signers: Signer[] = [];
  for (const st of steps) {
    if (!st.signatureUrl) continue;
    // 외부(미가입) 서명 단계는 approver가 없음 — 외부 계약자 = 근로자 서명으로 취급.
    // 외부 계약은 소유자(userId)가 작성 관리자라, 그 관리자의 결재 스텝까지 직원 서명으로
    // 오인하면 결재자 0명 → 대표 직인 미삽입. externalName 계약에서는 approverId 있는 스텝 전부 결재자.
    const isEmployeeStep = st.approverId
      ? st.approverId === contract.userId && !contract.externalName
      : true;
    signers.push({
      label: isEmployeeStep ? "직원 서명" : `${st.order}단계 결재`,
      name: st.approver?.name || st.externalName || "외부 서명자",
      date: st.decidedAt,
      sigPath: diskPath(st.signatureUrl),
      role: isEmployeeStep ? null : (st.approver as { role?: string } | null)?.role ?? null,
    });
  }
  if (signers.length === 0) return null;

  const orig = firstFile(contract.fileUrl);
  const isDocx = !!orig && orig.toLowerCase().endsWith(".docx");
  const buf = isDocx
    ? await buildSignedDocx(diskPath(orig!), contract.title, signers)
    : await buildSignedPdf(orig ? diskPath(orig) : null, contract.title, signers);
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}-signed.${isDocx ? "docx" : "pdf"}`;
  const dir = path.join(process.cwd(), "uploads", "contracts");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buf);
  const url = `/api/uploads/contracts/${filename}`;
  await prisma.contract.update({ where: { id: contractId }, data: { signedUrl: url } });
  return url;
}
