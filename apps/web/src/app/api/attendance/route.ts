import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const year   = parseInt(searchParams.get("year")  || String(new Date().getFullYear()));
  const month  = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));
  const userId = searchParams.get("userId") || session.userId;

  const startDate = new Date(year, month - 1, 1);
  const endDate   = new Date(year, month, 0);

  // 접근 범위 결정
  let userWhere: Record<string, unknown>;
  if (session.role === "EMPLOYEE") {
    userWhere = { userId: session.userId };
  } else if (session.role === "MANAGER") {
    // 지정 userId가 같은 지점 소속인지 확인
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { branch: true } });
    if (target && target.branch === session.branch) {
      userWhere = { userId };
    } else {
      // 지점 구성원 전체
      userWhere = { user: { branch: session.branch } };
    }
  } else {
    userWhere = { userId };
  }

  const records = await prisma.attendance.findMany({
    where: { ...userWhere, date: { gte: startDate, lte: endDate } },
    include: { user: { select: { name: true } } },
    orderBy: { date: "desc" },
  });

  return NextResponse.json({ records });
}
