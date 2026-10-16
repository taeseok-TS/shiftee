import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currentLeaveYear } from "@/lib/leave-calc";
import { kstDate, yearTotalAsOf } from "@/lib/leave-accrual";
import { logAudit } from "@/lib/audit";

// 연차 연도 전환 (관리자 전용) — 재직자 전원에게 대상 연도 LeaveBalance 행 생성.
// 이월 정책: 전년도 잔여는 이월하지 않고 새로 부여한다. 2026-10-16 #31 — 새해 부여는 회계연도 기준(첫 해 비례·1/1 기준 근속 가산,
// 1년 미만은 월차만). 전년도 미사용분은 자동 소멸이 아니라 연차수당 정산 대상(본부 10/16) — 전년도 행에 그대로 남는다.
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

  // 그해 1/1 전에 퇴사일이 지난 사람은 뺀다(퇴사일 지정 뒤에도 isActive 가 남아 있는 경우 — 검증 C4)
  const employees = await prisma.user.findMany({
    where: { isActive: true, OR: [{ resignDate: null }, { resignDate: { gte: new Date(`${year}-01-01T00:00:00Z`) } }] },
    select: { id: true, name: true, hireDate: true, resignDate: true },
  });

  let created = 0;
  let skipped = 0;
  const noHireDate: string[] = []; // 입사일 미입력 → 기본 15일 부여 대상 (관리자 확인용)
  // 사람별 기록용 — 전년도 잔여(소멸되는 일수). 연차 대장 "잔여 조정 이력"에 부여·소멸 근거가 남는다(9/11 디렉터)
  const prevRows = await prisma.leaveBalance.findMany({ where: { year: year - 1 }, select: { userId: true, remaining: true } });
  const prevRemaining = new Map(prevRows.map((r) => [r.userId, r.remaining]));

  for (const emp of employees) {
    const exists = await prisma.leaveBalance.findUnique({
      where: { userId_year: { userId: emp.id, year } },
      select: { id: true },
    });
    if (exists) { skipped++; continue; }

    // 회계연도 기준 그 시점까지 발생 — 1월 초에 누르면 1/1 부여 + 그 사이 월차, 12월에 미리 누르면 1/1 부여분(월차는 매일 자동 적립)
    const total = emp.hireDate ? yearTotalAsOf(kstDate(emp.hireDate), year, undefined, emp.resignDate ? kstDate(emp.resignDate) : null) : 15;
    if (!emp.hireDate) noHireDate.push(emp.name);
    await prisma.leaveBalance.create({
      data: { userId: emp.id, year, total, accruedAuto: emp.hireDate ? total : null, used: 0, remaining: total },
    });
    await logAudit({
      actorId: session.userId,
      actorName: session.name,
      action: "LEAVE_BALANCE_UPDATE",
      targetType: "USER",
      targetId: emp.id,
      targetName: emp.name,
      detail: `(연도 전환 ${year}년) 연차 총 ${total}일 부여${emp.hireDate ? "(회계연도 기준)" : "(입사일 없음 → 기본 15일)"}` +
        (prevRemaining.has(emp.id)
          ? ` · ${year - 1}년 미사용 ${prevRemaining.get(emp.id)}일 — 연차수당 정산 대상(이월 없음)`
          : ` · ${year - 1}년 연차 기록 없음`),
    });
    created++;
  }

  await logAudit({
    actorId: session.userId,
    actorName: session.name,
    action: "LEAVE_ROLLOVER",
    targetType: "SYSTEM",
    detail: `${year}년도 연차 전환 — 생성 ${created}명, 건너뜀 ${skipped}명 (회계연도 기준 부여, 전년도 미사용은 수당 정산 대상)`,
  });

  return NextResponse.json({ success: true, year, created, skipped, noHireDate });
}
