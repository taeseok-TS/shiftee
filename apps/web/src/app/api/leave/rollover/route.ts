import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { annualLeaveDays, currentLeaveYear } from "@/lib/leave-calc";
import { logAudit } from "@/lib/audit";

// 연차 연도 전환 (관리자 전용) — 재직자 전원에게 대상 연도 LeaveBalance 행 생성.
// 이월 정책: 소멸 + 신년도 재부여 (전년도 잔여는 이월하지 않고, 근속 기반으로 새로 부여).
// 멱등: 이미 해당 연도 행이 있는 직원은 건너뜀 (재실행해도 데이터 불변).
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 연도 전환을 실행할 수 있습니다." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const year = Number.isInteger(body?.year) ? (body.year as number) : currentLeaveYear();
  if (year < 2020 || year > 2100)
    return NextResponse.json({ error: "전환 연도가 올바르지 않습니다." }, { status: 400 });

  const employees = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, hireDate: true },
  });

  // 부여 기준일: 대상 연도 1월 1일 (근속 기반 자동 계산)
  const asOf = new Date(year, 0, 1);
  let created = 0;
  let skipped = 0;
  const noHireDate: string[] = []; // 입사일 미입력 → 기본 15일 부여 대상 (관리자 확인용)

  for (const emp of employees) {
    const exists = await prisma.leaveBalance.findUnique({
      where: { userId_year: { userId: emp.id, year } },
      select: { id: true },
    });
    if (exists) { skipped++; continue; }

    const total = emp.hireDate ? annualLeaveDays(new Date(emp.hireDate), asOf) : 15;
    if (!emp.hireDate) noHireDate.push(emp.name);
    await prisma.leaveBalance.create({
      data: { userId: emp.id, year, total, used: 0, remaining: total },
    });
    created++;
  }

  await logAudit({
    actorId: session.userId,
    actorName: session.name,
    action: "LEAVE_ROLLOVER",
    targetType: "SYSTEM",
    detail: `${year}년도 연차 전환 — 생성 ${created}명, 건너뜀 ${skipped}명 (소멸+재부여)`,
  });

  return NextResponse.json({ success: true, year, created, skipped, noHireDate });
}
