import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  try {
    const { id } = await params;
    const template = await prisma.contractTemplate.findUnique({
      where: { id },
      include: {
        createdByUser: { select: { id: true, name: true } },
      },
    });

    if (!template) {
      return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ template });
  } catch (error) {
    console.error("템플릿 조회 실패:", error);
    return NextResponse.json({ error: "템플릿을 조회할 수 없습니다." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { description, approverIds } = body;

    const template = await prisma.contractTemplate.update({
      where: { id },
      data: {
        ...(description !== undefined ? { description } : {}),
        ...(approverIds ? { approverIds: JSON.stringify(approverIds) } : {}),
      },
      include: {
        createdByUser: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ success: true, template });
  } catch (error) {
    console.error("템플릿 수정 실패:", error);
    return NextResponse.json({ error: "템플릿을 수정할 수 없습니다." }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  try {
    const { id } = await params;

    // Soft delete - 비활성화만 함
    await prisma.contractTemplate.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("템플릿 삭제 실패:", error);
    return NextResponse.json({ error: "템플릿을 삭제할 수 없습니다." }, { status: 500 });
  }
}
