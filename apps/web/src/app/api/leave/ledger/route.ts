import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { currentLeaveYear } from "@/lib/leave-calc";
import { ledgerAccess, buildLedger } from "@/lib/leave-ledger";
import { canSeeLeaveBalance } from "@/lib/permission-settings";

/**
 * 연차 대장 조회 — 관리자 = 전 직원 · 원장 = 담당 지점 직원(+본인) · 직원 = 본인(디렉터 9/11).
 * userId 를 안 주면 본인. 조회만 한다(GET 은 순수하게 — 무중단 배포 프록시가 GET 을 재시도한다).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const userId = sp.get("userId") || session.userId;
  const rawYear = sp.get("year");
  const year = rawYear === null ? currentLeaveYear() : Number(rawYear);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "연도가 올바르지 않습니다." }, { status: 400 });
  }

  const access = await ledgerAccess(session, userId);
  if (access === "notfound") return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  if (access === "forbidden") return NextResponse.json({ error: "이 직원의 연차 대장을 볼 권한이 없습니다." }, { status: 403 });

  const ledger = await buildLedger(userId, year);
  if (!ledger) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  // 잔여 숫자 숨김(2026-10-16 #219-1) — 직원·원장이 볼 때는 총·사용·잔여와 잔여 조정 이력(「총 15→…일」 문구)을 빼고
  // balanceHidden 을 준다(화면 「연차 정리 중」). 휴가 기록·결재 기록은 그대로. 본부는 언제나 본다
  if (!(await canSeeLeaveBalance(session.role))) {
    const hidden = {
      ...ledger,
      balance: null,
      adjustments: [],
      summary: { approvedDeductibleDays: ledger.summary.approvedDeductibleDays, balanceUsed: null, match: null },
    };
    return NextResponse.json({ ledger: hidden, balanceHidden: true, canDownloadPdf: false });
  }
  // PDF 는 관리자만 — 화면은 이 값으로만 버튼을 그린다
  return NextResponse.json({ ledger, balanceHidden: false, canDownloadPdf: session.role === "ADMIN" });
}
