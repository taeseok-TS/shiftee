import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  if (session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  try {
    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      // 메인 원장 — 한 지점에 원장이 2명일 때 누가 상급인지(결재 방향을 정한다)
      include: { mainManager: { select: { id: true, name: true } } },
    });

    // Application 레벨에서 각 지점의 직원 수 계산
    const branchesWithCount = await Promise.all(
      branches.map(async (branch) => {
        const userCount = await prisma.user.count({
          // 인원 배지 = 재직 중인 직원만. 관리자(서브 포함)·보관함·퇴사자는 세지 않는다
          where: {
            branch: branch.name,
            role: { not: "ADMIN" },
            isActive: true,
            deletedAt: null,
            employmentStatus: "ACTIVE",
          },
        });
        return {
          ...branch,
          _count: { users: userCount },
        };
      })
    );

    return NextResponse.json({ branches: branchesWithCount });
  } catch (error) {
    console.error("지점 조회 실패:", error);
    return NextResponse.json({ error: "지점을 조회할 수 없습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { name, address, latitude, longitude, radius } = await request.json();
  if (!name) return NextResponse.json({ error: "지점명은 필수입니다." }, { status: 400 });

  const existing = await prisma.branch.findUnique({ where: { name } });
  if (existing) return NextResponse.json({ error: "이미 존재하는 지점명입니다." }, { status: 409 });

  const branch = await prisma.branch.create({
    data: {
      name,
      address: address || null,
      latitude: latitude != null ? Number(latitude) : null,
      longitude: longitude != null ? Number(longitude) : null,
      radius: radius ? Number(radius) : 100,
    },
  });
  // 담당자(관리자·본부장)에게 알린다. 좌표가 없으면 그 지점은 **위치 검사가 통째로 꺼지므로**
  // 알림 본문이 그 사실을 명시한다 (2026-09-07 디렉터 지시).
  // 응답 뒤에 보낸다 — 알림 실패가 지점 등록을 되돌리면 안 된다.
  void (async () => {
    const { notifyBranchChange } = await import("@/lib/branch-notify");
    await notifyBranchChange("created", branch, session.name);
  })();

  return NextResponse.json({ success: true, branch });
}
