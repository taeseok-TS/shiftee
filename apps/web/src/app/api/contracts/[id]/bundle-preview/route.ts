import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { firstFile, diskPath } from "@/lib/signed-doc";
import { fillDocxTemplate, buildContractMergeData } from "@/lib/contract-fields";
import fs from "fs/promises";
import path from "path";

// 패키지(번들) 전 문서를 한 PDF 로 합쳐 미리보기 (#124·#125, 2026-08-27).
// 번들이 아니면 해당 문서 1건만. 발송 전 확인용이라 현재 fileUrl(작성본) 기준.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { id: true, userId: true, title: true, fileUrl: true, bundleId: true },
  });
  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });
  // 결재자(원장 등)도 서명 전 확인이 필요하므로: 관리자·당사자·해당 계약 결재선의 결재자 허용
  let allowed = session.role === "ADMIN" || contract.userId === session.userId;
  if (!allowed) {
    const step = await prisma.contractApprovalStep.findFirst({
      where: { approverId: session.userId, approvalLine: { contractId: id } },
      select: { id: true },
    });
    allowed = !!step;
  }
  if (!allowed) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  // ?hl=1 — 입력값 하이라이트 미리보기: 템플릿+저장된 입력값으로 재렌더 (#100)
  const hl = new URL(request.url).searchParams.get("hl") === "1";
  const sel = { title: true, fileUrl: true, templateId: true, userId: true, startDate: true, endDate: true, extraFields: true, externalName: true, externalPhone: true } as const;
  const docs = contract.bundleId
    ? await prisma.contract.findMany({
        where: { bundleId: contract.bundleId },
        orderBy: { createdAt: "asc" },
        select: sel,
      })
    : [await prisma.contract.findUnique({ where: { id }, select: sel }) as NonNullable<Awaited<ReturnType<typeof prisma.contract.findUnique>>> & { templateId: string | null }];

  const GOTENBERG = process.env.GOTENBERG_URL || "http://gotenberg:3000";
  const tmpFilesOuter: string[] = [];
  try {
    const pdfs: Buffer[] = [];
    const tmpFiles = tmpFilesOuter;
    for (const d of docs) {
      let srcUrl = firstFile(d.fileUrl);
      // 하이라이트 모드: 템플릿 문서는 저장 입력값으로 재렌더 (실패 시 원본 폴백)
      if (hl && (d as { templateId?: string | null }).templateId) {
        try {
          const dd = d as { templateId: string; title: string; userId?: string; startDate?: Date | null; endDate?: Date | null; extraFields?: unknown; externalName?: string | null; externalPhone?: string | null };
          const tmpl = await prisma.contractTemplate.findUnique({ where: { id: dd.templateId }, select: { fileUrl: true } });
          if (tmpl?.fileUrl.toLowerCase().endsWith(".docx")) {
            const merge = await buildContractMergeData(dd.userId || contract.userId, {
              title: dd.title,
              startDate: dd.startDate ? dd.startDate.toISOString() : null,
              endDate: dd.endDate ? dd.endDate.toISOString() : null,
              salary: (((dd.extraFields as Record<string, string> | null)?.["연봉"] || "").replace(/[^\d]/g, "")) || null,
              extraFields: (dd.extraFields as Record<string, string>) || null,
              external: dd.externalName ? { name: dd.externalName, phone: dd.externalPhone || null } : null,
            });
            const u = await fillDocxTemplate(tmpl.fileUrl, merge, { highlight: true });
            tmpFiles.push(path.join(process.cwd(), "uploads", u.replace(/^\/api\/uploads\//, "")));
            srcUrl = u;
          }
        } catch (e) { console.error("하이라이트 재렌더 실패(원본 폴백):", e); }
      }
      const orig = srcUrl;
      if (!orig) continue;
      const buf = await fs.readFile(diskPath(orig));
      if (orig.toLowerCase().endsWith(".pdf")) {
        pdfs.push(buf);
        continue;
      }
      const fd = new FormData();
      fd.append("files", new Blob([new Uint8Array(buf)]), "document.docx");
      // 브라우저 탭 제목은 파일명이 아니라 PDF 내부 Title 메타를 따른다 (#147)
      fd.append("metadata", JSON.stringify({ Title: (d as { title?: string }).title || contract.title }));
      const gres = await fetch(`${GOTENBERG}/forms/libreoffice/convert`, { method: "POST", body: fd });
      if (!gres.ok) return NextResponse.json({ error: "PDF 변환기가 응답하지 않습니다." }, { status: 502 });
      pdfs.push(Buffer.from(await gres.arrayBuffer()));
    }
    if (pdfs.length === 0) return NextResponse.json({ error: "문서 파일이 없습니다." }, { status: 404 });
    let out: Buffer;
    if (pdfs.length === 1) out = pdfs[0];
    else {
      const fd = new FormData();
      pdfs.forEach((b, i) => fd.append("files", new Blob([new Uint8Array(b)]), `doc${i + 1}.pdf`));
      fd.append("metadata", JSON.stringify({ Title: contract.title + `_외${docs.length - 1}건` })); // 탭 제목 (#147)
      const mres = await fetch(`${GOTENBERG}/forms/pdfengines/merge`, { method: "POST", body: fd });
      if (!mres.ok) return NextResponse.json({ error: "PDF 병합에 실패했습니다." }, { status: 502 });
      out = Buffer.from(await mres.arrayBuffer());
    }
    return new NextResponse(out, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(contract.title + (docs.length > 1 ? `_외${docs.length - 1}건` : "") + ".pdf")}`,
      },
    });
  } catch (e) {
    console.error("번들 미리보기 오류:", e);
    return NextResponse.json({ error: "미리보기 생성 중 오류가 발생했습니다." }, { status: 500 });
  } finally {
    for (const f of tmpFilesOuter) fs.unlink(f).catch(() => {});
  }
}
