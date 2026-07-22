import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 패키지 일괄 발송 — 근로계약서는 설정한 결재라인(원장→직원→본부장)으로,
// employeeOnly 문서(비밀유지·개인정보동의서)는 '직원 서명만' 단일 단계로 동시 발송한다.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bundleId: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN")
    return NextResponse.json({ error: "패키지 발송은 관리자만 가능합니다." }, { status: 403 });

  const { bundleId } = await params;
  const { approverIds } = (await request.json()) as { approverIds?: string[] };
  if (!Array.isArray(approverIds) || approverIds.length === 0)
    return NextResponse.json({ error: "승인자를 선택해주세요." }, { status: 400 });

  const contracts = await prisma.contract.findMany({
    where: { bundleId },
    select: { id: true, userId: true, employeeOnly: true, status: true },
  });
  if (contracts.length === 0)
    return NextResponse.json({ error: "패키지를 찾을 수 없습니다." }, { status: 404 });

  let sent = 0;
  for (const c of contracts) {
    if (c.status !== "DRAFT") continue;

    // employeeOnly 문서는 직원 본인 1단계만, 일반 문서는 설정한 결재라인 전체
    const lineIds = c.employeeOnly ? [c.userId] : approverIds;

    await prisma.contractApprovalLine.deleteMany({ where: { contractId: c.id } });
    await prisma.contractApprovalLine.create({
      data: {
        contractId: c.id,
        steps: {
          createMany: {
            data: lineIds.map((approverId, idx) => ({
              approverId,
              order: idx + 1,
              status: idx === 0 ? "PENDING" : "WAITING",
            })),
          },
        },
      },
    });
    await prisma.contract.update({ where: { id: c.id }, data: { status: "SENT" } });
    sent++;
  }

  return NextResponse.json({ success: true, sent });
}
