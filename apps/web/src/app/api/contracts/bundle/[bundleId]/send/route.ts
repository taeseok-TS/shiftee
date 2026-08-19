import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 패키지 일괄 발송 — 근로계약서는 설정한 결재라인(원장→직원→본부장)으로,
// employeeOnly 문서(비밀유지·개인정보동의서)는 '직원 서명만' 단일 단계로 동시 발송한다.
// 외부(미가입) 패키지: 결재라인의 "EXTERNAL" 항목은 게스트 서명 링크 단계로,
// employeeOnly 문서는 외부인 서명 단계(자체 토큰)로 발송 — 게스트는 대표 문서 링크 하나로 함께 서명.
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
    select: { id: true, userId: true, employeeOnly: true, status: true, externalName: true },
  });
  if (contracts.length === 0)
    return NextResponse.json({ error: "패키지를 찾을 수 없습니다." }, { status: 404 });

  // 외부 서명 단계는 외부 계약 패키지에서만 허용 (일반 패키지에 유입 시 User FK 500 방지)
  const isExternalBundle = contracts.some((c) => c.externalName);
  if (approverIds.includes("EXTERNAL") && !isExternalBundle)
    return NextResponse.json({ error: "패키지 발송에는 외부 서명 단계를 넣을 수 없습니다." }, { status: 400 });
  if (approverIds.filter((a) => a === "EXTERNAL").length > 1)
    return NextResponse.json({ error: "외부 서명 단계는 하나만 넣을 수 있습니다." }, { status: 400 });

  const mkToken = () =>
    crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const tokenExpiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);

  let sent = 0;
  // 외부 패키지의 대표 계약서(일반 문서) 새 토큰 — 발송 직후 화면에서 바로 복사·문자 전송할 수 있게 응답에 담는다.
  // 관리자 전용 라우트라 노출해도 GET /api/contracts 의 ADMIN 노출 범위와 같다.
  let externalSignToken: string | null = null;
  for (const c of contracts) {
    // 서명 완료 문서만 보존 — 그 외에는 재발송 허용(결재라인·게스트 토큰 재생성, 만료 링크 복구 경로)
    if (c.status === "SIGNED") continue;

    // employeeOnly 문서: 사내=직원 본인 1단계 / 외부=외부인 서명 1단계(자체 토큰)
    // 일반 문서: 설정한 결재라인 전체("EXTERNAL"은 게스트 링크 단계)
    const stepsData = c.employeeOnly
      ? [
          c.externalName
            ? { approverId: null as string | null, externalName: c.externalName, signToken: mkToken(), tokenExpiresAt, order: 1, status: "PENDING" as const }
            : { approverId: c.userId as string | null, order: 1, status: "PENDING" as const },
        ]
      : approverIds.map((approverId, idx) => {
          const status = idx === 0 ? ("PENDING" as const) : ("WAITING" as const);
          return approverId === "EXTERNAL"
            ? { approverId: null as string | null, externalName: c.externalName || "외부 서명자", signToken: mkToken(), tokenExpiresAt, order: idx + 1, status }
            : { approverId: approverId as string | null, order: idx + 1, status };
        });

    if (c.externalName && !c.employeeOnly) {
      const ext = stepsData.find((st) => st.signToken);
      if (ext?.signToken) externalSignToken = ext.signToken;
    }

    await prisma.contractApprovalLine.deleteMany({ where: { contractId: c.id } });
    await prisma.contractApprovalLine.create({
      data: {
        contractId: c.id,
        steps: { createMany: { data: stepsData } },
      },
    });
    await prisma.contract.update({ where: { id: c.id }, data: { status: "SENT" } });
    sent++;
  }

  if (sent === 0)
    return NextResponse.json({ error: "발송할 문서가 없습니다. 모든 문서가 이미 서명 완료되었습니다." }, { status: 400 });

  return NextResponse.json({ success: true, sent, externalSignToken });
}
