import { NextRequest, NextResponse } from "next/server";
import { getSession, clearSessionCache } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function POST(
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

    // ADMIN만 직원 복구 가능
    if (session.role !== "ADMIN") {
      return NextResponse.json(
        { error: "관리자만 직원을 복구할 수 있습니다." },
        { status: 403 }
      );
    }

    const { id } = await params;

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

    // 복구 처리: deletedAt, permanentlyDeletedAt 제거 + 재활성화
    // 되살렸는데 "비활성" 캐시가 30초 남아 있으면 그 동안 로그인이 안 된다
    const restoredUser = await prisma.user.update({
      where: { id },
      data: {
        deletedAt: null,
        permanentlyDeletedAt: null,
        isActive: true,
        // ⚠ resignDate.resignReason.employmentStatus 는 **건드리지 않는다**.
        //   퇴직자 현황이 resignDate 로만 월/연을 집계하므로, 여기서 지우면 그 사람이
        //   과거 통계에서 영구히 사라진다(2026-09-08 6차 검증에서 적발 — 내가 넣었다가 되돌림).
        //   휴지통은 "퇴사자만" 들어오는 곳이라 지우는 게 특히 나쁘다.
        //   퇴사 상태를 풀 필요가 있으면 직원 수정에서 퇴사일을 비우면 된다.
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

    await logAudit({
      actorId: session.userId, actorName: session.name, action: "EMPLOYEE_RESTORE",
      targetType: "USER", targetId: id, targetName: restoredUser.name, detail: "직원 복구",
    });

    // 되살렸는데 "비활성" 캐시가 30초 남아 있으면 그 동안 로그인이 안 된다
    clearSessionCache(id);

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
