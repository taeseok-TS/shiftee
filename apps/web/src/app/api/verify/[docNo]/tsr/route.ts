import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DOC_NO_RE } from "@/lib/signed-freeze";
import { tsaMatches } from "@/lib/tsa";

// 제3자 시각 도장 파일(RFC 3161 응답, .tsr) — 로그인 없이. 우리 해시·발급 기관 서명·인증서만 들어 있다(이름·내용 없음).
// 검증: openssl ts -verify -in 문서번호.tsr -data 받은.pdf -CAfile <발급 기관 루트 인증서>. 조회만 한다(GET 순수).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ docNo: string }> }) {
  const docNo = ((await params).docNo || "").trim().toUpperCase();
  if (!DOC_NO_RE.test(docNo)) return NextResponse.json({ found: false }, { status: 404 });
  const c = await prisma.contract.findUnique({ where: { docNo }, select: { status: true, tsaToken: true, signedSha256: true } });
  // 도장이 지금 고정본 해시에 대한 것일 때만(회수·재완료 뒤 옛 도장 방어)
  if (!c || c.status !== "SIGNED" || !c.tsaToken || !tsaMatches(c.tsaToken, c.signedSha256)) return NextResponse.json({ found: false }, { status: 404 });
  return new NextResponse(new Uint8Array(Buffer.from(c.tsaToken, "base64")), {
    headers: {
      "Content-Type": "application/timestamp-reply",
      "Content-Disposition": `attachment; filename="${docNo}.tsr"`,
      "Cache-Control": "no-store",
    },
  });
}
