import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { firstFile, diskPath, buildSignedDocx, buildSignedPdf, type Signer } from "@/lib/signed-doc";
import { fillDocxTemplate, buildContractMergeData } from "@/lib/contract-fields";
import fs from "fs/promises";
import path from "path";

// Buffer 는 런타임상 Uint8Array 지만 NextResponse 의 BodyInit 타입과 안 맞는다.
// 복사 없이 같은 메모리를 가리키는 뷰로 넘긴다(큰 PDF 를 두 벌 만들지 않게).
const asBody = (b: Buffer) => new Uint8Array(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);

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

  const q = new URL(request.url).searchParams;
  // ?hl=1 — 입력값 하이라이트 미리보기: 템플릿+저장된 입력값으로 재렌더 (#100)
  const hl = q.get("hl") === "1";
  // ?as=send — 발송 전 확인용. 재발송은 결재선을 지우고 템플릿으로 다시 그리므로,
  // 옛 서명이 남아 있는 상태에서 서명본을 보여주면 **실제로 보낼 문서와 다른 것**을 보게 된다.
  const asSend = q.get("as") === "send";
  // 서명이 찍힌 실물은 **당사자와 관리자에게만**. 완료본 라우트가 "원장 등 결재자는 서명본
  // 보관 불가"로 막고 있는데 여기서 열어주면 같은 문서가 문에 따라 달라진다 —
  // 9/2 에 바로 그 형태(문마다 판정이 달라 우회됨)로 데였다. 결재자.원장은 재렌더/원본만 본다.
  const maySeeSigned = session.role === "ADMIN" || contract.userId === session.userId;
  // 결재선까지 함께 읽는다 — 서명이 찍힌 실물을 보여주려면 서명 이미지가 필요하다
  const sel = {
    title: true, fileUrl: true, signedUrl: true, status: true, templateId: true, userId: true, startDate: true,
    endDate: true, extraFields: true, externalName: true, externalPhone: true, employeeSignedAt: true,
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
      // 볼 자격이 없거나 발송 전 확인이면 서명을 얹지 않는다
      const hasSigned = signers.length > 0 && maySeeSigned && !asSend;

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
      if (!srcUrl) continue;
      let buf: Buffer = await fs.readFile(diskPath(srcUrl));
      // 서명이 있으면 원본에 서명을 얹은 실물로 바꾼다(완료본 라우트와 같은 방식).
      // 실패하면 완료 시점에 저장해 둔 서명본으로 대신한다(아래 catch).
      // ⚠ 종전에는 .docx 일 때만 서명을 얹어, **PDF 로 올린 계약은 완료본인데도 서명 없이**
      //   200 으로 나갔다(완료본 라우트는 buildSignedPdf 를 쓴다). 지금 운영 계약이 전부
      //   docx 라 안 터졌을 뿐이다 (2026-09-04 지적).
      if (hasSigned && (srcUrl.toLowerCase().endsWith(".docx") || srcUrl.toLowerCase().endsWith(".pdf"))) {
        try {
          buf = srcUrl.toLowerCase().endsWith(".pdf")
            ? await buildSignedPdf(diskPath(srcUrl), (d as { title?: string }).title || contract.title, signers)
            : await buildSignedDocx(diskPath(srcUrl), (d as { title?: string }).title || contract.title, signers);
        } catch (e) {
          // ⚠ 조용히 **서명 없는 원본**으로 넘어가면 "아직 서명 안 됐구나"로 읽힌다 —
          //   진본성을 고치려던 변경이 실패 경로에서 같은 오해를 만든다.
          //   그렇다고 통째로 실패시키면 서명 모달의 문서 창이 안 떠 **서명 자체가 막힌다**.
          //   그래서 완료 시점에 만들어 둔 **저장된 서명본**을 쓴다 — 그것도 진짜 서명본이다.
          console.error("서명본 렌더 실패:", e);
          const { logSystemError } = await import("@/lib/monitor");
          await logSystemError({
            path: `/api/contracts/${id}/bundle-preview`, method: "GET",
            message: `서명본 렌더 실패: ${(e as Error)?.message || String(e)}`,
            stack: (e as Error)?.stack || null,
          }).catch(() => {});
          // ⚠ 저장본을 **status 검사보다 먼저** 쓰면 게이트가 통째로 우회된다(2026-09-04 지적).
          //   완료 계약일 때만 저장본을 인정한다 — 회수.재발송으로 되돌아간 계약에서
          //   옛 완료본이 되살아나는 것을 막는다(회수 라우트도 signedUrl 을 지우도록 고쳤다).
          const done = (d as { status?: string }).status === "SIGNED";
          const stored = done ? firstFile((d as { signedUrl?: string | null }).signedUrl || "") : null;
          let recovered = false;
          if (stored) {
            try { buf = await fs.readFile(diskPath(stored)); srcUrl = stored; recovered = true; } catch { /* 아래에서 처리 */ }
          }
          // ⚠ 저장본(signedUrl)은 **계약이 완료(SIGNED)될 때만** 만들어진다
          //   (signed-doc.generateAndStoreSignedDoc 의 status 검사). 그런데 이 폴백이 정작
          //   필요한 순간은 **서명 진행 중**이고, 그때 저장본은 항상 없다 — 즉 앞 커밋의
          //   폴백은 필요한 구간을 못 덮었다(2026-09-04 검증 지적).
          //
          //   진행 중 계약은 원본으로라도 보여준다. 서명하려면 문서를 봐야 하고, 아직
          //   완료본이 아니므로 "완료본인 척"하는 문제도 없다 — 서명 모달이 백지가 되어
          //   서명 자체가 막히는 쪽이 훨씬 나쁘다.
          //   완료된 계약은 종전대로 실패시킨다. 서명 없는 문서를 완료본으로 보여줄 수는 없다.
          if (!recovered) {
            if (done)
              return NextResponse.json({ error: "서명이 반영된 문서를 만들지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });
            // 진행 중 — 원본 그대로 내보낸다(buf 는 이미 원본을 담고 있다)
          }
        }
      }
      if (srcUrl.toLowerCase().endsWith(".pdf")) {
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
    return new NextResponse(asBody(out), {
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
