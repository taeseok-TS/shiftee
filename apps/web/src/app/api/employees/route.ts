import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const employees = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true, email: true, role: true,
      department: true, position: true, hireDate: true, phone: true,
      leaveBalance: { select: { remaining: true, used: true, total: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ employees });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = await request.json();
  const { name, email, password, role, department, position, phone, hireDate } = body;

  if (!name || !email || !password) {
    return NextResponse.json({ error: "이름, 이메일, 비밀번호는 필수입니다." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "이미 사용 중인 이메일입니다." }, { status: 409 });

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name, email, password: hashedPassword,
      role: role || "EMPLOYEE",
      department, position, phone,
      hireDate: hireDate ? new Date(hireDate) : null,
    },
  });

  await prisma.leaveBalance.create({
    data: {
      userId: user.id,
      year: new Date().getFullYear(),
      total: 15, used: 0, remaining: 15,
    },
  });

  return NextResponse.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
}
