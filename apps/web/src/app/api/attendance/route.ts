import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
  const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));
  const userId = searchParams.get("userId") || session.userId;

  // 관리자가 아니면 본인 것만
  const targetUserId = session.role === "EMPLOYEE" ? session.userId : userId;

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const records = await prisma.attendance.findMany({
    where: {
      userId: targetUserId,
      date: { gte: startDate, lte: endDate },
    },
    include: { user: { select: { name: true } } },
    orderBy: { date: "desc" },
  });

  return NextResponse.json({ records });
}
