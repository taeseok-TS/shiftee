import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 채팅 대상자 목록: 전 직원 + 관리자·서브관리자(role ADMIN) 포함, 회사 전체(지점 무관).
// 클라이언트에서 기본엔 관리자를 숨기고 검색 시 노출한다(role 필드로 구분).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const users = await prisma.user.findMany({
    where: { isActive: true, id: { not: session.userId } },
    select: { id: true, name: true, department: true, position: true, branch: true, role: true },
    orderBy: [{ name: "asc" }],
  });

  return NextResponse.json({ members: users });
}
