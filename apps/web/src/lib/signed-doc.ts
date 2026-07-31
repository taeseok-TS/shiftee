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

export type Signer = { label: string; name: string; date: Date | null; sigPath: string };

// 인라인 서명 이미지 drawing XML (문장 안 (인) 자리에 들어가는 작은 도장 크기)
// square=true면 정사각 직인 크기(1.7cm), 아니면 손서명 비율(2.86cm x 1cm)
function inlineSigDrawing(rId: string, docPrId: number, square = false): string {
  const cx = square ? 612000 : 1080000, cy = square ? 612000 : 378000;
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
  // 결재란 서명 — 직원 외 결재자를 순서대로: 첫 결재자=원장, 마지막 결재자=본부
  const mgrSigner = approverSigners[0] || null;         // 원장(첫 결재)
  const hqSigner = approverSigners[approverSigners.length - 1] || null; // 본부(마지막 결재)
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

    let docPrId = 200;
    const targets: { marker: string; signer: Signer | null; media: string; rId: string; imagePath?: string; square?: boolean }[] = [
      { marker: "《근로자서명》", signer: employeeSigner, media: "inlineSigEmp.png", rId: "rIdInlineSigEmp" },
      // 대표 (인): 직인 파일이 있으면 직인, 없으면 최종 결재자 손서명 (하위 호환)
      sealExists
        ? { marker: "《대표서명》", signer: repSigner, media: "inlineSealRep.png", rId: "rIdInlineSealRep", imagePath: SEAL_PATH, square: true }
        : { marker: "《대표서명》", signer: repSigner, media: "inlineSigRep.png", rId: "rIdInlineSigRep" },
      // 결재란 원장/본부 — 각 결재자의 손서명 (사직원 등 결재 박스 문서)
      { marker: "《원장서명》", signer: mgrSigner, media: "inlineSigMgr.png", rId: "rIdInlineSigMgr" },
      { marker: "《본부서명》", signer: hqSigner, media: "inlineSigHq.png", rId: "rIdInlineSigHq" },
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
      // 마커가 있는 텍스트 run을 쪼개서 그 자리에 이미지 run 삽입 (여러 곳이면 전부)
      while (docXml.includes(t.marker)) {
        docXml = docXml.replace(
          t.marker,
          `</w:t></w:r><w:r>${inlineSigDrawing(t.rId, docPrId++, t.square)}</w:r><w:r><w:t xml:space="preserve">`
        );
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
      approvalLine: { include: { steps: { orderBy: { order: "asc" }, include: { approver: { select: { name: true } } } } } },
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
