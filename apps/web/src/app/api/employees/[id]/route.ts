import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin, bumpTokenVersion } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeBranchName } from "@/lib/branches";
import { logAudit } from "@/lib/audit";
import { getManagerBranches } from "@/lib/manager-branches";
import { kstTodayMidnight } from "@/lib/resign";
import bcrypt from "bcryptjs";
import { ROLES, pick } from "@/lib/enums";

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
  const { name, role, department, jobGroup, position, branch, phone, hireDate, birthDate, managerBranches, password, empNo, resignDate, resignReason, isContractApprover } = body;

  // 퇴사일 — 빈 문자열/null 이면 해제(재직 복귀), 값이 있으면 그날짜로 설정.
  // 입사일·생일과 같이 UTC 자정으로 저장한다(KST 오프셋을 붙이면 화면에서 하루 앞당겨 보인다).
  const resignVal =
    resignDate === undefined ? undefined : resignDate ? new Date(`${String(resignDate).slice(0, 10)}T00:00:00.000Z`) : null;
  if (resignVal !== undefined && resignVal !== null && isNaN(resignVal.getTime()))
    return NextResponse.json({ error: "퇴사일 형식이 올바르지 않습니다." }, { status: 400 });
  // 퇴사일 당일은 아직 재직이므로 "이 날짜보다 이전"이어야 퇴직이다.
  const todayMidnight = kstTodayMidnight();

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
    // ⚠ 원장은 **지점을 바꿀 수 없다**(2026-09-07 디렉터 지시).
    //   종전에는 바꿀 수 있었고, 그러면 두 가지가 한꺼번에 무너졌다:
    //   ① 자기 지점을 존재하지 않는 값(예: "zzz")으로 바꾸면 그 이름의 Branch 가 없어
    //      출퇴근 위치 검사가 통째로 건너뛰어진다 — 어디서든 출근이 찍힌다.
    //   ② 자기 지점을 남의 지점으로 바꾸면 담당 범위가 그리로 옮겨가(getManagerBranches 는
    //      세션이 아니라 DB 의 User.branch 를 읽는다) 그 지점 직원의 근태 조회·기기 초기화까지 된다.
    //   원장이 자기 자신도 수정 대상에 들어간다는 점이 이걸 가능하게 했다.
    if (branch !== undefined && (branch || null) !== targetBranch)
      return NextResponse.json({ error: "지점 변경은 관리자만 할 수 있습니다." }, { status: 403 });
    const updated = await prisma.user.update({
      where: { id },
      // 미전송(undefined) 필드는 건드리지 않음 — 부분 수정 시 기존 값 보존
      data: { name, department, jobGroup: jobGroup === undefined ? undefined : jobGroup || null, position, phone, hireDate: hireDate ? new Date(hireDate) : undefined, birthDate: birthDate === undefined ? undefined : birthDate ? new Date(birthDate) : null },
    });
    await logAudit({
      actorId: session.userId, actorName: session.name, action: "EMPLOYEE_UPDATE",
      targetType: "USER", targetId: id, targetName: updated.name, detail: diffSummary(before, body),
    });
    return NextResponse.json({ success: true, user: updated });
  }

  // 관리자(ADMIN) 계정 수정·권한 변경은 메인 관리자 전용
  // (대상이 ADMIN이거나, 누군가를 ADMIN으로 승격하려는 경우)
  // ⚠ 권한 값을 검증 없이 넘기면 Prisma 가 enum 에서 던져 **500** 이 난다(2026-09-06 실측:
  //   `{role:"SUPERUSER"}` → 500). 잘못된 값이 저장되지는 않았지만, 권한 필드에서 나는 500 은
  //   "막힌 것"인지 "터진 것"인지 구별이 안 돼 가장 나쁜 형태의 실패다. 명시적으로 거절한다.
  if (role !== undefined && !pick(ROLES, role))
    return NextResponse.json({ error: "알 수 없는 권한입니다." }, { status: 400 });

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
      // 전자계약 승인자 노출 토글 (관리자 계정 현황 체크박스)
      isContractApprover: typeof isContractApprover === "boolean" ? isContractApprover : undefined,
      // 재직상태도 함께 맞춘다 — 퇴직자 현황이 이 값으로 조회하기 때문.
      // 앞으로의 퇴사일이면 아직 재직이므로 ACTIVE 로 두고, 날짜가 지나면 조회 시점에 퇴직자로 잡힌다.
      employmentStatus:
        resignVal === undefined
          ? undefined
          : resignVal && resignVal < todayMidnight
          ? "RESIGNED"
          : "ACTIVE",
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

  // 권한이 내려가거나 퇴사일이 붙으면 **이미 나가 있는 토큰**을 끊는다 (2026-09-07 디렉터 지시).
  // 토큰에는 role 이 박혀 있어서, 안 끊으면 강등된 사람이 남은 유효기간 동안
  // 예전 권한 그대로 움직인다.
  if ((role !== undefined && before && role !== before.role) || resignVal !== undefined) {
    await bumpTokenVersion(id).catch(() => {});
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
  // 비활성 처리했으면 그 사람 폰에 살아 있는 토큰도 함께 끊는다.
  await bumpTokenVersion(id).catch(() => {});
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMPLOYEE_DELETE",
    targetType: "USER", targetId: id, targetName: target?.name ?? null, detail: "직원 비활성화",
  });
  return NextResponse.json({ success: true });
}
