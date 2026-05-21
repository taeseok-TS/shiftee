import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

// 개발용 시드 API (운영 시 제거)
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "운영 환경에서는 사용할 수 없습니다." }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { email: "admin@shiftee.com" } });
  if (existing) {
    return NextResponse.json({ message: "이미 시드 데이터가 존재합니다.", admin: { email: "admin@shiftee.com", password: "admin1234" } });
  }

  const hashedPassword = await bcrypt.hash("admin1234", 10);

  const admin = await prisma.user.create({
    data: {
      email: "admin@shiftee.com",
      password: hashedPassword,
      name: "관리자",
      role: "ADMIN",
      department: "경영",
      position: "대표",
      hireDate: new Date("2020-01-01"),
    },
  });

  // 직원 계정 2개
  const employees = await Promise.all([
    prisma.user.create({
      data: {
        email: "kim@shiftee.com",
        password: await bcrypt.hash("1234", 10),
        name: "김민준",
        role: "EMPLOYEE",
        department: "개발팀",
        position: "개발자",
        hireDate: new Date("2023-03-01"),
      },
    }),
    prisma.user.create({
      data: {
        email: "lee@shiftee.com",
        password: await bcrypt.hash("1234", 10),
        name: "이서연",
        role: "EMPLOYEE",
        department: "디자인팀",
        position: "디자이너",
        hireDate: new Date("2024-01-15"),
      },
    }),
  ]);

  // 직원 휴가 잔여 초기화
  await Promise.all(employees.map(emp =>
    prisma.leaveBalance.create({
      data: { userId: emp.id, year: new Date().getFullYear(), total: 15, used: 0, remaining: 15 },
    })
  ));

  return NextResponse.json({
    message: "시드 데이터가 생성되었습니다.",
    accounts: [
      { role: "관리자", email: "admin@shiftee.com", password: "admin1234" },
      { role: "직원", email: "kim@shiftee.com", password: "1234" },
      { role: "직원", email: "lee@shiftee.com", password: "1234" },
    ],
  });
}
