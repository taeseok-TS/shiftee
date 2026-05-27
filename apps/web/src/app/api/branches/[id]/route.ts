import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  try {
    const { id } = await params;
    const { name, address, radius, latitude, longitude } = await request.json();

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

    const branch = await prisma.branch.update({
      where: { id },
      data: {
        name,
        address: address || null,
        radius: radius ? Number(radius) : 100,
        latitude: latitude !== undefined ? Number(latitude) : undefined,
        longitude: longitude !== undefined ? Number(longitude) : undefined,
      },
    });
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
  if (session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
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
