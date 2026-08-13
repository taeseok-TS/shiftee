import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";

// 직원 등록 기기 초기화 (관리자/매니저) — 초기화 후 직원이 새 기기에서 로그인하면 그 기기로 재등록됨
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGER")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { id } = await params;

  // MANAGER는 담당 지점(대표+겸직) 직원만 초기화 가능
  if (session.role === "MANAGER") {
    const myBranches = await getManagerBranches(session.userId);
    const target = await prisma.user.findUnique({ where: { id }, select: { branch: true, role: true } });
    if (!target || !target.branch || !myBranches.includes(target.branch) || target.role === "ADMIN")
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  await prisma.userDevice.deleteMany({ where: { userId: id } });
  return NextResponse.json({ success: true });
}
