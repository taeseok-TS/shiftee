import { NextRequest, NextResponse } from "next/server";
import { getSession, bumpTokenVersion, issueSessionFor } from "@/lib/auth";
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

    // 비밀번호 업데이트 (본인이 바꿨으므로 임시 비번 상태 해제 → 봇 변경 요청 알림 중단)
    await prisma.user.update({
      where: { id: session.userId },
      data: { password: hashedPassword, passwordResetAt: null },
    });

    // 다른 기기에 남아 있는 세션을 전부 끊는다 (2026-09-08 디렉터 지시).
    // "폰을 잃어버려서 비번을 바꿨다"가 정작 그 폰의 세션을 못 끊으면 의미가 없다.
    // 파일 열람 티켓도 함께 죽는다(티켓에 이 번호가 새겨져 있다).
    //
    // ⚠ 지금 바꾸고 있는 **이 기기만** 새 번호로 다시 발급해 살린다. 안 그러면
    //   비밀번호를 바꾸자마자 본인이 튕긴다. 웹은 쿠키가 여기서 갱신되고,
    //   앱은 아래 token 을 저장해 쓴다.
    //
    // ⚠⚠ 여기는 **토큰을 새로 찍는 세 번째 자리**다(로그인.갱신 다음). 로그인과 갱신은
    //     재직 여부를 다시 확인하는데 여기만 안 하면, 퇴사자가 현재 비번으로 이 API 를
    //     7일마다 한 번씩 눌러 **무기한 세션을 연장**할 수 있다. getSession 은
    //     tokenVersion 만 보고 resignDate.isActive 를 보지 않는다.
    //     (미래 퇴사일은 그날이 지나도 tokenVersion 이 저절로 오르지 않는다 — 배치가 없다)
    //     그래서 DB 를 다시 읽어 갱신 라우트와 **같은 기준**으로 판정한다.
    // 토큰은 **헤더로 인증한 요청(앱)** 에만 돌려준다. 웹은 httpOnly 쿠키로만 다루는데
    // 여기서 body 에 실으면 그 응답만 스크립트가 읽을 수 있게 된다.
    const isBearer = !!request.headers.get("authorization");

    let token: string | null = null;
    let sessionEnded = false;
    let bumped = false; // 무효화가 이미 됐는지 — catch 에서 두 경우를 구분해야 한다
    try {
      // 무효화를 **먼저** 한다. 앞에 다른 DB 조회를 두면 그게 실패했을 때
      // 무효화가 통째로 건너뛰어지는데 응답은 "성공"이 된다(2026-09-08 적발).
      // bumpTokenVersion 은 실패하면 SystemErrorLog 를 남기고 다시 던진다.
      await bumpTokenVersion(session.userId);
      bumped = true;

      // 재직 중일 때만 이 기기를 살린다. 재직 검사.DB 재조회는 발급 함수 안에 있다.
      token = await issueSessionFor(session.userId, { setCookie: !isBearer });
      if (!token) sessionEnded = true;
    } catch (e) {
      // 비밀번호는 이미 바뀌었다. 여기서 500 을 내면 사용자는 "실패했다"고 믿고
      // 옛 비번을 계속 쓴다 — 그게 더 위험하다.
      console.error("[password] 세션 처리 실패(비밀번호는 변경됨):", session.userId, e);

      // ⚠ 두 경우를 구분해야 한다.
      //   무효화 **전** 실패 → 세션은 안 끊겼다. 이 기기도 그대로 쓰면 된다.
      //   무효화 **후** 재발급 실패 → 이 기기 세션은 **이미 죽었다.** 그걸 숨기고
      //   "완료"라고만 하면 사용자는 다음 화면부터 영문 모를 오류를 본다.
      if (bumped) {
        sessionEnded = true;
        await prisma.systemErrorLog.create({
          data: {
            path: "/api/profile/password (세션 재발급)", method: "PATCH",
            message: `비밀번호 변경 후 세션 재발급 실패 — userId=${session.userId}. 사용자는 다시 로그인해야 합니다.`,
          },
        }).catch(() => {});
      }
    }

    return NextResponse.json({
      success: true,
      token: isBearer ? token : undefined,
      sessionEnded,
      message: sessionEnded
        ? "비밀번호가 변경되었습니다. 보안을 위해 다시 로그인해주세요."
        : "비밀번호가 변경되었습니다.",
    });
  } catch (error) {
    console.error("PATCH /api/profile/password 에러:", error);
    return NextResponse.json({ error: "비밀번호 변경에 실패했습니다." }, { status: 500 });
  }
}
