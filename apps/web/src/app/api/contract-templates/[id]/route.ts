import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();

  // 관리자와 매니저만 템플릿 삭제 가능
  if (!session || session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  try {
    const { id } = await params;

    // 템플릿 존재 확인
    const template = await prisma.contractTemplate.findUnique({
      where: { id },
      include: {
        contracts: { select: { id: true } }
      }
    });

    if (!template) {
      return NextResponse.json(
        { error: "템플릿을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 이 템플릿을 사용 중인 계약서가 있으면 삭제 불가
    if (template.contracts.length > 0) {
      return NextResponse.json(
        { error: "이 템플릿을 사용 중인 계약서가 있어서 삭제할 수 없습니다." },
        { status: 400 }
      );
    }

    // 템플릿 비활성화 (soft delete 방식)
    const deletedTemplate = await prisma.contractTemplate.update({
      where: { id },
      data: { isActive: false }
    });

    return NextResponse.json({ success: true, template: deletedTemplate });
  } catch (error) {
    console.error("DELETE /api/contract-templates/[id] 에러:", error);
    return NextResponse.json(
      { error: "템플릿 삭제에 실패했습니다." },
      { status: 500 }
    );
  }
}
