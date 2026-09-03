import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { firstFile, diskPath, buildSignedDocx, type Signer } from "@/lib/signed-doc";
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
  // 권한은 lib/contract-access 한 곳에서 판정한다(관리자·당사자·결재자·담당 원장).
  // 종전에는 열람 금지(none) 문서도 이 경로로 전문이 나갔다 (2026-09-02).
  const { canAccessContractFile } = await import("@/lib/contract-access");
  const acc = await canAccessContractFile({ contractId: id }, { userId: session.userId, role: session.role });
  if (!acc.allowed) return NextResponse.json({ error: acc.error }, { status: acc.status });

  // ?hl=1 — 입력값 하이라이트 미리보기: 템플릿+저장된 입력값으로 재렌더 (#100)
  const hl = new URL(request.url).searchParams.get("hl") === "1";
  // 결재선까지 함께 읽는다 — 서명이 찍힌 실물을 보여주려면 서명 이미지가 필요하다
  const sel = {
    title: true, fileUrl: true, templateId: true, userId: true, startDate: true, endDate: true,
    extraFields: true, externalName: true, externalPhone: true, employeeSignedAt: true,
    approvalLine: {
      include: {
        steps: {
          include: { approver: { select: { id: true, name: true, role: true } } },
          orderBy: { order: "asc" as const },
        },
      },
    },
  } as const;
  const allDocs = contract.bundleId
    ? await prisma.contract.findMany({
        where: { bundleId: contract.bundleId, userId: contract.userId },
        orderBy: { createdAt: "asc" },
        select: { ...sel, id: true },
      })
    : [await prisma.contract.findUnique({ where: { id }, select: { ...sel, id: true } }) as NonNullable<Awaited<ReturnType<typeof prisma.contract.findUnique>>> & { templateId: string | null; id: string }];

  // 묶음 안 문서를 **하나씩** 판정한다 — 요청한 1건만 보고 전체를 병합하면,
  // full 문서 id 로 요청해 같은 묶음의 열람 금지(none) 문서까지 받을 수 있다 (2026-09-02).
  const docs: typeof allDocs = [];
  for (const d of allDocs) {
    if (!d) continue;
    const a = await canAccessContractFile({ contractId: (d as { id: string }).id }, { userId: session.userId, role: session.role });
    if (a.allowed) docs.push(d);
  }
  if (docs.length === 0)
    return NextResponse.json({ error: "볼 수 있는 문서가 없습니다." }, { status: 403 });

  const GOTENBERG = process.env.GOTENBERG_URL || "http://gotenberg:3000";
  const tmpFilesOuter: string[] = [];
  try {
    const pdfs: Buffer[] = [];
    const tmpFiles = tmpFilesOuter;
    for (const d of docs) {
      let srcUrl = firstFile(d.fileUrl);

      // ── 서명이 찍힌 실물을 보여준다 (2026-09-03 디렉터 지시) ──────────────
      // 종전에는 서명이 끝난 문서도 hl 모드에서 **지금 시점의 템플릿을 다시 그렸다.**
      // 그래서 ① 서명이 안 보이고 ② 템플릿을 교체한 뒤 열면 직원이 자기가 서명한 것과
      // 다른 문서를 본다. 계약서에서 이건 표시 문제가 아니라 진본성 문제다.
      const line = (d as { approvalLine?: { steps?: { order: number; approverId: string | null;
        signatureUrl: string | null; decidedAt: Date | null; externalName?: string | null;
        approver?: { name: string; role?: string } | null }[] } | null }).approvalLine;
      const signers: Signer[] = [];
      for (const st of line?.steps ?? []) {
        if (!st.signatureUrl) continue;
        // 외부(미가입) 서명 단계는 approver 가 없다 — 그 경우는 근로자 서명으로 본다
        const isEmployeeStep = st.approverId
          ? st.approverId === (d as { userId?: string }).userId && !(d as { externalName?: string | null }).externalName
          : true;
        signers.push({
          label: isEmployeeStep ? "직원 서명" : `${st.order}단계 결재`,
          name: st.approver?.name || st.externalName || "외부 서명자",
          date: st.decidedAt,
          sigPath: diskPath(st.signatureUrl),
          role: isEmployeeStep ? null : st.approver?.role ?? null,
        });
      }
      const hasSigned = signers.length > 0;

      // 하이라이트 모드: 템플릿 문서는 저장 입력값으로 재렌더 (실패 시 원본 폴백).
      // **서명이 시작된 문서에는 쓰지 않는다** — 다시 그리면 서명한 실물이 아니게 된다.
      if (hl && !hasSigned && (d as { templateId?: string | null }).templateId) {
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
      let buf: Buffer = await fs.readFile(diskPath(orig));
      // 서명이 있으면 원본에 서명을 얹은 실물로 바꾼다(완료본 라우트와 같은 방식).
      // 실패하면 원본이라도 보여준다 — 미리보기 때문에 화면이 멈추면 안 된다.
      if (hasSigned && orig.toLowerCase().endsWith(".docx")) {
        try {
          buf = await buildSignedDocx(diskPath(orig), (d as { title?: string }).title || contract.title, signers);
        } catch (e) { console.error("서명본 렌더 실패(원본 폴백):", e); }
      }
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
