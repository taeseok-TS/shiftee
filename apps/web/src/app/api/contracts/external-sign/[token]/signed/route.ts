import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { checkExternalVerify, maskEmail } from "@/lib/external-verify";
import { diskPath } from "@/lib/signed-doc";
import { recordContractEvent } from "@/lib/contract-events";

// 외부(미가입) 계약자 — 서명 직후 완료 화면에서 완료본 PDF 받기(2026-10-16 이예지 QA 7 ①).
// 본인 확인 증표(x-sign-verify, 확인 뒤 2시간)가 있어야 한다 — 그 뒤로는 링크로 계약서가 열리지 않는다(완료본은 메일로).
// 이 링크의 대표 문서와 같은 패키지의 외부 문서만, 완료(SIGNED)된 것만. 목록(GET) / 파일(GET ?doc=)
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 32) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  const step = await prisma.contractApprovalStep.findUnique({
    where: { signToken: token },
    select: { id: true, order: true, approverId: true, status: true, externalName: true, approvalLine: { select: { contract: { select: { id: true, bundleId: true, externalEmail: true, externalName: true } } } } },
  });
  if (!step || step.approverId !== null) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  if (!checkExternalVerify(step.id, request.headers.get("x-sign-verify")))
    return NextResponse.json({ code: "VERIFY_REQUIRED", error: "본인 확인이 필요합니다." }, { status: 403 });
  if (step.status !== "APPROVED") return NextResponse.json({ error: "아직 서명하지 않은 링크입니다." }, { status: 400 });

  const rep = step.approvalLine.contract;
  const docs = await prisma.contract.findMany({
    where: rep.bundleId ? { bundleId: rep.bundleId, externalName: { not: null } } : { id: rep.id },
    select: { id: true, title: true, status: true, signedPdfUrl: true, signedUrl: true },
    orderBy: { createdAt: "asc" },
  });
  const pdfOf = (d: { signedPdfUrl: string | null; signedUrl: string | null }) =>
    d.signedPdfUrl || (d.signedUrl && d.signedUrl.toLowerCase().endsWith(".pdf") ? d.signedUrl : null);

  const docId = request.nextUrl.searchParams.get("doc");
  if (!docId) {
    return NextResponse.json({
      email: rep.externalEmail ? maskEmail(rep.externalEmail) : null,
      docs: docs.map((d) => ({ id: d.id, title: d.title, ready: d.status === "SIGNED" && !!pdfOf(d) })),
    });
  }
  const d = docs.find((x) => x.id === docId);
  const url = d && d.status === "SIGNED" ? pdfOf(d) : null;
  if (!d || !url) return NextResponse.json({ error: "아직 완료본이 없습니다. 모든 결재가 끝나면 이메일로 보내 드립니다." }, { status: 404 });
  let buf: Buffer;
  try { buf = await fs.readFile(diskPath(url)); } catch { return NextResponse.json({ error: "완료본을 찾지 못했습니다. 담당자에게 문의해 주세요." }, { status: 404 }); }
  // 교부 기록(10/16 QA 7 검증 F8) — 외부 계약자가 완료 화면에서 받아 갔다
  await recordContractEvent({ contractId: d.id, type: "DOWNLOADED", actorName: step.externalName || rep.externalName || "외부 계약자", stepOrder: step.order, request, meta: { by: "외부 계약자 완료 화면" } }).catch(() => {});
  const name = `${d.title.replace(/[\\/:*?"<>|]/g, "_")}.pdf`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
