import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeBranchName } from "@/lib/branches";

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
  const { name, role, department, jobGroup, position, branch, phone, hireDate } = body;

  // MANAGER는 자기 지점 구성원만 수정 가능
  if (session.role === "MANAGER") {
    const target = await prisma.user.findUnique({ where: { id }, select: { branch: true } });
    // 지점명은 이미 DB에서 정규화된 실제 지점명이므로 직접 비교
    const managerBranch = session.branch;
    const targetBranch = target?.branch;
    if (!target || targetBranch !== managerBranch) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }
    // MANAGER는 role만 변경 불가, branch는 변경 가능
    const updated = await prisma.user.update({
      where: { id },
      data: { name, department, jobGroup: jobGroup ?? null, position, branch: branch || null, phone, hireDate: hireDate ? new Date(hireDate) : undefined },
    });
    return NextResponse.json({ success: true, user: updated });
  }

  // 관리자(ADMIN) 계정 수정·권한 변경은 메인 관리자 전용
  // (대상이 ADMIN이거나, 누군가를 ADMIN으로 승격하려는 경우)
  const targetUser = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if ((targetUser?.role === "ADMIN" || role === "ADMIN") && !(await isSuperAdmin(session.userId))) {
    return NextResponse.json({ error: "관리자 계정 관리는 메인 관리자만 가능합니다." }, { status: 403 });
  }

  // ADMIN: 전체 수정 가능
  const finalBranch = branch || null;
  const updated = await prisma.user.update({
    where: { id },
    data: {
      name,
      role,
      department,
      jobGroup: jobGroup ?? null,
      position,
      branch: finalBranch,
      phone,
      hireDate: hireDate ? new Date(hireDate) : undefined,
    },
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
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (target?.role === "ADMIN" && !(await isSuperAdmin(session.userId))) {
    return NextResponse.json({ error: "관리자 계정 관리는 메인 관리자만 가능합니다." }, { status: 403 });
  }
  await prisma.user.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ success: true });
}
