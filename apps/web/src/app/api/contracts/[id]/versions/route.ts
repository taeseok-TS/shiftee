import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/contracts/[id]/versions
 * 특정 계약서의 모든 버전 조회
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const { id } = await params;

    // 계약서 존재 여부 및 권한 확인
    const contract = await prisma.contract.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    if (!contract) {
      return NextResponse.json(
        { error: "계약서를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 권한 확인: 직원 본인, 관리자, 또는 매니저(같은 지점)
    const isOwner = contract.userId === session.userId;
    const isAdmin = session.role === "ADMIN";
    const isManager =
      session.role === "MANAGER" &&
      contract.user &&
      (contract.user as any).branch === session.branch;

    if (!isOwner && !isAdmin && !isManager) {
      return NextResponse.json(
        { error: "접근 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 버전 조회
    const versions = await prisma.contractVersion.findMany({
      where: { contractId: id },
      select: {
        id: true,
        version: true,
        fileUrl: true,
        title: true,
        type: true,
        status: true,
        startDate: true,
        endDate: true,
        createdBy: true,
        createdByUser: {
          select: { id: true, name: true },
        },
        createdAt: true,
      },
      orderBy: { version: "asc" },
    });

    return NextResponse.json({
      contractId: id,
      contractTitle: contract.title,
      versions,
      totalVersions: versions.length,
    });
  } catch (error) {
    console.error("계약서 버전 조회 오류:", error);
    return NextResponse.json(
      { error: "버전 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
