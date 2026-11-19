import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, v1Error } from "@/lib/api-key";
import { kstToday } from "@/lib/leave-accrual";
import { salaryContracts, decodeSalaryCursor, type SalaryQuery } from "@/lib/salary-contract-api";
import { isRealDate } from "@/lib/schedule-payload";

export const dynamic = "force-dynamic";

// 연봉 계약 읽기 — 회사 연동 키(ORG, scope contract:read) 전용 (2026-11-19 이예지 요청, 디렉터 「진행해」)
// 직영 포털 「급여 관리」가 매달 그달에 적용되는 연봉을 큐브티 계약에서 바로 가져간다(시트에 옮겨 적다 빠지는 사람이 생겨서).
//   GET /api/v1/contracts/salary                       — 지금 유효한 계약 전체(실제 적용 끝(effectiveEndDate)이 없거나 오늘 이후, 「취소」 제외, 작성 중 · 서명 대기 포함)
//   GET /api/v1/contracts/salary?signedSince=<ISO>     — 이 시각 이후 체결(서명 완료)됐거나 내용 · 상태가 바뀐 계약(취소 포함)
//   GET /api/v1/contracts/salary?empNo=6790            — 한 사람의 계약 전부(지난 계약 · 퇴사자 포함)
//   → { mode, contracts: [...], nextCursor } — 한 번에 1,000건. nextCursor 가 있으면 같은 질의에 &cursor=<nextCursor> 를 붙여 이어 받는다
// 대상 · 금액 단위(payUnit) · 같은 시작일 정정(superseded)은 lib/salary-contract-api 머리말. 급여에는 status 「체결 완료」 · superseded false 만 쓴다.
// 모두싸인에서 옮겨 온 지난 계약(11/9 이전)은 금액 칸이 없어 오지 않는다.
// GET 은 순수하게 — 무중단 배포 프록시가 GET 을 재시도한다. 읽기만 한다.
export async function GET(request: NextRequest) {
  const a = await authenticateApiKey(request, "contract:read", "read");
  if (a.ok === false) return a.res;
  if (a.p.key.kind !== "ORG") return v1Error(403, "회사 연동 키로만 쓸 수 있습니다.", "ORG_KEY_ONLY");

  const sp = new URL(request.url).searchParams;
  const sinceRaw = (sp.get("signedSince") || "").trim();
  const empRaw = (sp.get("empNo") || "").trim();
  if (sinceRaw && empRaw) return v1Error(400, "signedSince 와 empNo 는 함께 쓸 수 없습니다.", "BAD_QUERY");

  let q: SalaryQuery;
  if (empRaw) {
    if (!/^\d{1,6}$/.test(empRaw)) return v1Error(400, "empNo 는 사번 숫자여야 합니다(예: empNo=6790 또는 06790).", "BAD_EMPNO");
    q = { mode: "empNo", empNo: Number(empRaw) };
  } else if (sinceRaw) {
    // 시각대가 빠지면 서버(UTC) 기준으로 읽혀 9시간 어긋난다 — Z 또는 +09:00 을 붙이게 한다
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(sinceRaw))
      return v1Error(400, "signedSince 는 시각대가 있는 ISO 시각이어야 합니다(예: 2026-11-01T00:00:00Z 또는 2026-11-01T00:00:00+09:00).", "BAD_SINCE");
    const since = new Date(sinceRaw);
    if (Number.isNaN(since.getTime()) || !isRealDate(sinceRaw.slice(0, 10))) return v1Error(400, "signedSince 시각을 읽지 못했습니다(없는 날짜).", "BAD_SINCE");
    q = { mode: "since", since };
  } else {
    q = { mode: "current", today: kstToday() };
  }

  const curRaw = (sp.get("cursor") || "").trim();
  const cursor = curRaw ? decodeSalaryCursor(curRaw) : null;
  if (curRaw && !cursor) return v1Error(400, "cursor 는 직전 응답의 nextCursor 를 그대로 보내 주세요.", "BAD_CURSOR");

  const r = await salaryContracts(q, cursor);
  return NextResponse.json(
    { mode: q.mode, contracts: r.rows, nextCursor: r.nextCursor },
    { headers: { "Cache-Control": "no-store" } },
  );
}
