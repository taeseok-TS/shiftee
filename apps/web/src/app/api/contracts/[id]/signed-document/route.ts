import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import PizZip from "pizzip";
import fs from "fs/promises";
import path from "path";

// 한글 PDF 폰트 경로. 배포 환경(Linux 컨테이너)에서는 FONT_PATH 환경변수로 지정,
// 로컬(Windows) 개발 시에는 기본값(맑은 고딕) 사용.
const MALGUN = process.env.FONT_PATH || "C:/Windows/Fonts/malgun.ttf";

function firstFile(fileUrl: string): string | null {
  try {
    const arr = JSON.parse(fileUrl);
    return Array.isArray(arr) ? arr[0] : fileUrl;
  } catch {
    return fileUrl || null;
  }
}
function diskPath(url: string): string {
  const rel = url.replace(/^\/api\/uploads\//, "");
  return path.join(process.cwd(), "uploads", rel);
}
const fmt = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "");

type Signer = { label: string; name: string; date: Date | null; sigPath: string };

// ── 워드(.docx)에 서명 섹션 합성 ──
async function buildSignedDocx(origPath: string, title: string, signers: Signer[]): Promise<Buffer> {
  const zip = new PizZip(await fs.readFile(origPath));

  // 1) Content_Types에 png 등록
  let ct = zip.file("[Content_Types].xml")!.asText();
  if (!ct.includes('Extension="png"')) {
    ct = ct.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>');
    zip.file("[Content_Types].xml", ct);
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
async function buildSignedPdf(origPath: string | null, title: string, signers: Signer[]): Promise<Buffer> {
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, branch: true } },
      approvalLine: { include: { steps: { orderBy: { order: "asc" }, include: { approver: { select: { name: true } } } } } },
    },
  });
  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });

  // 권한: 관리자 / 본인 / 같은 지점 원장
  const allowed =
    session.role === "ADMIN" ||
    contract.userId === session.userId ||
    (session.role === "MANAGER" && contract.user.branch === session.branch);
  if (!allowed) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  if (contract.status !== "SIGNED")
    return NextResponse.json({ error: "아직 서명이 완료되지 않은 계약서입니다." }, { status: 400 });

  // 서명자 목록 구성
  const steps = contract.approvalLine?.steps || [];
  const signers: Signer[] = [];
  for (const st of steps) {
    if (!st.signatureUrl) continue;
    signers.push({
      label: st.approverId === contract.userId ? "직원 서명" : `${st.order}단계 결재`,
      name: st.approver.name,
      date: st.decidedAt,
      sigPath: diskPath(st.signatureUrl),
    });
  }
  if (signers.length === 0)
    return NextResponse.json({ error: "서명 정보가 없습니다." }, { status: 400 });

  const orig = firstFile(contract.fileUrl);
  const isDocx = !!orig && orig.toLowerCase().endsWith(".docx");

  try {
    if (isDocx) {
      const buf = await buildSignedDocx(diskPath(orig!), contract.title, signers);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(contract.title + "_서명완료.docx")}`,
        },
      });
    } else {
      const buf = await buildSignedPdf(orig ? diskPath(orig) : null, contract.title, signers);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(contract.title + "_서명완료.pdf")}`,
        },
      });
    }
  } catch (e) {
    console.error("서명본 생성 오류:", e);
    return NextResponse.json({ error: "서명본 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
