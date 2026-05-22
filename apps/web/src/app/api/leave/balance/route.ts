import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 잔여 휴가 조회
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  if (session.role === "EMPLOYEE") {
    // 본인 잔여 휴가만
    const balance = await prisma.leaveBalance.findUnique({
      where: { userId: session.userId },
    });
    return NextResponse.json({ balance });
  }

  // 관리자/매니저: 직원 잔여 현황
  const branchWhere = session.role === "MANAGER" ? { branch: session.branch } : {};

  const [employees, balances] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, ...branchWhere },
      select: { id: true, name: true, department: true, position: true },
      orderBy: [{ department: "asc" }, { name: "asc" }],
    }),
    prisma.leaveBalance.findMany(),
  ]);

  const balanceMap = new Map(balances.map(b => [b.userId, b]));
  const year = new Date().getFullYear();

  const result = employees.map(emp => {
    const b = balanceMap.get(emp.id);
    return {
      userId:    emp.id,
      name:      emp.name,
      department: emp.department ?? "-",
      position:  emp.position   ?? "-",
      balanceId: b?.id       ?? null,
      year:      b?.year     ?? year,
      total:     b?.total    ?? 15,
      used:      b?.used     ?? 0,
      remaining: b?.remaining ?? 15,
    };
  });

  return NextResponse.json({ balances: result });
}

// 관리자: 잔여 휴가 조정
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { userId, total, used } = await request.json();
  if (!userId || total === undefined) {
    return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
  }

  const usedVal      = used      ?? 0;
  const remainingVal = total - usedVal;

  const balance = await prisma.leaveBalance.upsert({
    where:  { userId },
    create: { userId, year: new Date().getFullYear(), total, used: usedVal, remaining: remainingVal },
    update: { total, used: usedVal, remaining: remainingVal },
  });

  return NextResponse.json({ success: true, balance });
}
