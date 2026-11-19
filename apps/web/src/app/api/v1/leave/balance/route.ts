import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, v1Error } from "@/lib/api-key";
import { isRealDate } from "@/lib/schedule-payload";
import { resignLeaveBalances, type ResignLeaveQuery } from "@/lib/resign-leave-api";

export const dynamic = "force-dynamic";

// 퇴사자 잔여연차 읽기 — 회사 연동 키(ORG, scope leave:read) 전용 (2026-11-19 이예지 요청, 디렉터 「진행해」)
// 직영 포털 「급여 관리」가 퇴사 달 연차수당을 계산할 때 잔여연차를 옮겨 적지 않고 바로 읽어 간다.
//   GET /api/v1/leave/balance?leaveFrom=2026-11-01&leaveTo=2026-11-30   — 이 기간에 퇴사일이 든 사람(퇴사 예정자 포함, 한 번에 366일까지)
//   GET /api/v1/leave/balance?empNo=6210                                — 한 사람(퇴사일이 정해진 사람만)
//   → { rows: [...] }
// 계산 · 서류 값 · 정산 일수 규칙은 lib/resign-leave-api 머리말. 본부 「연차 정산」 퇴사자 탭과 같은 계산이다.
// GET 은 순수하게 — 무중단 배포 프록시가 GET 을 재시도한다. 읽기만 한다.
const MAX_DAYS = 366;

export async function GET(request: NextRequest) {
  const a = await authenticateApiKey(request, "leave:read", "read");
  if (a.ok === false) return a.res;
  if (a.p.key.kind !== "ORG") return v1Error(403, "회사 연동 키로만 쓸 수 있습니다.", "ORG_KEY_ONLY");

  const sp = new URL(request.url).searchParams;
  const from = (sp.get("leaveFrom") || "").trim(), to = (sp.get("leaveTo") || "").trim();
  const empRaw = (sp.get("empNo") || "").trim();

  let q: ResignLeaveQuery;
  if (empRaw) {
    if (from || to) return v1Error(400, "empNo 와 leaveFrom · leaveTo 는 함께 쓸 수 없습니다.", "BAD_QUERY");
    if (!/^\d{1,6}$/.test(empRaw)) return v1Error(400, "empNo 는 사번 숫자여야 합니다(예: empNo=6210 또는 06210).", "BAD_EMPNO");
    q = { mode: "empNo", empNo: Number(empRaw) };
  } else {
    if (!isRealDate(from) || !isRealDate(to))
      return v1Error(400, "leaveFrom · leaveTo 는 YYYY-MM-DD 날짜여야 합니다(예: leaveFrom=2026-11-01&leaveTo=2026-11-30). 한 사람은 empNo 로.", "BAD_RANGE");
    if (from > to) return v1Error(400, "leaveFrom 이 leaveTo 보다 늦습니다.", "BAD_RANGE");
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000 + 1;
    if (days > MAX_DAYS) return v1Error(400, `한 번에 ${MAX_DAYS}일까지 받을 수 있습니다.`, "RANGE_TOO_LONG");
    q = { mode: "range", from, to };
  }

  const r = await resignLeaveBalances(q);
  if ("notFound" in r) return v1Error(404, r.notFound, "NOT_FOUND");
  return NextResponse.json({ rows: r.rows }, { headers: { "Cache-Control": "no-store" } });
}
