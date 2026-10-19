import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isRealDate } from "@/lib/schedule-payload";
import { ymdUTC } from "@/lib/holidays";
import { kstDate, kstToday, accrualAsOf, roundTo } from "@/lib/leave-accrual";
import { isLeaveDeductible } from "@/lib/leave-types";
import { approvedDaysByYear } from "@/lib/leave-days";
import { ensureLeaveCatalog } from "@/lib/leave-catalog-db";
import { groupCodes, groupOfType, isGrantGroup, type GrantGroup } from "@/lib/leave-grant";
import { excludedBranchNames } from "@/lib/employee-scope";
import {
  activeCalc, resignedCalc,
  type ActiveRow, type ResignedRow, type GrantLeft,
} from "@/lib/leave-settlement";

export const dynamic = "force-dynamic";

// 연차 정산(2026-10-16 이예지 QA76 #57 #58 #59 #60) — 본부(ADMIN, 서브 관리자 포함)만. 원장·직원 403. **읽기만**(GET 은 순수하게 — 무중단 배포 프록시가 GET 을 재시도한다).
//  GET ?mode=active&year=YYYY[&asOf=YYYY-MM-DD][&branches=대치,평촌][&includeAdmins=true][&includeTest=true]
//      재직자 미사용 연차(#57 #59) — 기준일 기본 = accrualAsOf(올해 = 오늘, 지난해 = 12/31). 기준일은 그해 안이어야 한다.
//      대상 = 퇴사일이 없거나 퇴사일 > 기준일(퇴사일 ≤ 기준일이면 퇴사자 정산 쪽 — 양쪽에 같은 사람이 나오지 않게) · 입사일이 기준일 이전(없으면 「입사일 없음」 행)
//  GET ?mode=resigned&from=YYYY-MM-DD&to=YYYY-MM-DD[&branches=…][&includeAdmins=true][&includeTest=true]
//      퇴사자 정산(#60) — 본부가 직원 관리에 적은 퇴사일(resignDate)이 from~to 안인 직원. 마지막 출근일로 판단하지 않는다
// 「사용」 = 승인된 연차 차감 휴가(isLeaveDeductible — 반차 0.5·반반차 0.25, 시프티 가져오기 휴가 포함)의 **그 해 몫** 합
//   (연도를 걸친 휴가는 날짜별로 해마다 — lib/leave-days, 차감·연차 대장 lib/leave-ledger approvedDeductibleDays 와 같은 나눔, 2026-10-19).
//   시간(일 × 8) ÷ 8 로 소수 둘째 자리.
//   사용은 자르는 날(재직자 = 기준일, 퇴사자 = 퇴사일)까지 시작한 휴가만 — 그 뒤로 잡힌 승인 휴가는 정산에 넣지 않고 따로 알린다
//   (재직자: 「기준일 뒤 승인 휴가」 참고 칸 · 퇴사자: 「퇴사일 뒤 승인 휴가 — 취소 필요」 비고). 보상·대체 잔여와 같은 기준일로 맞춰진다.
//   연도를 걸친 휴가(12/31~1/2)는 그 해 몫만 넣는다(12/31 몫 그해, 1/2 몫 다음 해 — 2026-10-19 본부 답). 몫 = 차감 때 저장한 값
//   (LeaveRequest.deductedByYear, 없으면 옛 규칙 — 시작 해에 통째로). 비고 crossYear 는 「나눠 넣음」 알림.
//   자르는 날(기준일·퇴사일)을 걸친 휴가(3/30~4/2, 퇴사 3/31)는 종전대로 그 해 몫을 통째로 사용에 넣고, 비고로 확인을 알린다.
// 「입사일」 = 직원 관리의 입사일(User.hireDate — 연차 자동 맞춤 lib/leave-accrual-run 과 같은 값, 인사명부 동기화가 루트입과일 규칙으로 채운다).
// 보상휴가·대체휴일 남은 시간 = (부여 합 − 승인된 그 그룹 휴가 합) × 8 — 자동 소멸 없음, 본부가 따로 정산(lib/leave-limit·leave-grant 와 같은 계산).
//   재직자는 기준일까지(종류별 잔여 화면 grantSummary 와 같은 자름), 퇴사자는 지금까지 전부(퇴사 뒤 본부 수동 조정까지 반영).
// 대상 범위는 「직원별 잔여 현황」(api/leave/balance)과 같다 — 휴지통(deletedAt) 제외, 관리자(본부)는 「관리자 포함」 때만,
//   통계 제외 지점(본부·테스트)은 「통계 제외 지점 포함」 때만.

const r2 = (n: number) => roundTo(n, 2);
const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

type Who = {
  id: string; empNo: number | null; name: string; branch: string | null; position: string | null; role: string;
  hireDate: Date | null; resignDate: Date | null;
};
const WHO_SELECT = { id: true, empNo: true, name: true, branch: true, position: true, role: true, hireDate: true, resignDate: true } as const;

/** 대상 범위 where — api/leave/balance GET 과 같은 규칙(관리자·통계 제외 지점) + 지점 고르기 */
async function scopeWhere(sp: URLSearchParams): Promise<Prisma.UserWhereInput> {
  const includeAdmins = sp.get("includeAdmins") === "true";
  const includeTest = sp.get("includeTest") === "true";
  const branches = (sp.get("branches") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const excluded = includeTest ? [] : await excludedBranchNames();
  const and: Prisma.UserWhereInput[] = [];
  if (excluded.length > 0) {
    // 관리자는 「관리자 포함」으로만 정한다(관리자 지점이 「본부」여도 빠지지 않게 — api/leave/balance 와 같음)
    and.push({ OR: [{ branch: null }, { branch: { notIn: excluded } }, ...(includeAdmins ? [{ role: "ADMIN" as const }] : [])] });
  }
  if (branches.length) and.push({ branch: { in: branches } });
  return {
    deletedAt: null,
    ...(includeAdmins ? {} : { role: { not: "ADMIN" as const } }),
    ...(and.length ? { AND: and } : {}),
  };
}

type UseAgg = { hours: number; afterCut: number; afterCutInYear: number; crossYear: boolean; crossCut: boolean };   // afterCutInYear = afterCut 중 정산 연도 몫(잔여 행 대조용)

/**
 * 사람마다(그 사람의 정산 연도·자르는 날) 승인된 연차 차감 휴가를 모은다. key = userId
 *  hours = 정산 연도 몫 중 자르는 날까지 시작한 휴가 시간 합(일 × 8) · afterCut = 자르는 날 뒤에 시작한 그해 몫 승인 휴가 일수
 *  crossYear = 정산 연도와 다른 해에 걸친 휴가가 있음(그 해 몫만 넣었다) · crossCut = 자르는 날을 걸친 휴가가 있음(시작은 그 전, 끝은 그 뒤)
 *  afterAll(퇴사자) = 자르는 날 뒤 승인 휴가를 해와 관계없이 전부 afterCut 에 센다(퇴사 다음 해로 잡힌 휴가도 「취소 필요」로). 사용 합계는 그대로
 */
async function usedBy(cuts: Map<string, { year: number; cut: string; afterAll?: boolean }>): Promise<Map<string, UseAgg>> {
  const out = new Map<string, UseAgg>([...cuts.keys()].map((id) => [id, { hours: 0, afterCut: 0, afterCutInYear: 0, crossYear: false, crossCut: false }]));
  if (!cuts.size) return out;
  const years = [...cuts.values()].map((c) => c.year);
  const range = { gte: new Date(Date.UTC(Math.min(...years), 0, 1)), lt: new Date(Date.UTC(Math.max(...years) + 1, 0, 1)) };
  const afterCuts = [...cuts.values()].filter((c) => c.afterAll).map((c) => c.cut).sort();
  const rows = await prisma.leaveRequest.findMany({
    // 그해에 하루라도 걸친 것(지난해 말에 시작해 그해로 넘어온 휴가의 그해 몫도 넣는다) + 퇴사자는 퇴사일 뒤 전부
    where: {
      userId: { in: [...cuts.keys()] }, status: "APPROVED",
      OR: [{ startDate: { lt: range.lt }, endDate: { gte: range.gte } }, ...(afterCuts.length ? [{ startDate: { gt: dayStart(afterCuts[0]) } }] : [])],
    },
    select: { userId: true, type: true, days: true, startDate: true, endDate: true, deductedByYear: true },
  });
  for (const r of rows) {
    if (!isLeaveDeductible(r.type)) continue;
    const c = cuts.get(r.userId), a = out.get(r.userId);
    if (!c || !a) continue;
    const sy = r.startDate.getUTCFullYear(), ey = r.endDate.getUTCFullYear();
    // 그 해 몫 — **차감 때 저장한 몫**(deductedByYear). 없으면 옛 규칙(시작 해에 days 통째로 — 그때 그렇게 차감했다)이라
    // 2025-12 에 시작한 옛 걸친 휴가의 2026 몫은 0 — 이중 계산이 없다. 자르는 날과는 그 해 안의 기간(시작·끝을 그 해로 자름)으로 비교한다
    const inYear = approvedDaysByYear(r).get(c.year) ?? 0;
    const s = sy < c.year ? `${c.year}-01-01` : ymdUTC(r.startDate);
    const e = ey > c.year ? `${c.year}-12-31` : ymdUTC(r.endDate);
    if (c.afterAll && ymdUTC(r.startDate) > c.cut) { a.afterCut += r.days; a.afterCutInYear += inYear; continue; }
    if (sy > c.year || ey < c.year) continue;   // 그 해에 걸치지 않음
    if (sy !== ey) a.crossYear = true;
    if (inYear <= 0) continue;   // 그 해에 걸친 날이 근무일이 아니면 그 해 몫 없음
    if (s > c.cut) { a.afterCut += inYear; a.afterCutInYear += inYear; continue; }
    a.hours += inYear * 8;
    if (e > c.cut) a.crossCut = true;
  }
  for (const a of out.values()) { a.afterCut = r2(a.afterCut); a.afterCutInYear = r2(a.afterCutInYear); }
  return out;
}

/** 보상휴가·대체휴일 남은 시간 — asOf 를 주면 그날까지(grantSummary 와 같은 자름), 없으면 전부 */
async function grantLeftBy(userIds: string[], asOf?: string): Promise<Map<string, GrantLeft>> {
  const out = new Map<string, GrantLeft>(userIds.map((id) => [id, { compHours: 0, substHours: 0 }]));
  if (!userIds.length) return out;
  const asOfD = asOf ? dayStart(asOf) : null;
  const codes = [...groupCodes("보상휴가"), ...groupCodes("대체휴일")];
  const [grants, uses] = await Promise.all([
    prisma.leaveGrant.findMany({
      where: {
        userId: { in: userIds },
        // 자동 부여는 근무일, 수동 조정은 넣은 날(KST)로 기준일을 가른다
        ...(asOfD ? { OR: [{ workDate: { lte: asOfD } }, { workDate: null, createdAt: { lt: new Date(addDays(asOfD, 1).getTime() - 9 * 3600000) } }] } : {}),
      },
      select: { userId: true, group: true, days: true },
    }),
    prisma.leaveRequest.findMany({
      where: { userId: { in: userIds }, status: "APPROVED", type: { in: codes }, ...(asOfD ? { startDate: { lte: asOfD } } : {}) },
      select: { userId: true, type: true, days: true },
    }),
  ]);
  const days = new Map<string, Record<GrantGroup, number>>();
  const slot = (uid: string) => { let v = days.get(uid); if (!v) { v = { "보상휴가": 0, "대체휴일": 0 }; days.set(uid, v); } return v; };
  for (const g of grants) if (isGrantGroup(g.group)) slot(g.userId)[g.group] += g.days;
  for (const u of uses) { const g = groupOfType(u.type); if (g) slot(u.userId)[g] -= u.days; }
  for (const [uid, v] of days) out.set(uid, { compHours: r2(v["보상휴가"] * 8), substHours: r2(v["대체휴일"] * 8) });
  return out;
}

const sortRows = <T extends { branch: string | null; name: string }>(rows: T[]) =>
  rows.sort((a, b) => (a.branch ?? "").localeCompare(b.branch ?? "", "ko") || a.name.localeCompare(b.name, "ko"));

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부만 볼 수 있습니다." }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const mode = sp.get("mode") === "resigned" ? "resigned" : "active";
  const today = kstToday();
  await ensureLeaveCatalog();   // 본부가 만든 유형(#216-1)의 차감 여부·보상/대체 그룹까지 보게
  // 메인 관리자(개발자 영역)는 김태석 본부장 계정에게만 — 「관리자 포함」을 켜도 다른 관리자에겐 안 보인다(10/17 디렉터)
  const { hiddenWhere } = await import("@/lib/hidden-accounts");
  const base: Prisma.UserWhereInput = { AND: [await scopeWhere(sp), await hiddenWhere(session)] };

  if (mode === "active") {
    const thisYear = Number(today.slice(0, 4));
    const year = Number(sp.get("year")) || thisYear;
    if (!Number.isInteger(year) || year < 2015 || year > thisYear + 1) return NextResponse.json({ error: "연도가 올바르지 않습니다." }, { status: 400 });
    const asOfRaw = sp.get("asOf");
    if (asOfRaw && (!isRealDate(asOfRaw) || asOfRaw.slice(0, 4) !== String(year))) return NextResponse.json({ error: "기준일은 그 연도 안의 날짜여야 합니다." }, { status: 400 });
    const asOf = asOfRaw || accrualAsOf(year, today);

    // 기준일 재직 — 퇴사일이 없으면 활성 계정만, 퇴사일이 있으면 그날이 기준일 이후(당일 포함)인 사람(지난해 정산 때 올해 퇴사자도 들어오게).
    // 저장 시각(UTC 자정·KST 자정)이 섞여 있을 수 있어 하루 넉넉히 뽑고 KST 날짜로 다시 거른다
    const users: Who[] = await prisma.user.findMany({
      where: { ...base, OR: [{ isActive: true, resignDate: null }, { resignDate: { gte: addDays(dayStart(asOf), -1) } }] },
      select: WHO_SELECT,
    });
    const targets = users.filter((u) => (!u.resignDate || kstDate(u.resignDate) > asOf) && (!u.hireDate || kstDate(u.hireDate) <= asOf));
    const ids = targets.map((u) => u.id);
    const [uses, grants, balances] = await Promise.all([
      usedBy(new Map(ids.map((id) => [id, { year, cut: asOf }]))),
      grantLeftBy(ids, asOf),
      prisma.leaveBalance.findMany({ where: { userId: { in: ids }, year }, select: { userId: true, used: true } }),
    ]);
    const balUsed = new Map(balances.map((b) => [b.userId, b.used]));
    const rows: ActiveRow[] = targets.map((u) => {
      const hire = u.hireDate ? kstDate(u.hireDate) : null;
      const resign = u.resignDate ? kstDate(u.resignDate) : null;
      const use = uses.get(u.id)!;
      return {
        userId: u.id, empNo: u.empNo, name: u.name, branch: u.branch, position: u.position, role: u.role,
        hireDate: hire, resignDate: resign,
        balanceUsed: balUsed.has(u.id) ? r2(balUsed.get(u.id)!) : null,
        ...(grants.get(u.id) ?? { compHours: 0, substHours: 0 }),
        usedAfterAsOf: use.afterCut, crossYear: use.crossYear, crossAsOf: use.crossCut,
        calc: hire ? activeCalc(hire, year, asOf, use.hours, resign) : null,
      };
    });
    return NextResponse.json({ mode, year, asOf, rows: sortRows(rows) });
  }

  // 퇴사자 — 기본 기간 = 올해 1/1 ~ 오늘
  const from = sp.get("from") || `${today.slice(0, 4)}-01-01`;
  const to = sp.get("to") || today;
  if (!isRealDate(from) || !isRealDate(to) || from > to) return NextResponse.json({ error: "퇴사 기간을 확인해 주세요." }, { status: 400 });
  if ((dayStart(to).getTime() - dayStart(from).getTime()) / 86400000 > 3660) return NextResponse.json({ error: "퇴사 기간은 10년까지 볼 수 있습니다." }, { status: 400 });
  const users: Who[] = await prisma.user.findMany({
    where: { ...base, resignDate: { gte: addDays(dayStart(from), -1), lt: addDays(dayStart(to), 2) } },
    select: WHO_SELECT,
  });
  const targets = users.filter((u) => { const r = kstDate(u.resignDate!); return r >= from && r <= to; });
  const ids = targets.map((u) => u.id);
  const years = [...new Set(targets.map((u) => Number(kstDate(u.resignDate!).slice(0, 4))))];
  const [uses, grants, balances] = await Promise.all([
    usedBy(new Map(targets.map((u) => { const r = kstDate(u.resignDate!); return [u.id, { year: Number(r.slice(0, 4)), cut: r, afterAll: true }]; }))),
    grantLeftBy(ids),
    prisma.leaveBalance.findMany({ where: { userId: { in: ids }, year: { in: years } }, select: { userId: true, year: true, used: true } }),
  ]);
  const balUsed = new Map(balances.map((b) => [`${b.userId}|${b.year}`, b.used]));
  const rows: ResignedRow[] = targets.map((u) => {
    const hire = u.hireDate ? kstDate(u.hireDate) : null;
    const resign = kstDate(u.resignDate!);
    const k = `${u.id}|${resign.slice(0, 4)}`;
    const use = uses.get(u.id)!;
    return {
      userId: u.id, empNo: u.empNo, name: u.name, branch: u.branch, position: u.position, role: u.role,
      hireDate: hire, resignDate: resign,
      balanceUsed: balUsed.has(k) ? r2(balUsed.get(k)!) : null,
      ...(grants.get(u.id) ?? { compHours: 0, substHours: 0 }),
      // 입사일이 없거나 퇴사일보다 늦으면(입력 오류) 계산하지 않는다
      usedAfterResign: use.afterCut, usedAfterResignInYear: use.afterCutInYear, crossYear: use.crossYear, crossResign: use.crossCut,
      calc: hire && hire <= resign ? resignedCalc(hire, resign, use.hours) : null,
    };
  });
  return NextResponse.json({ mode, from, to, rows: sortRows(rows) });
}
