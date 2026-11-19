// 연차 정산 서버 계산(DB) — api/leave/settlement(본부 화면)와 /api/v1/leave/balance(직영 포털 퇴사자 잔여연차, 2026-11-19)가 같이 쓴다.
// 2026-11-19 api/leave/settlement/route.ts 에서 그대로 옮겼다(계산은 바꾸지 않았다). 설명은 그 라우트 머리말을 본다.
import { prisma } from "@/lib/db";
import { ymdUTC } from "@/lib/holidays";
import { roundTo } from "@/lib/leave-accrual";
import { isLeaveDeductible } from "@/lib/leave-types";
import { approvedDaysByYear } from "@/lib/leave-days";
import { groupCodes, groupOfType, isGrantGroup, type GrantGroup } from "@/lib/leave-grant";
import type { GrantLeft } from "@/lib/leave-settlement";

export const r2 = (n: number) => roundTo(n, 2);
export const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

export type UseAgg = { hours: number; afterCut: number; afterCutInYear: number; crossYear: boolean; crossCut: boolean };   // afterCutInYear = afterCut 중 정산 연도 몫(잔여 행 대조용)

/**
 * 사람마다(그 사람의 정산 연도·자르는 날) 승인된 연차 차감 휴가를 모은다. key = userId
 *  hours = 정산 연도 몫 중 자르는 날까지 시작한 휴가 시간 합(일 × 8) · afterCut = 자르는 날 뒤에 시작한 그해 몫 승인 휴가 일수
 *  crossYear = 정산 연도와 다른 해에 걸친 휴가가 있음(그 해 몫만 넣었다) · crossCut = 자르는 날을 걸친 휴가가 있음(시작은 그 전, 끝은 그 뒤)
 *  afterAll(퇴사자) = 자르는 날 뒤 승인 휴가를 해와 관계없이 전부 afterCut 에 센다(퇴사 다음 해로 잡힌 휴가도 「취소 필요」로). 사용 합계는 그대로
 */
export async function usedBy(cuts: Map<string, { year: number; cut: string; afterAll?: boolean }>): Promise<Map<string, UseAgg>> {
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
export async function grantLeftBy(userIds: string[], asOf?: string): Promise<Map<string, GrantLeft>> {
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

