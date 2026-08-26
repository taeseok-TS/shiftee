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
  const { templateId, userId, title, startDate, endDate, salary, extraFields, externalName, externalPhone } = body;
  if (!templateId) return NextResponse.json({ error: "템플릿을 선택해주세요." }, { status: 400 });
  if (!userId && !externalName) return NextResponse.json({ error: "직원 또는 외부 계약자를 선택해주세요." }, { status: 400 });

  const tmpl = await prisma.contractTemplate.findUnique({
    where: { id: templateId }, select: { fileUrl: true, name: true },
  });
  if (!tmpl) return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
  if (!tmpl.fileUrl.toLowerCase().endsWith(".docx"))
    return NextResponse.json({ error: "워드 템플릿만 미리보기를 지원합니다." }, { status: 400 });

  let tmpUrl: string | null = null;
  try {
    const mergeData = await buildContractMergeData(userId || "", {
      title: title || tmpl.name,
      startDate: startDate || null,
      endDate: endDate || null,
      salary: salary || null,
      extraFields: extraFields && typeof extraFields === "object" ? extraFields : null,
      external: externalName ? { name: externalName, phone: externalPhone || null } : null,
    });
    tmpUrl = await fillDocxTemplate(tmpl.fileUrl, mergeData);
    const diskFile = path.join(process.cwd(), "uploads", tmpUrl.replace(/^\/api\/uploads\//, ""));
    const buf = await fs.readFile(diskFile);

    const fd = new FormData();
    fd.append("files", new Blob([new Uint8Array(buf)]), "document.docx");
    const gres = await fetch(
      `${process.env.GOTENBERG_URL || "http://gotenberg:3000"}/forms/libreoffice/convert`,
      { method: "POST", body: fd }
    );
    if (!gres.ok) {
      console.error("미리보기 변환 실패(gotenberg):", gres.status);
      return NextResponse.json({ error: "PDF 변환기가 응답하지 않습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });
    }
    const pdf = Buffer.from(await gres.arrayBuffer());
    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent((title || tmpl.name) + "_미리보기.pdf")}`,
      },
    });
  } catch (e) {
    console.error("미리보기 렌더 오류:", e);
    return NextResponse.json({ error: "미리보기 생성 중 오류가 발생했습니다." }, { status: 500 });
  } finally {
    // 임시 렌더 파일 정리
    if (tmpUrl) {
      const p = path.join(process.cwd(), "uploads", tmpUrl.replace(/^\/api\/uploads\//, ""));
      fs.unlink(p).catch(() => {});
    }
  }
}
