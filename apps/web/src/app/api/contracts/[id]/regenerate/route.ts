import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fillDocxTemplate, buildContractMergeData } from "@/lib/contract-fields";

// 미발송 초안을 최신 템플릿으로 다시 생성 (#109, 2026-08-27).
// 입력값(extraFields·기간·연봉)은 그대로 두고 문서 파일만 재생성한다.
// 발송·서명된 문서는 계약 당시 문서 보존을 위해 건드리지 않는다.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 사용할 수 있습니다." }, { status: 403 });

  const { id } = await params;
  const contract = await prisma.contract.findUnique({ where: { id } });
  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });
  if (contract.status !== "DRAFT")
    return NextResponse.json({ error: "미발송(초안) 상태에서만 다시 생성할 수 있습니다." }, { status: 400 });
  if (!contract.templateId)
    return NextResponse.json({ error: "템플릿으로 만든 문서가 아닙니다." }, { status: 400 });

  const tmpl = await prisma.contractTemplate.findUnique({
    where: { id: contract.templateId }, select: { fileUrl: true },
  });
  if (!tmpl?.fileUrl.toLowerCase().endsWith(".docx"))
    return NextResponse.json({ error: "워드 템플릿만 재생성을 지원합니다." }, { status: 400 });

  try {
    const mergeData = await buildContractMergeData(contract.userId, {
      title: contract.title,
      startDate: contract.startDate ? contract.startDate.toISOString() : null,
      endDate: contract.endDate ? contract.endDate.toISOString() : null,
      // Contract 에 salary 컬럼이 없어 요약(extraFields.연봉 "34,000,000원")에서 숫자만 복원
      salary: (((contract.extraFields as Record<string, string> | null)?.["연봉"] || "").replace(/[^\d]/g, "")) || null,
      extraFields: (contract.extraFields as Record<string, string>) || null,
      external: contract.externalName ? { name: contract.externalName, phone: contract.externalPhone } : null,
    });
    const newUrl = await fillDocxTemplate(tmpl.fileUrl, mergeData);
    await prisma.contract.update({ where: { id }, data: { fileUrl: JSON.stringify([newUrl]) } });
    return NextResponse.json({ success: true, fileUrl: newUrl });
  } catch (e) {
    console.error("초안 재생성 오류:", e);
    return NextResponse.json({ error: "재생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
