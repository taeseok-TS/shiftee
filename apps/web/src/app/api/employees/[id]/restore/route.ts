import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // ADMIN만 직원 복구 가능
    if (session.role !== "ADMIN") {
      return NextResponse.json(
        { error: "관리자만 직원을 복구할 수 있습니다." },
        { status: 403 }
      );
    }

    const { id } = params;

    // 직원 존재 확인
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return NextResponse.json(
        { error: "직원을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 삭제된 직원인지 확인
    if (!user.deletedAt) {
      return NextResponse.json(
        { error: "삭제되지 않은 직원입니다." },
        { status: 400 }
      );
    }

    // 복구 처리: deletedAt, permanentlyDeletedAt 제거
    const restoredUser = await prisma.user.update({
      where: { id },
      data: {
        deletedAt: null,
        permanentlyDeletedAt: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        jobGroup: true,
        position: true,
        branch: true,
        hireDate: true,
        resignDate: true,
        employmentStatus: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: "직원이 복구되었습니다.",
      restoredUser,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[POST /api/employees/[id]/restore]", errorMessage);

    return NextResponse.json(
      {
        error: "직원 복구 중 오류가 발생했습니다.",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
