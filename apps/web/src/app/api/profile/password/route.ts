import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

/**
 * 비밀번호 강도 검증
 * - 최소 8자
 * - 대문자 포함
 * - 숫자 포함
 * - 특수문자 포함
 */
function validatePasswordStrength(password: string): { valid: boolean; message?: string } {
  if (!password || password.length < 8) {
    return { valid: false, message: "비밀번호는 최소 8자 이상이어야 합니다." };
  }

  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: "비밀번호는 대문자를 포함해야 합니다." };
  }

  if (!/[0-9]/.test(password)) {
    return { valid: false, message: "비밀번호는 숫자를 포함해야 합니다." };
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, message: "비밀번호는 특수문자를 포함해야 합니다." };
  }

  return { valid: true };
}

/**
 * PATCH /api/profile/password - 비밀번호 변경
 */
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { currentPassword, newPassword, confirmPassword } = body;

    // 필수 필드 확인
    if (!currentPassword || !newPassword || !confirmPassword) {
      return NextResponse.json(
        { error: "현재 비밀번호, 새 비밀번호, 비밀번호 확인은 필수입니다." },
        { status: 400 }
      );
    }

    // 새 비밀번호와 확인 비밀번호 일치 확인
    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: "새 비밀번호가 일치하지 않습니다." }, { status: 400 });
    }

    // 새 비밀번호 강도 검증
    const strengthCheck = validatePasswordStrength(newPassword);
    if (!strengthCheck.valid) {
      return NextResponse.json({ error: strengthCheck.message }, { status: 400 });
    }

    // 현재 비밀번호 검증
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { password: true },
    });

    if (!user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    const isPasswordCorrect = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordCorrect) {
      return NextResponse.json({ error: "현재 비밀번호가 올바르지 않습니다." }, { status: 401 });
    }

    // 새 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 비밀번호 업데이트
    await prisma.user.update({
      where: { id: session.userId },
      data: { password: hashedPassword },
    });

    return NextResponse.json({ success: true, message: "비밀번호가 변경되었습니다." });
  } catch (error) {
    console.error("PATCH /api/profile/password 에러:", error);
    return NextResponse.json({ error: "비밀번호 변경에 실패했습니다." }, { status: 500 });
  }
}
