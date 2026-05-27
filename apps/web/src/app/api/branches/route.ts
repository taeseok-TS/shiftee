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
    });

    // Application 레벨에서 각 지점의 직원 수 계산
    const branchesWithCount = await Promise.all(
      branches.map(async (branch) => {
        const userCount = await prisma.user.count({
          where: { branch: branch.name, isActive: true },
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
  return NextResponse.json({ success: true, branch });
}
