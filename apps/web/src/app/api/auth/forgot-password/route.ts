import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { sendPasswordReset } from "@/lib/email";

// 비밀번호 셀프 재설정 1단계 — 이메일로 재설정 링크 발송 (무인증 공개 라우트).
// 관리자 초기화 업무를 없애기 위한 것 (2026-08-25 로그인 대란 후속, 디렉터 지시).
export async function POST(request: NextRequest) {
  const { email } = await request.json().catch(() => ({}));
  if (!email?.trim())
    return NextResponse.json({ error: "이메일을 입력해주세요." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email: email.trim() } });

  // 디렉터 확정 문구 — 계정을 못 찾으면 관리자 문의 안내 (사내 시스템이라 존재 여부 숨기지 않음)
  if (!user || !user.isActive || user.deletedAt)
    return NextResponse.json(
      { error: "등록된 이메일이 아닙니다. 관리자에게 문의해 주세요." },
      { status: 404 }
    );

  // 연타 방지 — 3분 내 발송한 미사용 링크가 있으면 재발송하지 않는다
  const recent = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, usedAt: null, createdAt: { gt: new Date(Date.now() - 3 * 60 * 1000) } },
  });
  if (recent)
    return NextResponse.json(
      { error: "재설정 메일을 이미 보냈습니다. 메일함(스팸함 포함)을 확인하시고, 3분 후에 다시 시도해주세요." },
      { status: 429 }
    );

  // 기존 미사용 토큰 무효화 후 새 토큰 (1시간 유효, 1회용)
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await prisma.passwordResetToken.create({
    data: { userId: user.id, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });

  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://cubetee.co.kr";
  await sendPasswordReset(user.email, user.name, `${base}/reset-password/${token}`);

  return NextResponse.json({ success: true });
}
