import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 모바일 푸시 토큰 등록 (로그인 후 호출)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { token, platform } = await request.json();
  if (typeof token !== "string" || !token.trim())
    return NextResponse.json({ error: "토큰이 필요합니다." }, { status: 400 });

  // 같은 토큰이 다른 계정에 묶여 있을 수 있으므로(기기 공유/재로그인) upsert 로 소유자 갱신
  await prisma.pushToken.upsert({
    where: { token },
    create: { token, platform: platform ?? null, userId: session.userId },
    update: { userId: session.userId, platform: platform ?? null },
  });

  return NextResponse.json({ ok: true });
}

// 로그아웃 시 토큰 해제
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { token } = await request.json();
  if (typeof token !== "string" || !token.trim())
    return NextResponse.json({ error: "토큰이 필요합니다." }, { status: 400 });

  await prisma.pushToken
    .deleteMany({ where: { token, userId: session.userId } })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
