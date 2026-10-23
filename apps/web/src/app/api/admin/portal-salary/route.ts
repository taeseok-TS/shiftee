import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertSalaryAccess, NO_STORE } from "@/lib/salary-access";
import { logAudit } from "@/lib/audit";
import { portalSalaryFor } from "@/lib/portal-hr-salary";

export const dynamic = "force-dynamic";

// 계약서 작성 화면의 연봉 칸 기본값(2026-10-23 본부 합의) — 고른 직원들의 포털 연봉(lib/portal-hr-salary).
//  · 권한은 인사 › 연봉과 같다: 「연봉 보기」 관리자 + 비밀번호 재확인 열쇠(30분) — assertSalaryAccess 그대로. 못 보면 403(code FORBIDDEN·LOCKED)
//  · 큐브티에 저장하지 않는다 — 돌려주기만 한다. 응답은 캐시하지 않는다(no-store)
//  · 열람 기록: 값을 돌려준 사람이 있으면 변경 로그(SALARY_PORTAL_VIEW)에 누가·몇 명분을 봤는지 남긴다(금액은 남기지 않는다 — 연봉 화면 열람 기록과 같은 규칙)
// POST { userIds: string[] } → { portal, results: { [userId]: { found, amount, from, to } | { found:false, reason } }, expiresAt }
// GET 이 아니라 POST — 열람 기록을 남기는 요청이라 프록시 재시도(GET 만)에 두 번 남지 않게
export async function POST(request: NextRequest) {
  const session = await getSession();
  const gate = await assertSalaryAccess(request, session);
  if (!gate.ok) return NextResponse.json({ error: gate.error, code: gate.code }, { status: gate.status, headers: NO_STORE });

  const body = await request.json().catch(() => null) as { userIds?: unknown } | null;
  const ids = [...new Set((Array.isArray(body?.userIds) ? body!.userIds : []).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 64))];
  if (!ids.length) return NextResponse.json({ error: "직원을 골라 주세요." }, { status: 400, headers: NO_STORE });
  if (ids.length > 200) return NextResponse.json({ error: "한 번에 200명까지 볼 수 있습니다." }, { status: 400, headers: NO_STORE });

  try {
    const users = await prisma.user.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, empNo: true, name: true } });
    const { portal, byUser } = await portalSalaryFor(users);
    const shown = users.filter((u) => { const r = byUser[u.id]; return !!r && r.found && r.amount != null; });
    if (shown.length) {
      const names = shown.slice(0, 10).map((u) => u.name).join(", ");
      await logAudit({
        actorId: session!.userId, actorName: session!.name, action: "SALARY_PORTAL_VIEW", targetType: "SALARY", targetId: null, targetName: "포털 연봉",
        detail: `계약서 작성 — 포털 연봉 기본값 ${shown.length}명분 조회(${names}${shown.length > 10 ? ` 외 ${shown.length - 10}명` : ""})`,
      });
    }
    return NextResponse.json({ portal, results: byUser, expiresAt: gate.expiresAt ?? null }, { headers: NO_STORE });
  } catch {
    // 처리 안 된 오류는 시스템 로그(서브 관리자도 봄)에 남는다 — 연봉 값이 섞이지 않게 여기서 끝낸다
    return NextResponse.json({ portal: "fail", results: {}, error: "포털 연봉을 받지 못했습니다." }, { status: 200, headers: NO_STORE });
  }
}
