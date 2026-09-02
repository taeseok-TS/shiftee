import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";

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

    // 권한 확인: 직원 본인, 관리자, 또는 매니저(담당 지점 — 대표+겸직)
    const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
    const isOwner = contract.userId === session.userId;
    const isAdmin = session.role === "ADMIN";
    const isManager =
      session.role === "MANAGER" &&
      contract.user &&
      !!(contract.user as any).branch &&
      myBranches.includes((contract.user as any).branch);

    if (!isOwner && !isAdmin && !isManager) {
      return NextResponse.json(
        { error: "접근 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 열람 금지(none) 문서는 서명을 마친 뒤 구버전 주소도 감춘다 — 목록.상세와 같은 규칙.
    // 바이트는 contract-access 가 막지만, 여기만 규칙이 달라 주소가 새면 그 방어에 의존하게 된다.
    const tpl = (contract as { templateId?: string | null }).templateId
      ? await prisma.contractTemplate.findUnique({
          where: { id: (contract as { templateId: string }).templateId },
          select: { postSignAccess: true },
        })
      : null;
    const hideUrls =
      !isAdmin &&
      (tpl?.postSignAccess || "full") === "none" &&
      !!(contract as { employeeSignedAt?: Date | null }).employeeSignedAt;

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
      versions: hideUrls ? versions.map((v) => ({ ...v, fileUrl: null })) : versions,
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
