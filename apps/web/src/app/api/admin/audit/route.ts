import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SYSTEM_AUDIT_ACTIONS, AUDIT_KIND_PREFIX, AUDIT_HR_EXCLUDE_PREFIX, isAuditKind, type AuditScope } from "@/lib/audit-labels";

// 변경(감사) 로그 조회(QA76 #66 후속, 2026-10-14 디렉터 결정) — 관리자 전부.
//  · scope=work   : 업무 변경 기록(시스템·보안 action 제외) — 모든 관리자
//  · scope=system : 시스템·보안 기록 — 최고관리자만(아니면 403)
//  · q      : 바꾼 사람·대상·내용·작업 코드 부분 일치
//  · kind   : 종류(2026-10-23 ■3) — 업무 변경 탭에서만. 기본 hr = 큐브티워크 기록(자료 제출 · 이모티콘) · 마케팅 배포 · 입학정보실 입장 빼고, all = 전부
//  · before : 「더 보기」 커서 = 마지막 줄의 `createdAt(ISO)|id`. 같은 밀리초 기록을 건너뛰지 않게 (createdAt, id) 둘로 자른다
const TAKE = 100;
const Q_MAX = 60;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 볼 수 있습니다." }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const scope: AuditScope = sp.get("scope") === "system" ? "system" : "work";
  const superAdmin = await isSuperAdmin(session.userId);
  if (scope === "system" && !superAdmin) return NextResponse.json({ error: "시스템·보안 기록은 최고관리자만 볼 수 있습니다." }, { status: 403 });

  const q = (sp.get("q") || "").trim().slice(0, Q_MAX);
  const beforeRaw = sp.get("before");
  let cursor: { at: Date; id: string } | null = null;
  if (beforeRaw) {
    const bar = beforeRaw.lastIndexOf("|");
    const at = new Date(bar >= 0 ? beforeRaw.slice(0, bar) : beforeRaw);
    const id = bar >= 0 ? beforeRaw.slice(bar + 1) : "";
    if (Number.isNaN(at.getTime())) return NextResponse.json({ error: "before 가 올바른 커서가 아닙니다." }, { status: 400 });
    cursor = { at, id };
  }

  const where: Record<string, unknown> = {
    action: scope === "system" ? { in: [...SYSTEM_AUDIT_ACTIONS] } : { notIn: [...SYSTEM_AUDIT_ACTIONS] },
  };
  const and: Record<string, unknown>[] = [];
  if (cursor) and.push(cursor.id ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : { createdAt: { lt: cursor.at } });
  if (q) {
    and.push({ OR: [
      { actorName: { contains: q, mode: "insensitive" } },
      { targetName: { contains: q, mode: "insensitive" } },
      { detail: { contains: q, mode: "insensitive" } },
      { action: { contains: q.toUpperCase() } },
    ] });
  }
  const kindRaw = sp.get("kind");
  const kind = scope === "work" ? (isAuditKind(kindRaw) ? kindRaw : "hr") : "all";
  if (kind === "hr") and.push({ NOT: { OR: AUDIT_HR_EXCLUDE_PREFIX.map((p) => ({ action: { startsWith: p } })) } });
  else if (kind !== "all") and.push({ OR: AUDIT_KIND_PREFIX[kind].map((p) => ({ action: { startsWith: p } })) });
  if (and.length) where.AND = and;   // 커서 OR 와 검색 OR 가 서로 덮어쓰지 않게 AND 로 묶는다

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TAKE + 1,
    select: { id: true, actorName: true, action: true, targetType: true, targetName: true, detail: true, createdAt: true },
  });
  const hasMore = rows.length > TAKE;
  const logs = hasMore ? rows.slice(0, TAKE) : rows;
  return NextResponse.json({ logs, hasMore, scope, superAdmin });
}
