import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import bcrypt from "bcryptjs";

/**
 * PATCH /api/employees/[id]/reset-password - 관리자가 직원의 비밀번호 초기화
 * 비밀번호를 "12345678"로 설정 (8자 규칙 안내와의 인지 충돌 제거 — 2026-08-25)
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();

  // 관리자만 가능
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json(
      { error: "관리자만 비밀번호를 초기화할 수 있습니다." },
      { status: 403 }
    );
  }

  const { id } = await params;

  try {
    // 사용자 존재 여부 확인
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true },
    });

    if (!user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    // 관리자(ADMIN) 계정 비밀번호 초기화는 메인 관리자 전용 (계정 탈취 방지)
    if (user.role === "ADMIN" && !(await isSuperAdmin(session.userId))) {
      return NextResponse.json({ error: "관리자 계정 관리는 메인 관리자만 가능합니다." }, { status: 403 });
    }

    // 비밀번호 해싱 (임시 비번 12345678)
    const hashedPassword = await bcrypt.hash("12345678", 10);

    // 비밀번호 업데이트 + 초기화 시각 기록 (24시간 후에도 그대로면 봇이 변경 요청 알림)
    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword, passwordResetAt: new Date() },
    });

    await logAudit({
      actorId: session.userId,
      actorName: session.name,
      action: "PASSWORD_RESET",
      targetType: "USER",
      targetId: id,
      targetName: user.name,
      detail: "비밀번호를 임시 비번(12345678)으로 초기화",
    });

    return NextResponse.json({
      success: true,
      message: `${user.name}의 비밀번호가 초기화되었습니다. (기본 비밀번호: 12345678)`,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("PATCH /api/employees/[id]/reset-password 에러:", error);
    return NextResponse.json({ error: "비밀번호 초기화에 실패했습니다." }, { status: 500 });
  }
}
