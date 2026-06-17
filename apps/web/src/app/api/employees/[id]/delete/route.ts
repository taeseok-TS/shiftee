import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function DELETE(
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

    // ADMIN만 직원 삭제 가능
    if (session.role !== "ADMIN") {
      return NextResponse.json(
        { error: "관리자만 직원을 삭제할 수 있습니다." },
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

    // 관리자(ADMIN) 계정 삭제는 메인 관리자 전용
    if (user.role === "ADMIN" && !(await isSuperAdmin(session.userId))) {
      return NextResponse.json(
        { error: "관리자 계정 관리는 메인 관리자만 가능합니다." },
        { status: 403 }
      );
    }

    // 이미 삭제된 직원인 경우
    if (user.deletedAt) {
      return NextResponse.json(
        { error: "이미 삭제된 직원입니다." },
        { status: 400 }
      );
    }

    // 퇴사 상태인지 확인
    if (user.employmentStatus !== "RESIGNED") {
      return NextResponse.json(
        { error: "퇴사한 직원만 삭제할 수 있습니다." },
        { status: 400 }
      );
    }

    // 30일 후 영구 삭제 예정 시간 계산
    const permanentlyDeletedAt = new Date();
    permanentlyDeletedAt.setDate(permanentlyDeletedAt.getDate() + 30);

    // Soft delete 처리: deletedAt 설정
    const deletedUser = await prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        permanentlyDeletedAt,
      },
    });

    return NextResponse.json({
      success: true,
      message: "직원이 삭제되었습니다. (30일 보관 후 완전 삭제됩니다)",
      deletedUser: {
        id: deletedUser.id,
        name: deletedUser.name,
        email: deletedUser.email,
        deletedAt: deletedUser.deletedAt,
        permanentlyDeletedAt: deletedUser.permanentlyDeletedAt,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[DELETE /api/employees/[id]/delete]", errorMessage);

    return NextResponse.json(
      { error: "직원 삭제 중 오류가 발생했습니다.", details: errorMessage },
      { status: 500 }
    );
  }
}
