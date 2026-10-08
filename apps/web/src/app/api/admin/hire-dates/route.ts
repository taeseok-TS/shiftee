import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { annualLeaveDays, currentLeaveYear } from "@/lib/leave-calc";
import { portalConfig, fetchPortalRoster } from "@/lib/portal-roster";

export const dynamic = "force-dynamic";

// 입사일 대조·일괄 반영(2026-10-08 QA76 이관 #5) — 본부만.
//  GET: 재직 직원마다 큐브티 입사일과 포털 명부 입사일(사번 → 이름+지점으로 짝). 시프티 입사일은 화면이 엑셀로 붙인다
//  POST { items: [{ userId, hireDate, source }] }: 고른 값으로 입사일을 바꾸고(감사 기록) 올해 연차 총량을 근속으로 다시 센다(사용은 그대로)
//  ⚠ 포털 규칙(2026-09-18): 7월 이전 입사자는 루트입과일이 입사일이 아니다(hireDateEditable=false) — 표에는 보여 주되 본부가 골라야 반영된다
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const okYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v && v >= "1990-01-01";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부만 볼 수 있습니다." }, { status: 403 });
  const users = await prisma.user.findMany({
    where: { deletedAt: null, isActive: true, role: { not: "ADMIN" } },
    select: { id: true, empNo: true, name: true, email: true, branch: true, hireDate: true, resignDate: true },
    orderBy: [{ branch: "asc" }, { name: "asc" }],
  });
  // 포털 명부 — 연결이 없거나 실패하면 포털 칸은 비운다(대조표 자체는 열린다)
  let portalError: string | null = null;
  const byEmpNo = new Map<number, { joinDate: string; editable: boolean }>();
  const byNameBranch = new Map<string, { joinDate: string; editable: boolean }[]>();
  try {
    const cfg = await portalConfig();
    if (!cfg) portalError = "포털 연결이 설정되지 않았습니다.";
    else for (const r of await fetchPortalRoster(cfg)) {
      const v = { joinDate: r.joinDate, editable: r.hireDateEditable !== false };
      if (r.empNo != null) byEmpNo.set(r.empNo, v);
      const k = `${r.name.trim()}|${r.branch.trim()}`;
      byNameBranch.set(k, [...(byNameBranch.get(k) ?? []), v]);
    }
  } catch (e) { portalError = e instanceof Error ? e.message : "포털 명부를 읽지 못했습니다."; }
  const rows = users.map((u) => {
    let p = u.empNo != null ? byEmpNo.get(u.empNo) : undefined;
    if (!p && u.branch) { const c = byNameBranch.get(`${u.name.trim()}|${u.branch.trim()}`) ?? []; if (c.length === 1) p = c[0]; }
    return { userId: u.id, empNo: u.empNo, name: u.name, email: u.email, branch: u.branch, cubetee: ymd(u.hireDate), portal: p?.joinDate || null, portalEditable: p ? p.editable : null, resigned: !!u.resignDate && u.resignDate < new Date() };
  });
  return NextResponse.json({ rows, portalError });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부만 할 수 있습니다." }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  const items = body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items) ? ((body as { items: unknown[] }).items) : [];
  if (!items.length) return NextResponse.json({ error: "반영할 항목이 없습니다." }, { status: 400 });
  if (items.length > 500) return NextResponse.json({ error: "한 번에 500명까지 반영할 수 있습니다." }, { status: 400 });
  const now = new Date(), year = currentLeaveYear();
  let applied = 0; const errors: string[] = [];
  for (const it of items) {
    const o = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
    const userId = typeof o.userId === "string" ? o.userId : "";
    const source = typeof o.source === "string" ? o.source.slice(0, 20) : "직접 입력";
    if (!userId || !okYmd(o.hireDate)) { errors.push(`${userId || "?"}: 날짜 형식 오류`); continue; }
    const hireDate = o.hireDate;
    const u = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, name: true, hireDate: true } });
    if (!u) { errors.push(`${userId}: 직원 없음`); continue; }
    const before = ymd(u.hireDate);
    if (before === hireDate) continue;   // 같으면 손대지 않는다(감사 기록도 남기지 않는다)
    await prisma.user.update({ where: { id: u.id }, data: { hireDate: new Date(`${hireDate}T00:00:00Z`) } });
    await logAudit({ actorId: session.userId, actorName: session.name, action: "EMPLOYEE_UPDATE", targetType: "USER", targetId: u.id, targetName: u.name, detail: `입사일 ${before ?? "-"}→${hireDate} (입사일 대조표, 출처: ${source})` });
    // 올해 연차 총량을 근속으로 다시 센다 — 「연차 자동계산」과 같은 규칙(사용은 그대로, 잔여 = 총 − 사용)
    const total = annualLeaveDays(new Date(`${hireDate}T00:00:00Z`), now);
    const bal = await prisma.leaveBalance.findUnique({ where: { userId_year: { userId: u.id, year } }, select: { used: true, total: true } });
    const used = bal?.used ?? 0, remaining = Math.max(0, total - used);
    await prisma.leaveBalance.upsert({ where: { userId_year: { userId: u.id, year } }, create: { userId: u.id, year, total, used, remaining }, update: { total, remaining } });
    if (!bal || bal.total !== total)
      await logAudit({ actorId: session.userId, actorName: session.name, action: "LEAVE_BALANCE_UPDATE", targetType: "USER", targetId: u.id, targetName: u.name, detail: `(입사일 변경 재계산 ${year}년) 연차 총 ${bal?.total ?? "-"}→${total}일, 사용 ${used}일, 잔여 ${remaining}일` });
    applied++;
  }
  return NextResponse.json({ success: true, applied, errors });
}
