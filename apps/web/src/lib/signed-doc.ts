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

// 인라인 서명 이미지 drawing XML (문장 안 (인) 자리에 들어가는 작은 도장 크기)
// square=true면 정사각 직인 크기(1.3cm — 1.7cm가 너무 크다는 QA 2026-08-25 반영), 아니면 손서명 비율(2.86cm x 1cm)
function inlineSigDrawing(rId: string, docPrId: number, square = false): string {
  const cx = square ? 468000 : 1080000, cy = square ? 468000 : 378000;
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
      zip.file(`word/media/${t.media}`, await fs.readFile(t.imagePath || t.signer.sigPath));
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
        const drawing = inlineSigDrawing(t.rId, docPrId++, t.square);
        if (para && sealAfter.test(paraText)) {
          // 문단 안에서 마커 + 뒤따르는 "(서명 또는 인)" 문구를 지우고 인라인 서명으로 대체
          docXml = docXml.slice(0, pStart) + replaceMarkerAndSeal(para, t.marker, drawing) + docXml.slice(paraEnd);
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
