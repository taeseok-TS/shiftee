import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { botSendDM } from "@/lib/bot";
import { logAudit } from "@/lib/audit";

// 비밀번호 셀프 재설정 2단계 — 이메일 링크의 토큰으로 새 비밀번호 설정 (무인증 공개 라우트)

async function findValidToken(token: string) {
  if (!token || token.length < 32) return null;
  const row = await prisma.passwordResetToken.findUnique({ where: { token }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  if (!row.user.isActive || row.user.deletedAt) return null;
  return row;
}

// 페이지 진입 시 토큰 유효성 확인 (만료 링크에 비번을 쳐 넣는 헛수고 방지)
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token") || "";
  const row = await findValidToken(token);
  if (!row)
    return NextResponse.json({ valid: false, error: "링크가 만료되었거나 이미 사용되었습니다. 다시 요청해주세요." }, { status: 400 });
  return NextResponse.json({ valid: true, name: row.user.name });
}

// 프로필 비밀번호 변경과 동일한 정책 (8자·대문자·숫자·특수문자)
function validatePasswordStrength(password: string): { valid: boolean; message?: string } {
  if (!password || password.length < 8) return { valid: false, message: "비밀번호는 최소 8자 이상이어야 합니다." };
  if (!/[A-Z]/.test(password)) return { valid: false, message: "비밀번호는 대문자를 포함해야 합니다." };
  if (!/[0-9]/.test(password)) return { valid: false, message: "비밀번호는 숫자를 포함해야 합니다." };
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password))
    return { valid: false, message: "비밀번호는 특수문자를 포함해야 합니다." };
  return { valid: true };
}

export async function POST(request: NextRequest) {
  const { token, password } = await request.json().catch(() => ({}));
  const row = await findValidToken(token || "");
  if (!row)
    return NextResponse.json({ error: "링크가 만료되었거나 이미 사용되었습니다. 다시 요청해주세요." }, { status: 400 });

  const strength = validatePasswordStrength(password || "");
  if (!strength.valid) return NextResponse.json({ error: strength.message }, { status: 400 });

  const hashed = await bcrypt.hash(password, 10);
  // 토큰 사용 처리와 비번 변경을 함께 — 재사용 레이스 방지
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { password: hashed } }),
    prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);

  // 본인에게 보안 알림 + 감사 흔적 (실패해도 응답은 성공)
  botSendDM(row.userId, "🔐 비밀번호가 방금 변경되었습니다.\n본인이 아니라면 즉시 관리자에게 알려주세요.").catch(() => {});
  logAudit({
    actorId: row.userId, actorName: row.user.name, action: "PASSWORD_RESET_SELF",
    targetType: "USER", targetId: row.userId, targetName: row.user.name,
    detail: "이메일 재설정 링크로 본인이 비밀번호 변경",
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
