import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 채팅 대상자 목록: 전 직원 + 관리자·서브관리자(role ADMIN) 포함, 회사 전체(지점 무관).
// 클라이언트에서 기본엔 관리자를 숨기고 검색 시 노출한다(role 필드로 구분).
//
// ⚠ **화면에 그리는 것만 내려준다** — 이름.지점.직책, 그리고 관리자 숨김용 role.
//   직책은 **한 지점에 동명이인이 있을 때 구분하려고** 넣는다(2026-09-09 디렉터 지시).
//   부서는 뺐다 — 사람을 고르는 데 쓰이지 않는데 응답에만 실려 나갔고, 화면에 안 보여도
//   개발자도구로 전 직원 것을 그대로 가져갈 수 있다
//   (디렉터 지시: 일반 직원에게 다른 직원 정보가 보이면 안 된다).
//   여기에 필드를 더할 때는 그 필드가 화면에 실제로 쓰이는지 먼저 확인할 것.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const users = await prisma.user.findMany({
    where: { isActive: true, id: { not: session.userId } },
    select: { id: true, name: true, branch: true, position: true, role: true },
    orderBy: [{ name: "asc" }],
  });

  return NextResponse.json({ members: users });
}
