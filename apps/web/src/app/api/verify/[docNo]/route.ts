import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DOC_NO_RE } from "@/lib/signed-freeze";

// 완료본 진위 확인(#205-5) — 로그인 없이. **이름·제목·내용은 내지 않는다**(문서번호만 알면 누구나 여는 주소다).
// 해시·완료 시각·서명 인원만 준다. 문서번호는 49비트 무작위라 추측으로 찾을 수 없다. 조회만 한다(GET 순수).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ docNo: string }> }) {
  const docNo = decodeURIComponent((await params).docNo || "").trim().toUpperCase();
  if (!DOC_NO_RE.test(docNo)) return NextResponse.json({ found: false }, { status: 404 });
  const c = await prisma.contract.findUnique({
    where: { docNo },
    select: { status: true, signedSha256: true, signedAt: true, signedPdfAt: true, approvalLine: { select: { steps: { select: { signatureUrl: true } } } } },
  });
  if (!c || c.status !== "SIGNED" || !c.signedSha256) return NextResponse.json({ found: false }, { status: 404 });
  return NextResponse.json({
    found: true,
    docNo,
    sha256: c.signedSha256,
    completedAt: c.signedAt,
    frozenAt: c.signedPdfAt,
    signerCount: (c.approvalLine?.steps || []).filter((s) => !!s.signatureUrl).length,
  });
}
