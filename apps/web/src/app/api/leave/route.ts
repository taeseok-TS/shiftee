import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;

  const where =
    session.role === "EMPLOYEE"
      ? { userId: session.userId, ...(status ? { status: status as never } : {}) }
      : status ? { status: status as never } : {};

  const requests = await prisma.leaveRequest.findMany({
    where,
    include: {
      user: { select: { name: true, department: true } },
      approver: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ requests });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const body = await request.json();
  const { type, startDate, endDate, reason } = body;

  if (!type || !startDate || !endDate) {
    return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  let days = 1;

  if (type === "HALF_AM" || type === "HALF_PM") {
    days = 0.5;
  } else {
    const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    days = diff;
  }

  const leaveRequest = await prisma.leaveRequest.create({
    data: {
      userId: session.userId,
      type,
      startDate: start,
      endDate: end,
      days,
      reason,
      status: "PENDING",
    },
  });

  return NextResponse.json({ success: true, leaveRequest });
}
