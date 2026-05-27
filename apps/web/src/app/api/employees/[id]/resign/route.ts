import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    console.log("[RESIGN] Session:", session?.role || "NO SESSION");

    // ADMIN만 가능
    if (!session) {
      console.log("[RESIGN] No session found");
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    if (session.role !== "ADMIN") {
      console.log("[RESIGN] User role:", session.role);
      return NextResponse.json(
        { error: "관리자만 퇴사 처리할 수 있습니다." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const { resignDate, resignReason } = await request.json();

    // 필수: resignDate
    if (!resignDate) {
      return NextResponse.json(
        { error: "퇴사일은 필수입니다." },
        { status: 400 }
      );
    }

    // 사용자 존재 확인
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return NextResponse.json(
        { error: "해당 직원을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 퇴사 처리
    const resignDateObj = new Date(resignDate);
    const updated = await prisma.user.update({
      where: { id },
      data: {
        employmentStatus: "RESIGNED",
        resignDate: resignDateObj,
        resignReason: resignReason || null,
        isActive: false, // soft delete 호환성
      },
      select: {
        id: true,
        name: true,
        email: true,
        employmentStatus: true,
        resignDate: true,
        resignReason: true,
        hireDate: true,
        department: true,
        position: true,
        branch: true,
      },
    });

    return NextResponse.json({
      success: true,
      user: updated,
    });
  } catch (error) {
    console.error("RESIGN ERROR:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
