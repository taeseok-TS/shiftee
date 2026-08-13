import { NextResponse } from "next/server";
import { getSession, signToken } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 토큰 갱신 — 아직 유효한 토큰이면 새 7일 토큰 발급 (슬라이딩 세션).
// 앱이 실행/포그라운드 복귀할 때마다 호출하므로, 일주일에 한 번만 열어도 로그인이 유지된다.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // 최신 상태로 재발급 (퇴사 처리된 계정 차단 + 이름/지점 변경 반영)
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, role: true, name: true, branch: true, isActive: true },
  });
  if (!user || !user.isActive)
    return NextResponse.json({ error: "사용할 수 없는 계정입니다." }, { status: 401 });

  const token = await signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    branch: user.branch,
  });
  return NextResponse.json({ success: true, token });
}
