import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { logAudit } from "@/lib/audit";

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

  // 자기 자신은 초기화할 수 없다 — 잠금 대상(원장)이 스스로 기기 바인딩을 풀고
  // 임의 기기를 재등록하면 기기 잠금이 무의미해진다. 본인 기기 변경은 관리자에게 요청.
  if (id === session.userId && session.role !== "ADMIN")
    return NextResponse.json(
      { error: "본인의 기기는 초기화할 수 없습니다. 관리자에게 요청해주세요." },
      { status: 403 }
    );

  // MANAGER는 담당 지점(대표+겸직)의 "직원"만 초기화 가능.
  // 다른 원장은 대상에서 제외한다 — 같은 지점 원장끼리 서로 한 번씩 눌러주면
  // 둘 다 기기 잠금이 풀려 자기제외 가드가 무의미해진다(대치·목동·분당수내가 실제 해당).
  if (session.role === "MANAGER") {
    const myBranches = await getManagerBranches(session.userId);
    const target = await prisma.user.findUnique({ where: { id }, select: { branch: true, role: true } });
    if (!target || !target.branch || !myBranches.includes(target.branch) || target.role !== "EMPLOYEE")
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const removed = await prisma.userDevice.deleteMany({ where: { userId: id } });
  if (removed.count === 0)
    return NextResponse.json({ error: "등록된 기기가 없습니다." }, { status: 404 });

  const target = await prisma.user.findUnique({ where: { id }, select: { name: true } });
  await logAudit({
    actorId: session.userId,
    actorName: session.name,
    action: "DEVICE_RESET",
    targetType: "UserDevice",
    targetId: id,
    targetName: target?.name ?? id,
    detail: `등록 기기 초기화 (${target?.name ?? id})`,
  });
  return NextResponse.json({ success: true });
}
