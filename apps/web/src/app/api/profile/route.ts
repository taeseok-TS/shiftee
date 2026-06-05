import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/profile - 현재 로그인한 사용자의 프로필 조회
 */
export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        department: true,
        jobGroup: true,
        position: true,
        branch: true,
        hireDate: true,
        role: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("GET /api/profile 에러:", error);
    return NextResponse.json({ error: "프로필 조회에 실패했습니다." }, { status: 500 });
  }
}

/**
 * PATCH /api/profile - 현재 로그인한 사용자의 프로필 수정
 */
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, phone } = body;

    // 유효성 검사
    const errors: string[] = [];

    if (name !== undefined && name !== null) {
      if (typeof name !== "string" || name.trim().length === 0) {
        errors.push("이름은 필수입니다.");
      } else if (name.length > 50) {
        errors.push("이름은 50자 이하여야 합니다.");
      }
    }

    if (phone !== undefined && phone !== null) {
      if (typeof phone !== "string") {
        errors.push("전화번호는 문자열이어야 합니다.");
      } else if (phone.trim().length > 0) {
        // 전화번호 정규식: 010-XXXX-XXXX 또는 빈 문자열
        const phoneRegex = /^01[0-9]-\d{3,4}-\d{4}$/;
        if (!phoneRegex.test(phone)) {
          errors.push("전화번호는 010-XXXX-XXXX 형식이어야 합니다.");
        }
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors[0] }, { status: 400 });
    }

    // 업데이트 데이터 구성
    const updateData: any = {};
    if (name !== undefined) {
      updateData.name = name.trim();
    }
    if (phone !== undefined) {
      updateData.phone = phone.trim() || null;
    }

    // 업데이트 (수정할 필드가 없으면 스킵)
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "수정할 정보가 없습니다." }, { status: 400 });
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        department: true,
        jobGroup: true,
        position: true,
        branch: true,
        hireDate: true,
        role: true,
      },
    });

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error("PATCH /api/profile 에러:", error);
    return NextResponse.json({ error: "프로필 수정에 실패했습니다." }, { status: 500 });
  }
}
