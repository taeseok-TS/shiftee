import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fillDocxTemplate, buildContractMergeData, buildFieldSummary, scanTemplateProfileFields, scanEmployeeFillFields } from "@/lib/contract-fields";

// 신규입사 패키지 생성 — 여러 템플릿(근로계약서+비밀유지+개인정보동의서)을 하나의 묶음으로 함께 생성.
// 각 계약서는 공유 bundleId를 가지며, employeeOnly 문서는 직원 서명만/직원·관리자에게만 표시된다.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN")
    return NextResponse.json({ error: "패키지 발송은 관리자만 가능합니다." }, { status: 403 });

  const body = (await request.json()) as {
    userId?: string;
    externalName?: string | null; // 외부(미가입) 계약자 패키지 — 소유자는 작성 관리자
    externalPhone?: string | null;
    items?: Array<{
      templateId: string;
      title: string;
      type: string;
      startDate?: string | null;
      endDate?: string | null;
      salary?: string | null;
      extraFields?: Record<string, string> | null;
      employeeOnly?: boolean;
    }>;
  };
  const { items } = body;
  const externalName = (body.externalName || "").trim() || null;
  const externalPhone = (body.externalPhone || "").trim() || null;
  const userId = externalName ? session.userId : body.userId;
  if (!userId || !Array.isArray(items) || items.length === 0)
    return NextResponse.json({ error: "직원과 문서를 선택해주세요." }, { status: 400 });

  const bundleId = `bundle_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const created: string[] = [];

  try {
    for (const item of items) {
      const template = await prisma.contractTemplate.findUnique({ where: { id: item.templateId } });
      if (!template) continue;

      let fileUrl: string;
      let profileFields: string[] = [];
      let employeeFields: string[] = [];
      if (template.fileUrl.toLowerCase().endsWith(".docx")) {
        const mergeData = await buildContractMergeData(userId, {
          title: item.title,
          startDate: item.startDate ?? null,
          endDate: item.endDate ?? null,
          salary: item.salary,
          extraFields: item.extraFields ?? null,
          external: externalName ? { name: externalName, phone: externalPhone } : null,
        });
        fileUrl = JSON.stringify([await fillDocxTemplate(template.fileUrl, mergeData)]);
        // 외부 계약은 계정이 없어 프로필 보완·직원 직접입력이 불가 — 전부 관리자 입력(extraFields)으로 완성
        if (!externalName) {
          profileFields = await scanTemplateProfileFields(template.fileUrl);
          employeeFields = await scanEmployeeFillFields(template.fileUrl);
        }
      } else {
        fileUrl = JSON.stringify([template.fileUrl]);
      }

      const fieldSummary = buildFieldSummary(item.salary, item.extraFields ?? null);
      const c = await prisma.contract.create({
        data: {
          userId,
          title: item.title,
          type: item.type as never,
          fileUrl,
          templateId: item.templateId,
          startDate: item.startDate ? new Date(item.startDate) : null,
          endDate: item.endDate ? new Date(item.endDate) : null,
          extraFields: Object.keys(fieldSummary).length ? fieldSummary : undefined,
          profileFields: profileFields.length ? profileFields : undefined,
          employeeFields: employeeFields.length ? employeeFields : undefined,
          bundleId,
          employeeOnly: !!item.employeeOnly,
          externalName,
          externalPhone,
          status: "DRAFT",
        },
        select: { id: true },
      });
      created.push(c.id);
    }

    return NextResponse.json({ success: true, bundleId, contractIds: created });
  } catch (e) {
    console.error("패키지 생성 오류:", e);
    // 부분 생성분 롤백 (묶음 단위 원자성)
    if (created.length) await prisma.contract.deleteMany({ where: { id: { in: created } } });
    return NextResponse.json({ error: "패키지 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
