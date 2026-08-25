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
    select: { id: true, userId: true, status: true },
  });
  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });

  const allowed = session.role === "ADMIN" || contract.userId === session.userId;
  if (!allowed)
    return NextResponse.json({ error: "서명 완료본은 관리자와 계약 당사자만 볼 수 있습니다." }, { status: 403 });
  if (contract.status !== "SIGNED")
    return NextResponse.json({ error: "아직 서명이 완료되지 않은 계약서입니다." }, { status: 400 });

  const st = issueSignedDocTicket(id);
  return NextResponse.json({
    url: `${getAppUrl()}/api/contracts/${id}/signed-document?pdf=1&inline=1&st=${st}`,
  });
}
