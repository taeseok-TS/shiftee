import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildSignedDocx, buildSignedPdf, firstFile, diskPath, type Signer } from "@/lib/signed-doc";

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

  // 권한: 관리자 / 계약 당사자 본인만 (원장 등 결재자는 서명본 보관 불가 — 개인정보 보호)
  const allowed = session.role === "ADMIN" || contract.userId === session.userId;
  if (!allowed) return NextResponse.json({ error: "서명 완료본은 관리자와 계약 당사자만 받을 수 있습니다." }, { status: 403 });

  if (contract.status !== "SIGNED")
    return NextResponse.json({ error: "아직 서명이 완료되지 않은 계약서입니다." }, { status: 400 });

  // 서명자 목록 구성
  const steps = contract.approvalLine?.steps || [];
  const signers: Signer[] = [];
  for (const st of steps) {
    if (!st.signatureUrl) continue;
    // 외부(미가입) 서명 단계는 approver가 없음 — 외부 계약자 = 근로자 서명으로 취급.
    // 외부 계약은 소유자=작성 관리자 — 관리자 결재 스텝을 직원 서명으로 오인하면 직인 누락
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
  if (signers.length === 0)
    return NextResponse.json({ error: "서명 정보가 없습니다." }, { status: 400 });

  const orig = firstFile(contract.fileUrl);
  const isDocx = !!orig && orig.toLowerCase().endsWith(".docx");

  // ?pdf=1 — 워드 완료본을 PDF로 변환해 제공 (개선 제안 2026-08-24: 다운로드 후 수정 방지).
  // 변환기(gotenberg)가 죽어 있으면 워드로 폴백해 다운로드 자체는 항상 된다.
  const wantPdf = new URL(_request.url).searchParams.get("pdf") === "1";

  try {
    if (isDocx) {
      const buf = await buildSignedDocx(diskPath(orig!), contract.title, signers);
      if (wantPdf) {
        try {
          const fd = new FormData();
          fd.append("files", new Blob([new Uint8Array(buf)]), "document.docx");
          const gres = await fetch(
            `${process.env.GOTENBERG_URL || "http://gotenberg:3000"}/forms/libreoffice/convert`,
            { method: "POST", body: fd }
          );
          if (gres.ok) {
            const pdf = Buffer.from(await gres.arrayBuffer());
            return new NextResponse(pdf, {
              headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(contract.title + "_서명완료.pdf")}`,
              },
            });
          }
          console.error("PDF 변환 실패(gotenberg):", gres.status, await gres.text().catch(() => ""));
        } catch (e) {
          console.error("PDF 변환 오류(gotenberg):", e);
        }
      }
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
