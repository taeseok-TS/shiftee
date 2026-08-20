import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { setSession } from "@/lib/auth";
import { isResigned } from "@/lib/resign";
import { logAudit } from "@/lib/audit";

export async function POST(request: NextRequest) {
  try {
    const { email, password, deviceId, deviceName, platform } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "이메일과 비밀번호를 입력해주세요." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
    }

    // 퇴사자 차단 — 퇴사일 '당일'은 마지막 근무일이라 로그인이 되어야 한다(출퇴근 기록).
    // 날짜 필드는 UTC 자정 저장이므로 기준도 KST 오늘의 자정으로 맞춘다.
    if (isResigned(user.resignDate)) {
      return NextResponse.json(
        { error: "퇴사 처리된 계정입니다. 잘못된 경우 관리자에게 문의해주세요." },
        { status: 403 }
      );
    }

    // 기기 등록 검사 (앱 로그인만 — deviceId를 보내는 클라이언트). 관리자(ADMIN)는 예외.
    // 첫 앱 로그인 시 그 기기를 자동 등록, 이후 다른 기기에서는 로그인 차단(대리 출퇴근 방지).
    // 기기 변경 시 관리자가 직원관리에서 "기기 초기화" 후 재로그인하면 새 기기로 등록된다.
    // 스토어 심사용 데모 계정은 예외 — 심사관 여러 명이 서로 다른 기기로 로그인해도 차단되지 않게
    const DEVICE_LOCK_EXEMPT = ["review@cubetee.co.kr"];
    if (deviceId && user.role !== "ADMIN" && !DEVICE_LOCK_EXEMPT.includes(user.email)) {
      let registered = await prisma.userDevice.findUnique({ where: { userId: user.id } });
      if (!registered) {
        try {
          await prisma.userDevice.create({
            data: { userId: user.id, deviceId, deviceName: deviceName ?? null, platform: platform ?? null },
          });
        } catch {
          // 동시 첫 로그인 레이스(unique 충돌): 먼저 등록된 기기를 다시 읽어 비교
          registered = await prisma.userDevice.findUnique({ where: { userId: user.id } });
        }
      }
      if (registered && registered.deviceId !== deviceId) {
        // 같은 폰에서 앱만 다시 깐 경우를 통과시킨다.
        // 안드로이드는 SecureStore 가 앱 데이터와 함께 지워져 재설치하면 새 UUID 가 발급된다
        // (iOS 는 키체인이라 유지). APK → 플레이스토어 전환처럼 전원이 재설치하는 상황에서
        // 이걸 막으면 멀쩡한 본인 폰인데 전부 로그인이 안 된다.
        // 기기 이름은 재설치해도 그대로이므로, 이름과 플랫폼이 정확히 같으면 동일 기기로 본다.
        // (이름이 없거나 다르면 종전대로 차단 — 다른 사람 폰은 계속 막힌다)
        const sameDevice =
          !!deviceName &&
          !!registered.deviceName &&
          registered.deviceName === deviceName &&
          registered.platform === platform;

        if (!sameDevice) {
          return NextResponse.json(
            { error: "등록되지 않은 기기입니다. 등록된 본인 휴대폰에서만 로그인할 수 있습니다. 기기를 변경했다면 관리자에게 기기 초기화를 요청해주세요." },
            { status: 403 }
          );
        }

        // 같은 기기로 판단 — 새 식별자로 갱신하고 흔적을 남긴다.
        await prisma.userDevice.update({
          where: { userId: user.id },
          data: { deviceId, deviceName, platform: platform ?? null },
        });
        await logAudit({
          actorId: user.id,
          actorName: user.name,
          action: "DEVICE_REREGISTER",
          targetType: "UserDevice",
          targetId: user.id,
          targetName: user.name,
          detail: `앱 재설치로 기기 식별자 갱신 — ${deviceName} (${platform ?? "-"})`,
        });
      }
    }

    const token = await setSession({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      branch: user.branch ?? null,
    });

    return NextResponse.json({
      success: true,
      // 웹은 쿠키로 인증하므로 token을 무시. 모바일은 이 token을 저장해
      // Authorization: Bearer 헤더로 사용한다.
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
