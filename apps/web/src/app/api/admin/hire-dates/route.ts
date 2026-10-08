import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { recalcYearBalanceForHire } from "@/lib/leave-recalc";
import { portalConfig, fetchPortalRoster, mapBranch, HIRE_CONFIRM_PREFIX } from "@/lib/portal-roster";

export const dynamic = "force-dynamic";

// 입사일 대조·일괄 반영(2026-10-08 QA76 이관 #5) — 본부만.
//  GET: 재직 직원마다 큐브티 입사일과 포털 명부 입사일(사번 → 이름+지점으로 짝). 시프티 입사일은 화면이 엑셀로 붙인다
//  POST { items: [{ userId, hireDate, source }] }: 고른 값으로 입사일을 바꾸고(감사 기록) 올해 연차 총량을 근속으로 다시 센다(사용은 그대로)
//  ⚠ 포털 규칙(2026-09-18): 7월 이전 입사자는 루트입과일이 입사일이 아니다(hireDateEditable=false) — 표에는 보여 주되 본부가 골라야 반영된다
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const okYmd = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return false;   // 2024-13-01 같은 값은 여기서 걸러야 toISOString 이 던지지 않는다
  return v >= "1990-01-01" && d.getTime() <= Date.now() + 366 * 86400000;              // 입사 예정은 1년 안까지
};
const normName = (s: string) => s.replace(/\s+/g, "");

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
  // 짝짓기는 인사명부 연동과 같은 수준으로: 사번이 같아도 **이름(또는 이메일)이 같아야** 하고(큐브티 사번은 자동 발급이라 포털 번호와 우연히 겹친다),
  // 같은 사번이 여러 줄이면 짝 짓지 않는다. 폴백은 이름+지점(mapBranch 로 지점명 맞춤) 유일할 때만
  type P = { joinDate: string; editable: boolean; name: string; email: string };
  let portalError: string | null = null;
  const byEmpNo = new Map<number, P[]>();
  const byNameBranch = new Map<string, P[]>();
  let known = new Set<string>();
  try {
    const cfg = await portalConfig();
    if (!cfg) portalError = "포털 연결이 설정되지 않았습니다.";
    else {
      known = new Set((await prisma.branch.findMany({ select: { name: true } })).map((b) => b.name));
      for (const r of await fetchPortalRoster(cfg)) {
        // 입사일 없는 줄도 「같은 사번 여러 줄」 판정에는 넣는다(검증 R3) — 짝은 아래에서 joinDate 있는 것만
        const v: P = { joinDate: r.joinDate || "", editable: r.hireDateEditable !== false, name: normName(r.name), email: r.email.trim().toLowerCase() };
        if (r.empNo != null) byEmpNo.set(r.empNo, [...(byEmpNo.get(r.empNo) ?? []), v]);
        const b = mapBranch(r.branch, known).value ?? r.branch.trim();
        const k = `${v.name}|${b}`;
        byNameBranch.set(k, [...(byNameBranch.get(k) ?? []), v]);
      }
    }
  } catch (e) { portalError = e instanceof Error ? e.message : "포털 명부를 읽지 못했습니다."; }
  const confirmed = new Map((await prisma.appSetting.findMany({ where: { key: { startsWith: HIRE_CONFIRM_PREFIX } }, select: { key: true, value: true } })).map((s) => [s.key.slice(HIRE_CONFIRM_PREFIX.length), s.value]));
  const rows = users.map((u) => {
    let p: P | undefined; let note: string | null = null;
    const nn = normName(u.name), em = u.email.trim().toLowerCase();
    if (u.empNo != null) {
      const c = byEmpNo.get(u.empNo) ?? [];
      if (c.length > 1) note = "포털에 같은 사번이 여러 줄";
      else if (c.length === 1) { if (c[0].name === nn || (c[0].email && c[0].email === em)) p = c[0]; else note = `사번 충돌 의심(포털 ${c[0].name})`; }
    }
    if (!p && !note && u.branch) { const c = byNameBranch.get(`${nn}|${u.branch.trim()}`) ?? []; if (c.length === 1) p = c[0]; else if (c.length > 1) note = "포털에 같은 이름·지점이 여러 줄"; }
    if (p && !p.joinDate) p = undefined;   // 짝은 맞았지만 포털에 입사일이 없는 줄
    return { userId: u.id, empNo: u.empNo, name: u.name, email: u.email, branch: u.branch, cubetee: ymd(u.hireDate), portal: p?.joinDate || null, portalEditable: p ? p.editable : null, portalNote: note, confirmed: confirmed.get(u.id) ?? null, resigned: !!u.resignDate && u.resignDate < new Date() };
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
  let applied = 0, confirmed = 0; const errors: string[] = []; const warnings: string[] = [];
  for (const it of items) {
    const o = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
    const userId = typeof o.userId === "string" ? o.userId : "";
    const source = typeof o.source === "string" ? o.source.slice(0, 20) : "직접 입력";
    if (!userId || !okYmd(o.hireDate)) { errors.push(`${userId || "?"}: 날짜 형식 오류`); continue; }
    const hireDate = o.hireDate;
    // 대상은 대조표와 같은 범위(재직·관리자 제외) — 임의 userId 로 관리자·퇴사자 입사일을 바꾸지 못하게(#5 검증 F5)
    const u = await prisma.user.findFirst({ where: { id: userId, deletedAt: null, isActive: true, role: { not: "ADMIN" } }, select: { id: true, name: true, hireDate: true } });
    if (!u) { errors.push(`${userId}: 대상이 아닌 직원(관리자·비활성·없음)`); continue; }
    const before = ymd(u.hireDate);
    // 본부 확정 표식 — 포털 동기화가 이 값을 되돌리자고 제안하지 않게(lib/portal-roster planPortalSync)
    await prisma.appSetting.upsert({ where: { key: `${HIRE_CONFIRM_PREFIX}${u.id}` }, create: { key: `${HIRE_CONFIRM_PREFIX}${u.id}`, value: hireDate }, update: { value: hireDate } });
    if (before === hireDate) { confirmed++; continue; }   // 같으면 날짜는 손대지 않는다(감사 기록도 남기지 않는다) — 확정 표식만 남는다
    await prisma.user.update({ where: { id: u.id }, data: { hireDate: new Date(`${hireDate}T00:00:00Z`) } });
    await logAudit({ actorId: session.userId, actorName: session.name, action: "EMPLOYEE_UPDATE", targetType: "USER", targetId: u.id, targetName: u.name, detail: `입사일 ${before ?? "-"}→${hireDate} (입사일 대조표, 출처: ${source})` });
    // 올해 연차 총량을 근속으로 다시 센다 — lib/leave-recalc(포털 인사명부 반영과 같은 함수)
    const rc = await recalcYearBalanceForHire({ id: u.id, name: u.name }, new Date(`${hireDate}T00:00:00Z`), { id: session.userId, name: session.name }, "입사일 변경 재계산");
    if (rc.warning) warnings.push(rc.warning);
    applied++;
  }
  return NextResponse.json({ success: true, applied, confirmed, errors, warnings });
}
