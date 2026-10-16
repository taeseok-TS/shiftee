import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currentLeaveYear } from "@/lib/leave-calc";
import { kstDate, yearTotalAsOf } from "@/lib/leave-accrual";
import { getManagerBranches } from "@/lib/manager-branches";
import { logAudit } from "@/lib/audit";

// 연차 자동계산 → 총연차 일괄 반영 (관리자/원장). 2026-10-16 #31: 회계연도 기준 오늘까지 발생(월차·첫 해 비례·1/1 기준 근속 가산)
export async function POST() {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const branchWhere = session.role === "MANAGER" ? { branch: { in: myBranches } } : {};
  const employees = await prisma.user.findMany({
    where: { isActive: true, hireDate: { not: null }, ...branchWhere },
    select: { id: true, name: true, hireDate: true, resignDate: true },
  });

  const year = currentLeaveYear();
  let updated = 0;

  for (const emp of employees) {
    const total = yearTotalAsOf(kstDate(emp.hireDate!), year, undefined, emp.resignDate ? kstDate(emp.resignDate) : null);
    const bal = await prisma.leaveBalance.findUnique({
      where: { userId_year: { userId: emp.id, year } },
      select: { used: true, total: true },
    });
    const used = bal?.used ?? 0;
    const remaining = total - used;   // 0 으로 자르지 않는다(검증 N1-b — 자동 맞춤이 뒤에 더하면 잔여가 사용 가능보다 커진다)
    await prisma.leaveBalance.upsert({
      where: { userId_year: { userId: emp.id, year } },
      create: { userId: emp.id, year, total, accruedAuto: total, used, remaining },
      update: { total, accruedAuto: total, remaining },   // 손으로 맞춘 몫도 지우고 계산값으로 맞춘다(버튼의 뜻)
    });
    // 사람별 기록 — 연차 대장 "잔여 조정 이력"에 총연차가 바뀐 근거가 남는다(9/11 디렉터). 값이 그대로면 남기지 않는다
    // (재계산을 여러 번 눌러도 대장이 "15→15" 로 채워지지 않게).
    if (!bal || bal.total !== total) {
      await logAudit({
        actorId: session.userId,
        actorName: session.name,
        action: "LEAVE_BALANCE_UPDATE",
        targetType: "USER",
        targetId: emp.id,
        targetName: emp.name,
        detail: `(연차 자동계산 ${year}년, 회계연도 기준) 연차 총 ${bal?.total ?? "-"}→${total}일, 사용 ${used}일, 잔여 ${remaining}일`,
      });
    }
    updated++;
  }

  return NextResponse.json({ success: true, updated });
}
