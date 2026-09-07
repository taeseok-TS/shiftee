import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeBranchName } from "@/lib/branches";
import { filterUserDataArray } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import bcrypt from "bcryptjs";
import { currentLeaveYear } from "@/lib/leave-calc";
import { getManagerBranches } from "@/lib/manager-branches";
import { kstTodayMidnight } from "@/lib/resign";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // MANAGER의 경우, 담당 지점(대표+겸직) 직원만 조회
  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const branchWhere = session.role === "MANAGER"
    ? { branch: { in: myBranches } }  // 지점명은 이미 DB의 실제 지점명
    : {};

  // 결재 승인자 선택 등에서 관리자도 포함해야 할 때 (관리자 세션 한정)
  const includeAdmins =
    new URL(request.url).searchParams.get("includeAdmins") === "true" && session.role === "ADMIN";

  // 퇴사일이 지난 직원은 목록에서 제외한다(별도 배치 없이 조회 시점에 판정).
  // 앞으로의 퇴사일이면 그날까지는 계속 보인다 — 인수인계·마지막 근무일 처리를 위해.
  // ?includeResigned=true 면 퇴사자까지 포함(퇴직자 조회용).
  const includeResigned = new URL(request.url).searchParams.get("includeResigned") === "true";
  const todayMidnight = kstTodayMidnight();
  const resignWhere = includeResigned
    ? {}
    : { OR: [{ resignDate: null }, { resignDate: { gte: todayMidnight } }] };

  const employees = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null, ...(includeAdmins ? {} : { role: { not: "ADMIN" } }), ...branchWhere, ...resignWhere },
    select: {
      id: true, name: true, email: true, role: true, empNo: true,
      department: true, jobGroup: true, position: true, branch: true, hireDate: true, birthDate: true, phone: true,
      resignDate: true, resignReason: true, isContractApprover: true,
      leaveBalance: { where: { year: currentLeaveYear() }, select: { remaining: true, used: true, total: true } },
      device: { select: { deviceName: true, platform: true, createdAt: true } },
      managerBranches: { select: { branchName: true } },
    },
    orderBy: [{ branch: "asc" }, { name: "asc" }],
  });

  // ⚠ 일반 직원에게는 **이름과 지점만** 준다 (2026-09-07 디렉터 지시).
  //   종전에는 역할 검사가 아예 없어, 직원 아무나 전 직원의 전화번호.생년월일.이메일.입사일.
  //   퇴사사유.연차잔여.등록기기명까지 받아갔다 — 라이브에서 124명분이 나가는 것을 확인했다.
  //   `filterUserDataArray` 를 import 해 놓고 한 번도 부르지 않은 상태였다(넣다 만 흔적).
  //   채팅에서 사람을 찾는 것은 이 API 가 아니라 /api/work/members 가 담당하고,
  //   거기는 이미 개인정보 없이 이름.지점.부서만 준다.
  if (session.role === "EMPLOYEE") {
    return NextResponse.json({
      employees: employees.map(emp => ({ id: emp.id, name: emp.name, branch: emp.branch })),
    });
  }

  // 관리자.원장용 상세 (원장은 위 WHERE 절에서 담당 지점으로 이미 좁혀져 있다)
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
    birthDate: emp.birthDate,
    phone: emp.phone,
    resignDate: emp.resignDate,
    resignReason: emp.resignReason,
    isContractApprover: emp.isContractApprover, // 전자계약 승인자 노출 토글 (시스템 설정)
    leaveBalance: emp.leaveBalance[0] ?? null, // 연도별 다중 행 중 현재 연도 1행 (기존 응답 형태 유지)
    device: emp.device,
    managerBranches: emp.managerBranches.map(b => b.branchName), // 원장 겸직 지점 목록
  }));

  // 지점명은 이미 DB에서 정규화된 실제 지점명이므로 그대로 반환
  return NextResponse.json({ employees: filteredEmployees });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = await request.json();
  const { name, email, password, role, department, jobGroup, position, branch, phone, hireDate, birthDate, empNo: empNoInput } = body;

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
  // 사원번호: 입력값이 있으면 그 번호 부여(중복 검사), 없으면 순차 자동 발급(1001~)
  let empNo: number;
  if (empNoInput !== undefined && empNoInput !== null && String(empNoInput).trim() !== "") {
    empNo = parseInt(String(empNoInput).trim());
    if (!Number.isInteger(empNo) || empNo <= 0)
      return NextResponse.json({ error: "사원번호는 양의 정수여야 합니다." }, { status: 400 });
    const dupNo = await prisma.user.findUnique({ where: { empNo }, select: { name: true } });
    if (dupNo)
      return NextResponse.json({ error: `사원번호 ${empNo}은(는) 이미 ${dupNo.name}님이 사용 중입니다.` }, { status: 409 });
  } else {
    const maxNo = (await prisma.user.aggregate({ _max: { empNo: true } }))._max.empNo ?? 1000;
    empNo = Math.max(1000, maxNo) + 1;
  }
  const user = await prisma.user.create({
    data: {
      name, email, password: hashedPassword, empNo,
      role: role || "EMPLOYEE",
      department, jobGroup: jobGroup || null, position, branch: finalBranch, phone,
      hireDate: hireDate ? new Date(hireDate) : null,
      birthDate: birthDate ? new Date(birthDate) : null,
    },
  });

  await prisma.leaveBalance.create({
    data: {
      userId: user.id,
      year: currentLeaveYear(),
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
