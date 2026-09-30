import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin, bumpTokenVersion } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import bcrypt from "bcryptjs";
import { generateTempPassword } from "@/lib/temp-password";
import { sendTempPassword } from "@/lib/email";

/**
 * PATCH /api/employees/[id]/reset-password - 관리자가 직원의 비밀번호 초기화
 * 매번 **무작위 임시 비밀번호**로 바꾸고 등록 이메일로 보낸다. 관리자 화면에도 응답으로 한 번만 보여 준다
 * (메일을 못 보는 직원은 관리자가 불러 준다). 2026-09-30 디렉터 지시 — 종전 고정값 12345678 은 누구나 알아서,
 * 계정을 일부러 잠가 초기화를 유도한 뒤 그 값으로 들어오는 길이 열려 있었다.
 * 임시 비밀번호는 감사 로그·서버 로그에 남기지 않는다.
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

    // 무작위 임시 비밀번호
    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // 비밀번호 업데이트 + 초기화 시각 기록 (24시간 후에도 그대로면 봇이 변경 요청 알림)
    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword, passwordResetAt: new Date() },
    });

    // 비밀번호가 바뀌었으면 그 사람의 **기존 세션을 전부 끊는다**.
    // "폰을 잃어버려서 비번을 바꿨다"가 정작 탈취된 세션을 못 끊으면 의미가 없다
    // (2026-09-07 검증에서 적발). 새 비번으로 다시 로그인하면 된다.
    await bumpTokenVersion(id).catch(() => {});
    // 개인 API 키도 전부 끈다 — 계정이 넘어갔을 가능성을 전제로 초기화하는 것이라 키도 같은 취급(2026-09-13 기획 2-4 ⑨)
    const orgKeys = await prisma.apiKey.findMany({ where: { userId: id, kind: "ORG", revokedAt: null }, select: { name: true } }).catch(() => []);
    await prisma.apiKey.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: session.userId } }).catch(() => {});
    // 회사 연동 키(큐브마케팅 등)가 같이 꺼지면 연동이 조용히 끊긴다 — 본부 전원에게 알린다(2026-09-14 검증관)
    if (orgKeys.length) {
      const { notifyOrgKeysRevoked } = await import("@/lib/api-key");
      void notifyOrgKeysRevoked(orgKeys.map((k) => k.name), `${user.name} 님 비밀번호 초기화`);
    }

    // 등록 이메일로 보낸다 — 성공 여부를 관리자에게 알린다(실패하면 화면의 비밀번호를 직접 전달)
    const emailed = await sendTempPassword(user.email, user.name, tempPassword, "reset");

    await logAudit({
      actorId: session.userId,
      actorName: session.name,
      action: "PASSWORD_RESET",
      targetType: "USER",
      targetId: id,
      targetName: user.name,
      detail: `비밀번호를 무작위 임시 비밀번호로 초기화 · 메일 ${emailed ? "발송" : "발송 실패"}`,
    });

    return NextResponse.json({
      success: true,
      message: emailed
        ? `${user.name} 님의 비밀번호를 초기화하고 임시 비밀번호를 ${user.email} 로 보냈습니다.`
        : `${user.name} 님의 비밀번호를 초기화했지만 메일을 보내지 못했습니다. 아래 임시 비밀번호를 직접 전달해주세요.`,
      tempPassword, // 이 응답에서 한 번만 — 다시 볼 수 없다
      emailed,
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
