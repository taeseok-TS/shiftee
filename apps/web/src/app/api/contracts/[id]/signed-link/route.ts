import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAppUrl } from "@/lib/app-url";
import { issueSignedDocTicket } from "@/lib/upload-ticket";

// 완료본 열람 링크 발급 — 앱이 외부 브라우저로 PDF 완료본을 열 때 사용 (2026-08-25).
// 여기서 세션으로 당사자·관리자 권한을 검증하고, 계약 1건에만 유효한 30분 티켓을 담은
// URL 을 돌려준다. 브라우저는 세션 없이 그 URL 로 signed-document 에 접근한다.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const contract = await prisma.contract.findUnique({
    where: { id },
    select: {
      id: true, userId: true, status: true, templateId: true,
      approvalLine: { select: { steps: { select: { signatureUrl: true } } } },
    },
  });
  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });

  const allowed = session.role === "ADMIN" || contract.userId === session.userId;
  if (!allowed)
    return NextResponse.json({ error: "서명 완료본은 관리자와 계약 당사자만 볼 수 있습니다." }, { status: 403 });

  // #110 진행 중 계약도 서명이 1개 이상이면 지금까지의 서명 반영본을 열람할 수 있게 완화
  const inProgress = contract.status !== "SIGNED";
  const hasSignature = (contract.approvalLine?.steps || []).some((s) => !!s.signatureUrl);
  if (!hasSignature)
    return NextResponse.json({ error: "아직 서명이 없습니다." }, { status: 400 });

  // 권한·정책은 lib/contract-access 한 곳에서 판정한다. 여기에 별도 판정을 두면
  // 계약 상태·템플릿 삭제 같은 조건이 문마다 어긋난다(실제로 어긋나 있었다, 2026-09-02).
  const { canAccessContractFile } = await import("@/lib/contract-access");
  const acc = await canAccessContractFile({ contractId: id }, { userId: session.userId, role: session.role });
  if (!acc.allowed) return NextResponse.json({ error: acc.error }, { status: acc.status });

  // 다운로드까지 허용된 문서(full)는 앱에서도 파일로 받을 수 있어야 한다 —
  // 종전에는 무조건 inline 이라 근로계약서처럼 교부 의무가 있는 문서도 앱에서 저장이 안 됐다
  // (2026-09-02 이예지대리 요청: 근로계약서·비밀유지서약서·개인정보동의서는 다운로드 가능).
  const st = issueSignedDocTicket(id);
  const inlineParam = acc.viewOnly ? "&inline=1" : "";
  return NextResponse.json({
    url: `${getAppUrl()}/api/contracts/${id}/signed-document?pdf=1${inlineParam}&st=${st}`,
    inProgress,
    viewOnly: acc.viewOnly,
  });
}
