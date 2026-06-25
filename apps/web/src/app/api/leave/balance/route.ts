import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tenureLabel, annualLeaveDays } from "@/lib/leave-calc";
import { logAudit } from "@/lib/audit";

// 잔여 휴가 조회
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);

  // 본인 잔여 휴가만: EMPLOYEE는 항상, 그 외 역할은 scope=self 요청 시
  if (session.role === "EMPLOYEE" || searchParams.get("scope") === "self") {
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
      select: { id: true, name: true, department: true, position: true, branch: true, hireDate: true, leaveNote: true },
      orderBy: [{ department: "asc" }, { name: "asc" }],
    }),
    prisma.leaveBalance.findMany(),
  ]);

  const balanceMap = new Map(balances.map(b => [b.userId, b]));
  const year = new Date().getFullYear();
  const now = new Date();

  const result = employees.map(emp => {
    const b: any = balanceMap.get(emp.id);
    return {
      userId:    emp.id,
      name:      emp.name,
      department: emp.department ?? "-",
      position:  emp.position   ?? "-",
      branch:    emp.branch ?? "-",
      hireDate:  emp.hireDate ?? null,
      tenure:    emp.hireDate ? tenureLabel(new Date(emp.hireDate), now) : "-",
      recommended: emp.hireDate ? annualLeaveDays(new Date(emp.hireDate), now) : null, // 근로기준법 권장 연차
      leaveNote: emp.leaveNote ?? null,
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

  const { userId, total, used, leaveNote } = await request.json();
  if (!userId || total === undefined) {
    return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
  }

  const usedVal      = used      ?? 0;
  const remainingVal = total - usedVal;

  // 변경 전 값(감사 로그용)
  const [prev, targetUser] = await Promise.all([
    prisma.leaveBalance.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);

  const balance = await prisma.leaveBalance.upsert({
    where:  { userId },
    create: { userId, year: new Date().getFullYear(), total, used: usedVal, remaining: remainingVal },
    update: { total, used: usedVal, remaining: remainingVal },
  });

  // 근속 관련 별도 표기(육아휴직 등) 저장
  if (leaveNote !== undefined) {
    await prisma.user.update({ where: { id: userId }, data: { leaveNote: leaveNote || null } });
  }

  await logAudit({
    actorId: session.userId,
    actorName: session.name,
    action: "LEAVE_BALANCE_UPDATE",
    targetType: "USER",
    targetId: userId,
    targetName: targetUser?.name ?? null,
    detail: `연차 총 ${prev?.total ?? "-"}→${total}일, 사용 ${prev?.used ?? "-"}→${usedVal}일`,
  });

  return NextResponse.json({ success: true, balance });
}
