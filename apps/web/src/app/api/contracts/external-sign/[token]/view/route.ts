import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { verifyUploadTicket } from "@/lib/upload-ticket";
import { judgeGuestContract } from "@/lib/contract-access";
import { buildSignedDocx, buildSignedPdf, collectSigners, diskPath, firstFile, layoutForContractFile } from "@/lib/signed-doc";
import { bufferCacheKey, readCachedPdf, writeCachedPdf } from "@/lib/pdf-cache";
import { stampProgressPdf, stampTestPdf } from "@/lib/pdf-stamp";

// 외부(미가입) 계약자 — 서명 직후 화면의 문서 뷰어용 「내 서명이 반영된 문서」(2026-10-17 디렉터 지적:
// 「서명이 완료되면 계약서 PDF 에도 서명이 보여야 하는 거 아니냐」). 서명 뒤에도 뷰어가 서명 전 원본을 보여 줬다.
//  · 완료(SIGNED)면 고정 완료본 → 저장된 완료본, 진행 중이면 지금까지의 서명으로 그때그때 만든 진행본(사내 signed-document #110 과 같은 규칙)
//  · 증명: 링크 토큰 + 그 링크의 게스트 파일 티켓(?t=, 주체 c:<대표 계약>, 본인 확인 뒤에만 발급·2시간). iframe 이라 헤더를 못 싣는다
//  · 범위: 이 링크의 대표 문서와 같은 묶음의 외부 문서 중 **게스트가 서명을 마친 것만**. 정책은 judgeGuestFile 과 같다(none 이면 막는다)
const asBody = (b: Buffer) => new Uint8Array(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);

// 이 라우트는 서명 화면 iframe 이 연다 — 오류를 JSON 으로 주면 뷰어 자리에 JSON 글자가 그대로 보였다(검증 지적 4). 짧은 안내 HTML 로 준다
const esc = (t: string) => t.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]!));
function fail(status: number, msg: string) {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="margin:0;font-family:sans-serif;background:#f9fafb;color:#4b5563;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:16px;box-sizing:border-box">`
    + `<p style="font-size:14px;line-height:1.6;margin:0">${esc(msg)}</p></body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
const BUSY = "지금은 문서를 열 수 없습니다. 잠시 후 다시 시도해 주세요. 완료본은 모든 결재가 끝나면 이메일로 보내 드립니다.";

// 워드 → PDF(변환기). 같은 바이트면 디스크 캐시 — 키 문자열은 signed-document 와 같아 캐시를 함께 쓴다
async function docxToPdf(buf: Buffer, keyExtra: string): Promise<Buffer | null> {
  const key = bufferCacheKey(buf, keyExtra);
  const hit = await readCachedPdf(key);
  if (hit) return hit;
  try {
    const fd = new FormData();
    fd.append("files", new Blob([new Uint8Array(buf)]), "document.docx");
    const g = await fetch(`${process.env.GOTENBERG_URL || "http://gotenberg:3000"}/forms/libreoffice/convert`, { method: "POST", body: fd, signal: AbortSignal.timeout(60_000) });
    if (!g.ok) { console.error("[external-sign/view] PDF 변환 실패:", g.status); return null; }
    const pdf = Buffer.from(await g.arrayBuffer());
    void writeCachedPdf(key, pdf);
    return pdf;
  } catch (e) {
    console.error("[external-sign/view] PDF 변환 오류:", e);
    return null;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 32) return fail(404, "유효하지 않은 링크입니다.");
  const step = await prisma.contractApprovalStep.findUnique({
    where: { signToken: token },
    select: { approverId: true, status: true, approvalLine: { select: { contract: { select: { id: true, bundleId: true } } } } },
  });
  if (!step || step.approverId !== null) return fail(404, "유효하지 않은 링크입니다.");
  const rep = step.approvalLine.contract;
  // 게스트 파일 티켓 — 이 링크의 대표 계약 주체만 인정한다(다른 링크·사용자 티켓은 안 된다)
  const tk = verifyUploadTicket(request.nextUrl.searchParams.get("t"));
  if (!tk || tk.subject !== `c:${rep.id}`)
    return fail(403, "보기 시간이 지났습니다. 완료본은 모든 결재가 끝나면 이메일로 보내 드립니다.");
  if (step.status !== "APPROVED") return fail(400, "아직 서명하지 않은 링크입니다.");

  const docId = request.nextUrl.searchParams.get("doc") || rep.id;
  if (docId !== rep.id) {
    // 묶음 동반 문서 — 같은 묶음의 외부 문서만
    const sib = rep.bundleId
      ? await prisma.contract.findFirst({ where: { id: docId, bundleId: rep.bundleId, externalName: { not: null } }, select: { id: true } })
      : null;
    if (!sib) return fail(404, "문서를 찾을 수 없습니다.");
  }
  const contract = await prisma.contract.findUnique({
    where: { id: docId },
    include: { approvalLine: { include: { steps: { orderBy: { order: "asc" }, include: { approver: { select: { name: true, role: true, position: true } } } } } } },
  });
  if (!contract) return fail(404, "문서를 찾을 수 없습니다.");
  if (contract.status === "REJECTED") return fail(400, "반려된 계약입니다. 담당자에게 문의해 주세요.");
  // 게스트(외부 서명 단계)가 이 문서에 서명을 마쳤어야 한다 — 동반 문서 서명이 실패했으면 반영본이 아니다
  const guestStep = contract.approvalLine?.steps.find((s) => s.approverId === null);
  if (!guestStep || guestStep.status !== "APPROVED" || !guestStep.signatureUrl)
    return fail(400, "이 문서는 아직 서명이 반영되지 않았습니다. 담당자에게 문의해 주세요.");
  const acc = await judgeGuestContract(contract.id);
  if (!acc.allowed) return fail(acc.status, acc.error);

  const done = contract.status === "SIGNED";
  const name = `${contract.title}${done ? "_서명완료" : "_서명진행본"}.pdf`;
  // progress — 결재가 남은 진행본이면 「서명 진행본 — 최종 완료본 아님」 표시(진행본에도 대표 자리 직인이 찍혀 완료본과 구별이 안 됐다, 검증 지적 1)
  const send = async (buf: Buffer, progress = false) => {
    let out = progress ? await stampProgressPdf(buf, { diagonal: !contract.isTest }) : buf;
    if (contract.isTest) out = await stampTestPdf(out);   // 시험 문서(#67)는 어느 경로든 「테스트」 표시
    return new NextResponse(asBody(out), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
      },
    });
  };

  // 완료 문서는 저장해 둔 완료본을 그대로(서명 문서는 불변 — signed-document 와 같은 순서). 못 읽으면 아래 재합성
  if (done) {
    if (contract.signedPdfUrl) {
      const b = await fs.readFile(diskPath(contract.signedPdfUrl)).catch(() => null);
      if (b) return send(b);
    }
    const stored = firstFile(contract.signedUrl || "");
    if (stored) {
      const b = await fs.readFile(diskPath(stored)).catch(() => null);
      if (b && stored.toLowerCase().endsWith(".pdf")) return send(b);
      if (b) {
        const pdf = await docxToPdf(b, "docx|signed-stored");
        if (pdf) return send(pdf);
        return fail(503, BUSY);
      }
    }
  }

  // 진행 중(또는 저장본을 못 읽음) — 지금까지의 서명을 얹어 만든다(저장하지 않는다)
  const signers = collectSigners(contract);
  const orig = firstFile(contract.fileUrl);
  try {
    if (orig && orig.toLowerCase().endsWith(".docx")) {
      const docx = await buildSignedDocx(diskPath(orig), contract.title, signers);
      const pdf = await docxToPdf(docx, "docx|signed-rebuilt");
      if (pdf) return send(pdf, !done);
      return fail(503, BUSY);
    }
    const pdf = await buildSignedPdf(orig ? diskPath(orig) : null, contract.title, signers, await layoutForContractFile(orig ? diskPath(orig) : null, contract.templateId));
    return send(pdf, !done);
  } catch (e) {
    console.error("[external-sign/view] 서명 반영본 생성 오류:", e);
    return fail(500, BUSY);
  }
}
