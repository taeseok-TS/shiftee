import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 지점을 수정할 수 있습니다." }, { status: 403 });
  }

  try {
    const { id } = await params;
    const { name, address, radius, latitude, longitude, countInStats } = await request.json();

    if (!name) {
      return NextResponse.json({ error: "지점명은 필수입니다." }, { status: 400 });
    }

    // 다른 지점과의 중복 체크
    if (name) {
      const existing = await prisma.branch.findFirst({
        where: { name, id: { not: id }, isActive: true }
      });
      if (existing) {
        return NextResponse.json({ error: "이미 존재하는 지점명입니다." }, { status: 409 });
      }
    }

    const data = {
      name,
      address: address || null,
      radius: radius ? Number(radius) : 100,
      latitude: latitude !== undefined ? Number(latitude) : undefined,
      longitude: longitude !== undefined ? Number(longitude) : undefined,
      countInStats: countInStats === undefined ? undefined : !!countInStats, // 통계 포함 여부 (미전송 시 유지)
    };

    // 변경 이전 이름 확보 — User.branch가 지점명 문자열로 매핑돼 있어 이름 변경 시 동기화 필요
    const before = await prisma.branch.findUnique({ where: { id }, select: { name: true } });
    if (!before) return NextResponse.json({ error: "지점을 찾을 수 없습니다." }, { status: 404 });

    if (before.name !== name) {
      // 지점명 변경: 소속 직원(퇴직자 포함)의 User.branch를 같은 트랜잭션으로 동기화
      const [branch, synced] = await prisma.$transaction([
        prisma.branch.update({ where: { id }, data }),
        prisma.user.updateMany({ where: { branch: before.name }, data: { branch: name } }),
      ]);
      await logAudit({
        actorId: session.userId,
        actorName: session.name,
        action: "BRANCH_RENAME",
        targetType: "Branch",
        targetId: id,
        targetName: name,
        detail: `${before.name}→${name}, 직원 ${synced.count}명 동기화`,
      });
      return NextResponse.json({ success: true, branch, syncedUsers: synced.count });
    }

    const branch = await prisma.branch.update({ where: { id }, data });
    return NextResponse.json({ success: true, branch });
  } catch (error) {
    console.error("지점 수정 실패:", error);
    return NextResponse.json({ error: "지점을 수정할 수 없습니다." }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 지점을 삭제할 수 있습니다." }, { status: 403 });
  }

  try {
    const { id } = await params;
    await prisma.branch.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("지점 삭제 실패:", error);
    return NextResponse.json({ error: "지점을 삭제할 수 없습니다." }, { status: 500 });
  }
}
