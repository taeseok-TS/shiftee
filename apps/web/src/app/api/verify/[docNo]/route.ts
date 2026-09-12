import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DOC_NO_RE } from "@/lib/signed-freeze";
import { tsaMatches } from "@/lib/tsa";

// 완료본 진위 확인(#205-5) — 로그인 없이. **이름·제목·내용은 내지 않는다**(문서번호만 알면 누구나 여는 주소다).
// 해시·완료 시각·서명 인원만 준다. 문서번호는 49비트 무작위라 추측으로 찾을 수 없다. 조회만 한다(GET 순수).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ docNo: string }> }) {
  // Next 가 이미 한 번 풀어 준다 — 다시 풀면 %25ZZ 같은 값이 URIError(500)가 되어 로그인 없이 오류 로그를 쌓는다(8330d85 검증 2)
  const docNo = ((await params).docNo || "").trim().toUpperCase();
  if (!DOC_NO_RE.test(docNo)) return NextResponse.json({ found: false }, { status: 404 });
  const c = await prisma.contract.findUnique({
    where: { docNo },
    select: { status: true, signedSha256: true, signedAt: true, signedPdfAt: true, tsaAt: true, tsaUrl: true, tsaToken: true, approvalLine: { select: { steps: { select: { signatureUrl: true } } } } },
  });
  if (!c || c.status !== "SIGNED" || !c.signedSha256) return NextResponse.json({ found: false }, { status: 404 });
  return NextResponse.json({
    found: true,
    docNo,
    sha256: c.signedSha256,
    completedAt: c.signedAt,
    frozenAt: c.signedPdfAt,
    signerCount: (c.approvalLine?.steps || []).filter((s) => !!s.signatureUrl).length,
    // 제3자 시각 인증(TSA) — 발급처·시각. 도장 파일은 /api/verify/문서번호/tsr
    // 도장이 **지금 해시**에 대한 것일 때만 보인다(회수·재완료 뒤 옛 도장이 남는 경우 방어)
    tsa: c.tsaAt && tsaMatches(c.tsaToken, c.signedSha256) ? { at: c.tsaAt, url: c.tsaUrl } : null,
  });
}
