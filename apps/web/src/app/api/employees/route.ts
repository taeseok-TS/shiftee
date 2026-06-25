import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeBranchName } from "@/lib/branches";
import { filterUserDataArray } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import bcrypt from "bcryptjs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // MANAGER의 경우, 자신의 지점 직원만 조회
  const branchWhere = session.role === "MANAGER" && session.branch
    ? { branch: session.branch }  // 지점명은 이미 DB의 실제 지점명
    : {};

  const employees = await prisma.user.findMany({
    where: { isActive: true, role: { not: "ADMIN" }, ...branchWhere },
    select: {
      id: true, name: true, email: true, role: true, empNo: true,
      department: true, jobGroup: true, position: true, branch: true, hireDate: true, phone: true,
      leaveBalance: { select: { remaining: true, used: true, total: true } },
    },
    orderBy: [{ branch: "asc" }, { name: "asc" }],
  });

  // 데이터 필터링 적용: MANAGER는 자신의 지점만 조회하므로 모두 상세정보 노출, ADMIN도 모두 노출
  // (권한 검증은 위의 WHERE 절에서 이미 수행됨)
  const filteredEmployees = employees.map(emp => ({
    id: emp.id,
    name: emp.name,
    email: emp.email,
    role: emp.role,
    empNo: emp.empNo,
    department: emp.department,
    jobGroup: emp.jobGroup,
    position: emp.position,
    branch: emp.branch,
    hireDate: emp.hireDate,
    phone: emp.phone,
    leaveBalance: emp.leaveBalance,
  }));

  // 지점명은 이미 DB에서 정규화된 실제 지점명이므로 그대로 반환
  return NextResponse.json({ employees: filteredEmployees });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = await request.json();
  const { name, email, password, role, department, jobGroup, position, branch, phone, hireDate } = body;

  // 디버깅: 받은 branch 값 확인
  console.log("[POST /api/employees] 받은 branch 값:", branch, "| 타입:", typeof branch, "| 전체 body:", body);

  if (!name || !email || !password) {
    return NextResponse.json({ error: "이름, 이메일, 비밀번호는 필수입니다." }, { status: 400 });
  }

  // 관리자(ADMIN) 계정 생성은 메인 관리자 전용
  if (role === "ADMIN" && !(await isSuperAdmin(session.userId))) {
    return NextResponse.json({ error: "관리자 계정 생성은 메인 관리자만 가능합니다." }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "이미 사용 중인 이메일입니다." }, { status: 409 });

  // 지점명 - UI에서 이미 데이터베이스 실제 이름을 선택했으므로 그대로 사용
  const finalBranch = branch || null;

  const hashedPassword = await bcrypt.hash(password, 10);
  // 사원번호: 순차 발급(1001~)
  const maxNo = (await prisma.user.aggregate({ _max: { empNo: true } }))._max.empNo ?? 1000;
  const empNo = Math.max(1000, maxNo) + 1;
  const user = await prisma.user.create({
    data: {
      name, email, password: hashedPassword, empNo,
      role: role || "EMPLOYEE",
      department, jobGroup: jobGroup || null, position, branch: finalBranch, phone,
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

  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMPLOYEE_CREATE",
    targetType: "USER", targetId: user.id, targetName: user.name,
    detail: `직원 생성 (${user.role}${finalBranch ? ", " + finalBranch : ""})`,
  });

  return NextResponse.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
}
