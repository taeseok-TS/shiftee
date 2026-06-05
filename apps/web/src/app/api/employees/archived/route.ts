import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // ADMIN만 보관함 조회 가능
    if (session.role !== "ADMIN") {
      return NextResponse.json(
        { error: "관리자만 보관함을 조회할 수 있습니다." },
        { status: 403 }
      );
    }

    // 삭제된 직원 목록 조회
    const archivedUsers = await prisma.user.findMany({
      where: {
        deletedAt: { not: null },
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
        deletedAt: true,
        permanentlyDeletedAt: true,
      },
      orderBy: { deletedAt: "desc" },
    });

    // 각 직원별 남은 일수 계산
    const now = new Date();
    const archivedWithDaysLeft = archivedUsers.map((user) => {
      const daysLeft = user.permanentlyDeletedAt
        ? Math.ceil(
            (new Date(user.permanentlyDeletedAt).getTime() - now.getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : 0;

      return {
        ...user,
        daysLeftBeforePermanentDelete: Math.max(0, daysLeft),
      };
    });

    return NextResponse.json({
      total: archivedUsers.length,
      users: archivedWithDaysLeft,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";
    console.error("[GET /api/employees/archived]", { errorMessage, errorStack });

    return NextResponse.json(
      {
        error: "보관함 조회 중 오류가 발생했습니다.",
        details: errorMessage,
        stack: process.env.NODE_ENV === "development" ? errorStack : undefined
      },
      { status: 500 }
    );
  }
}
