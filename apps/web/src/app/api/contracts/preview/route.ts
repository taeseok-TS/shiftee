import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fillDocxTemplate, buildContractMergeData } from "@/lib/contract-fields";
import fs from "fs/promises";
import path from "path";

// 발송 전 미리보기 (개선 제안 #76) — 입력값이 치환된 문서를 PDF로 렌더해 즉석 확인.
// 계약을 만들지 않는다: 임시 렌더 파일은 응답 후 바로 삭제.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 사용할 수 있습니다." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { templateId, items, userId, title, startDate, endDate, salary, extraFields, externalName, externalPhone } = body;
  const highlight = body.highlight === true || body.highlight === 1; // 입력값 하이라이트 (#100)
  // items[] — 패키지 미리보기: 여러 템플릿을 각각 렌더해 PDF 하나로 합친다 (#117, 2026-08-27)
  const templateIds: string[] = Array.isArray(items) && items.length
    ? items.map((x: { templateId?: string }) => x?.templateId).filter((x: unknown): x is string => typeof x === "string")
    : templateId ? [templateId] : [];
  if (templateIds.length === 0) return NextResponse.json({ error: "템플릿을 선택해주세요." }, { status: 400 });
  if (!userId && !externalName) return NextResponse.json({ error: "직원 또는 외부 계약자를 선택해주세요." }, { status: 400 });

  const GOTENBERG = process.env.GOTENBERG_URL || "http://gotenberg:3000";
  const tmpUrls: string[] = [];
  try {
    const pdfs: Buffer[] = [];
    let firstName = "";
    for (const tid of templateIds) {
      const tmpl = await prisma.contractTemplate.findUnique({ where: { id: tid }, select: { fileUrl: true, name: true } });
      if (!tmpl) return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
      if (!tmpl.fileUrl.toLowerCase().endsWith(".docx"))
        return NextResponse.json({ error: "워드 템플릿만 미리보기를 지원합니다." }, { status: 400 });
      if (!firstName) firstName = tmpl.name;
      const mergeData = await buildContractMergeData(userId || "", {
        title: title || tmpl.name,
        startDate: startDate || null,
        endDate: endDate || null,
        salary: salary || null,
        extraFields: extraFields && typeof extraFields === "object" ? extraFields : null,
        external: externalName ? { name: externalName, phone: externalPhone || null } : null,
      });
      const tmpUrl = await fillDocxTemplate(tmpl.fileUrl, mergeData, { highlight });
      tmpUrls.push(tmpUrl);
      const buf = await fs.readFile(path.join(process.cwd(), "uploads", tmpUrl.replace(/^\/api\/uploads\//, "")));
      const fd = new FormData();
      fd.append("files", new Blob([new Uint8Array(buf)]), "document.docx");
      const gres = await fetch(`${GOTENBERG}/forms/libreoffice/convert`, { method: "POST", body: fd });
      if (!gres.ok) {
        console.error("미리보기 변환 실패(gotenberg):", gres.status);
        return NextResponse.json({ error: "PDF 변환기가 응답하지 않습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });
      }
      pdfs.push(Buffer.from(await gres.arrayBuffer()));
    }
    let pdf: Buffer;
    if (pdfs.length === 1) {
      pdf = pdfs[0];
    } else {
      // 여러 문서 → 한 PDF (파일명 정렬 순서대로 병합됨)
      const fd = new FormData();
      pdfs.forEach((b, i) => fd.append("files", new Blob([new Uint8Array(b)]), `doc${i + 1}.pdf`));
      const mres = await fetch(`${GOTENBERG}/forms/pdfengines/merge`, { method: "POST", body: fd });
      if (!mres.ok) {
        console.error("미리보기 병합 실패(gotenberg):", mres.status);
        return NextResponse.json({ error: "PDF 병합에 실패했습니다." }, { status: 502 });
      }
      pdf = Buffer.from(await mres.arrayBuffer());
    }
    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent((title || firstName) + "_미리보기.pdf")}`,
      },
    });
  } catch (e) {
    console.error("미리보기 렌더 오류:", e);
    return NextResponse.json({ error: "미리보기 생성 중 오류가 발생했습니다." }, { status: 500 });
  } finally {
    // 임시 렌더 파일 정리
    for (const u of tmpUrls) {
      fs.unlink(path.join(process.cwd(), "uploads", u.replace(/^\/api\/uploads\//, ""))).catch(() => {});
    }
  }
}
