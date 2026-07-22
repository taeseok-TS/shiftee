import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { annualLeaveDays, currentLeaveYear } from "@/lib/leave-calc";
import { getManagerBranches } from "@/lib/manager-branches";

// 근속기간 기반 연차 자동계산 → 총연차 일괄 반영 (관리자/원장)
export async function POST() {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const branchWhere = session.role === "MANAGER" ? { branch: { in: myBranches } } : {};
  const employees = await prisma.user.findMany({
    where: { isActive: true, hireDate: { not: null }, ...branchWhere },
    select: { id: true, hireDate: true },
  });

  const now = new Date();
  const year = currentLeaveYear();
  let updated = 0;

  for (const emp of employees) {
    const total = annualLeaveDays(new Date(emp.hireDate!), now);
    const bal = await prisma.leaveBalance.findUnique({
      where: { userId_year: { userId: emp.id, year } },
      select: { used: true },
    });
    const used = bal?.used ?? 0;
    const remaining = Math.max(0, total - used);
    await prisma.leaveBalance.upsert({
      where: { userId_year: { userId: emp.id, year } },
      create: { userId: emp.id, year, total, used, remaining },
      update: { total, remaining },
    });
    updated++;
  }

  return NextResponse.json({ success: true, updated });
}
