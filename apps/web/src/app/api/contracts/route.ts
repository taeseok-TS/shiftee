import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const contracts = await prisma.contract.findMany({
    where: session.role === "EMPLOYEE" ? { userId: session.userId } : {},
    include: { user: { select: { name: true, department: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ contracts });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = await request.json();
  const { userId, title, type, startDate, endDate } = body;

  if (!userId || !title || !type) {
    return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
  }

  const contract = await prisma.contract.create({
    data: {
      userId,
      title,
      type,
      fileUrl: "", // 실제 파일 업로드는 추후 구현
      status: "SENT",
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
    },
  });

  return NextResponse.json({ success: true, contract });
}
