import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 채팅 대상자 목록: 전 직원 + 관리자·서브관리자(role ADMIN) 포함, 회사 전체(지점 무관).
// 클라이언트에서 기본엔 관리자를 숨기고 검색 시 노출한다(role 필드로 구분).
//
// ⚠ **화면에 그리는 것만 내려준다** — 이름.지점, 그리고 관리자 숨김용 role.
//   종전에는 부서.직책도 함께 나갔는데 웹.앱 어느 화면도 쓰지 않았다. 화면에 안 보여도
//   응답에 실리면 개발자도구로 전 직원 것을 그대로 가져갈 수 있다
//   (디렉터 지시: 일반 직원에게 다른 직원 정보가 보이면 안 된다. 채팅은 **직원명.지점명**만).
//   여기에 필드를 더할 때는 그 필드가 화면에 실제로 쓰이는지 먼저 확인할 것.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const users = await prisma.user.findMany({
    where: { isActive: true, id: { not: session.userId } },
    select: { id: true, name: true, branch: true, role: true },
    orderBy: [{ name: "asc" }],
  });

  return NextResponse.json({ members: users });
}
