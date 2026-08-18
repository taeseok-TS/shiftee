import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeBranchName } from "@/lib/branches";
import { logAudit } from "@/lib/audit";
import { getManagerBranches } from "@/lib/manager-branches";
import bcrypt from "bcryptjs";

// 변경 내역 요약(감사 로그용)
function diffSummary(
  before: { name: string; role: string; branch: string | null } | null,
  body: { name?: string; role?: string; branch?: string | null }
): string {
  if (!before) return "정보 수정";
  const c: string[] = [];
  if (body.name !== undefined && body.name !== before.name) c.push(`이름 ${before.name}→${body.name}`);
  if (body.role !== undefined && body.role !== before.role) c.push(`권한 ${before.role}→${body.role}`);
  if (body.branch !== undefined && (body.branch || null) !== before.branch)
    c.push(`지점 ${before.branch ?? "-"}→${body.branch || "-"}`);
  return c.length ? c.join(", ") : "정보 수정";
}

// 직원 정보 수정 (관리자 전용)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  const { name, role, department, jobGroup, position, branch, phone, hireDate, birthDate, managerBranches, password, empNo, resignDate, resignReason } = body;

  // 퇴사일 — 빈 문자열/null 이면 해제(재직 복귀), 값이 있으면 그날짜로 설정.
  // 지난 날짜면 목록에서 자동으로 빠지고, 앞으로의 날짜면 그날까지는 계속 보인다(조회 시 판정).
  const resignVal =
    resignDate === undefined ? undefined : resignDate ? new Date(`${String(resignDate).slice(0, 10)}T00:00:00+09:00`) : null;
  if (resignVal !== undefined && resignVal !== null && isNaN(resignVal.getTime()))
    return NextResponse.json({ error: "퇴사일 형식이 올바르지 않습니다." }, { status: 400 });

  // 변경 전 값(감사 로그용)
  const before = await prisma.user.findUnique({ where: { id }, select: { name: true, role: true, branch: true } });

  // MANAGER는 담당 지점(대표+겸직) 구성원만 수정 가능
  if (session.role === "MANAGER") {
    const target = await prisma.user.findUnique({ where: { id }, select: { branch: true } });
    // 지점명은 이미 DB에서 정규화된 실제 지점명이므로 직접 비교
    const myBranches = await getManagerBranches(session.userId);
    const targetBranch = target?.branch;
    if (!target || !targetBranch || !myBranches.includes(targetBranch)) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }
    // MANAGER는 role만 변경 불가, branch는 변경 가능
    const updated = await prisma.user.update({
      where: { id },
      // 미전송(undefined) 필드는 건드리지 않음 — 부분 수정 시 기존 값 보존
      data: { name, department, jobGroup: jobGroup === undefined ? undefined : jobGroup || null, position, branch: branch === undefined ? undefined : branch || null, phone, hireDate: hireDate ? new Date(hireDate) : undefined, birthDate: birthDate === undefined ? undefined : birthDate ? new Date(birthDate) : null },
    });
    await logAudit({
      actorId: session.userId, actorName: session.name, action: "EMPLOYEE_UPDATE",
      targetType: "USER", targetId: id, targetName: updated.name, detail: diffSummary(before, body),
    });
    return NextResponse.json({ success: true, user: updated });
  }

  // 관리자(ADMIN) 계정 수정·권한 변경은 메인 관리자 전용
  // (대상이 ADMIN이거나, 누군가를 ADMIN으로 승격하려는 경우)
  const targetUser = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if ((targetUser?.role === "ADMIN" || role === "ADMIN") && !(await isSuperAdmin(session.userId))) {
    return NextResponse.json({ error: "관리자 계정 관리는 메인 관리자만 가능합니다." }, { status: 403 });
  }

  // ADMIN: 전체 수정 가능 (미전송 필드는 기존 값 보존)
  const finalBranch = branch === undefined ? undefined : branch || null;

  // 사원번호 변경 (선택 — 타 시스템 사번으로 맞추는 경우. 다른 직원과 중복 불가)
  let empNoVal: number | undefined;
  if (empNo !== undefined && empNo !== null && String(empNo).trim() !== "") {
    const n = parseInt(String(empNo).trim());
    if (!Number.isInteger(n) || n <= 0)
      return NextResponse.json({ error: "사원번호는 양의 정수여야 합니다." }, { status: 400 });
    const dupNo = await prisma.user.findUnique({ where: { empNo: n }, select: { id: true, name: true } });
    if (dupNo && dupNo.id !== id)
      return NextResponse.json({ error: `사원번호 ${n}은(는) 이미 ${dupNo.name}님이 사용 중입니다.` }, { status: 409 });
    empNoVal = n;
  }

  // 비밀번호 재설정 (선택 — 입력된 경우에만, 최소 8자)
  let hashedPassword: string | undefined;
  if (typeof password === "string" && password.trim() !== "") {
    if (password.trim().length < 8)
      return NextResponse.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
    hashedPassword = await bcrypt.hash(password.trim(), 10);
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      name,
      role,
      department,
      jobGroup: jobGroup === undefined ? undefined : jobGroup || null,
      position,
      branch: finalBranch,
      phone,
      hireDate: hireDate ? new Date(hireDate) : undefined,
      birthDate: birthDate === undefined ? undefined : birthDate ? new Date(birthDate) : null,
      password: hashedPassword,
      // 관리자가 새 비번을 직접 지정하면 임시 비번(1234) 상태가 아니므로 알림 대상에서 해제
      passwordResetAt: hashedPassword ? null : undefined,
      empNo: empNoVal,
      resignDate: resignVal,
      resignReason: resignDate === undefined ? undefined : resignDate ? (resignReason ?? undefined) : null,
    },
  });

  // 겸직 지점 목록 교체 (배열이 넘어온 경우에만 — undefined면 기존 유지)
  if (Array.isArray(managerBranches)) {
    const names = managerBranches.filter((b: unknown): b is string => typeof b === "string" && b.trim() !== "");
    await prisma.managerBranch.deleteMany({ where: { userId: id } });
    if (names.length > 0) {
      await prisma.managerBranch.createMany({
        data: names.map((branchName: string) => ({ userId: id, branchName })),
        skipDuplicates: true, // 중복 지점명 방어 (@@unique[userId, branchName])
      });
    }
  }

  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMPLOYEE_UPDATE",
    targetType: "USER", targetId: id, targetName: updated.name, detail: diffSummary(before, body),
  });

  return NextResponse.json({ success: true, user: updated });
}

// 직원 비활성화 (관리자 전용)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { id } = await params;
  // 관리자(ADMIN) 계정 비활성화는 메인 관리자 전용 (관리자 잠금 방지)
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true, name: true } });
  if (target?.role === "ADMIN" && !(await isSuperAdmin(session.userId))) {
    return NextResponse.json({ error: "관리자 계정 관리는 메인 관리자만 가능합니다." }, { status: 403 });
  }
  await prisma.user.update({ where: { id }, data: { isActive: false } });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMPLOYEE_DELETE",
    targetType: "USER", targetId: id, targetName: target?.name ?? null, detail: "직원 비활성화",
  });
  return NextResponse.json({ success: true });
}
