import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/contract-templates/[id]
 * 특정 템플릿 상세 조회
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const { id } = await params;

    const template = await prisma.contractTemplate.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        fileUrl: true,
        version: true,
        isActive: true,
        createdBy: true,
        createdByUser: {
          select: { id: true, name: true },
        },
        approverIds: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!template) {
      return NextResponse.json(
        { error: "템플릿을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      template: {
        ...template,
        approverIds: JSON.parse(template.approverIds),
      },
    });
  } catch (error) {
    console.error("템플릿 조회 오류:", error);
    return NextResponse.json(
      { error: "템플릿 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/contract-templates/[id]
 * 템플릿 수정 (버전 관리)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // ADMIN 또는 MANAGER만 수정 가능
    if (session.role !== "ADMIN" && session.role !== "MANAGER") {
      return NextResponse.json(
        { error: "접근 권한이 없습니다." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const { description, fileUrl, approverIds } = body;

    const template = await prisma.contractTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return NextResponse.json(
        { error: "템플릿을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const updated = await prisma.contractTemplate.update({
      where: { id },
      data: {
        ...(description !== undefined ? { description } : {}),
        ...(fileUrl ? { fileUrl, version: { increment: 1 } } : {}),
        ...(approverIds ? { approverIds: JSON.stringify(approverIds) } : {}),
      },
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        fileUrl: true,
        version: true,
        isActive: true,
        createdByUser: {
          select: { id: true, name: true },
        },
        approverIds: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: "템플릿이 수정되었습니다.",
      template: {
        ...updated,
        approverIds: JSON.parse(updated.approverIds),
      },
    });
  } catch (error) {
    console.error("템플릿 수정 오류:", error);
    return NextResponse.json(
      { error: "템플릿 수정 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/contract-templates/[id]
 * 템플릿 비활성화 (soft-delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // ADMIN만 삭제 가능
    if (session.role !== "ADMIN") {
      return NextResponse.json(
        { error: "접근 권한이 없습니다." },
        { status: 403 }
      );
    }

    const { id } = await params;

    const template = await prisma.contractTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return NextResponse.json(
        { error: "템플릿을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // Soft-delete: isActive를 false로 설정
    const deleted = await prisma.contractTemplate.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({
      success: true,
      message: "템플릿이 삭제되었습니다.",
    });
  } catch (error) {
    console.error("템플릿 삭제 오류:", error);
    return NextResponse.json(
      { error: "템플릿 삭제 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
