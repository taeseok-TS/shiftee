import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { buildLedger } from "@/lib/leave-ledger";
import { renderLedgerPdf } from "@/lib/leave-ledger-pdf";

/**
 * 연차 대장 PDF — **관리자만**(디렉터 9/11). 분쟁 때 그대로 보여주거나 출력하는 용도.
 * POST 로 받는다 — 누가 누구의 대장을 내려받았는지 감사 로그를 남기므로 GET 이면 안 된다
 * (무중단 배포 프록시가 GET 을 재시도해 기록이 중복된다).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "연차 대장 PDF 는 관리자만 내려받을 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const userId = (body as { userId?: unknown } | null)?.userId;
  const year = (body as { year?: unknown } | null)?.year;
  if (typeof userId !== "string" || !userId || !Number.isInteger(year) || (year as number) < 2020 || (year as number) > 2100) {
    return NextResponse.json({ error: "요청이 올바르지 않습니다. (userId, year)" }, { status: 400 });
  }

  const ledger = await buildLedger(userId, year as number);
  if (!ledger) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });

  let pdf: Buffer;
  try {
    pdf = await renderLedgerPdf(ledger, { issuedBy: session.name, issuedAt: new Date() });
  } catch (e) {
    console.error("[ledger-pdf] 생성 실패:", e);
    return NextResponse.json({ error: "PDF 를 만들지 못했습니다(한글 글꼴을 읽지 못했을 수 있습니다)." }, { status: 500 });
  }

  await logAudit({
    actorId: session.userId, actorName: session.name, action: "LEAVE_LEDGER_PDF",
    targetType: "USER", targetId: userId, targetName: ledger.user.name,
    detail: `연차 대장 PDF 내려받기 (${ledger.year}년)`,
  });

  const filename = `연차대장_${ledger.user.name}_${ledger.year}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ledger.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
