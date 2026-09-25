import { NextRequest, NextResponse } from "next/server";
import { syncMainManagerFor } from "@/lib/manager-branches";
import { getSession, isSuperAdmin, bumpTokenVersion } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { kstTodayMidnight } from "@/lib/resign";

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

    // 관리자(ADMIN) 계정 퇴사 처리는 메인 관리자 전용 (관리자 잠금 방지)
    if (user.role === "ADMIN" && !(await isSuperAdmin(session.userId))) {
      return NextResponse.json(
        { error: "관리자 계정 관리는 메인 관리자만 가능합니다." },
        { status: 403 }
      );
    }

    // 퇴사 처리
    const resignDateObj = new Date(resignDate);
    // ⚠ 이 라우트는 서브 관리자 계정을 **즉시 잠그는** 화면(관리자 계정 관리) 전용이다.
    //   "퇴사일 당일은 재직" 규칙을 여기에 적용했더니 업무시간(KST)에는 아무 일도 안 일어났다
    //   — 화면은 "비활성화됩니다"라고 안내하는데 그 관리자가 바로 다시 로그인했다(검증 resignchat1 R3).
    //   그래서 이 화면은 종전대로 즉시 비활성으로 둔다. 일반 직원 퇴사는 직원 수정(PATCH)에서 한다.
    const pastResign = resignDateObj < kstTodayMidnight();
    const updated = await prisma.user.update({
      where: { id },
      data: {
        employmentStatus: "RESIGNED",
        resignDate: resignDateObj,
        resignReason: resignReason || null,
        isActive: false,
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

    // 이미 발급된 토큰을 **즉시** 무효화한다 (2026-09-07 디렉터 지시).
    // 종전에는 토큰이 7일짜리라, 퇴사 처리를 해도 그 사람 폰에 살아 있는 토큰으로
    // 남은 기간 동안 출퇴근을 계속 찍을 수 있었다.
    await bumpTokenVersion(id).catch(() => {});

    // 메인 원장 지정을 정리한다 — 떠난 사람이 못박힌 채 남으면 그 지점 결재가 멈춘다
    await syncMainManagerFor(id);

    // 퇴사일이 지났으면 큐브티워크 채팅방에서도 바로 내보낸다(2026-09-23 디렉터 지시).
    // 미래 퇴사일은 그날 아침 쓸이가 처리한다.
    if (pastResign) {
      const { cleanupResignedUserChannels } = await import("@/lib/resign-chat-cleanup");
      await cleanupResignedUserChannels(id).catch((e) => console.error("[퇴사 채팅 정리] 실패:", id, e));
    }

    await logAudit({
      actorId: session.userId, actorName: session.name, action: "EMPLOYEE_RESIGN",
      targetType: "USER", targetId: id, targetName: updated.name,
      detail: `퇴사 처리 (${resignDate}${resignReason ? ", " + resignReason : ""})`,
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
