import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  try {
    const { id } = await params;

    // 권한 확인 - 본인 계약서이거나 ADMIN이어야 함
    const contract = await prisma.contract.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!contract) {
      return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });
    }

    if (session.role !== "ADMIN" && session.userId !== contract.userId) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    // 버전 목록 조회
    const versions = await prisma.contractVersion.findMany({
      where: { contractId: id },
      include: {
        createdByUser: { select: { id: true, name: true } },
      },
      orderBy: { version: "desc" },
    });

    return NextResponse.json({ versions });
  } catch (error) {
    console.error("버전 조회 실패:", error);
    return NextResponse.json({ error: "버전을 조회할 수 없습니다." }, { status: 500 });
  }
}
