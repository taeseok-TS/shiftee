import { prisma } from "@/lib/db";
import { breakHours } from "@/lib/schedule-payload";
import { ymdUTC } from "@/lib/holidays";
import { kstTodayDateUTC } from "@/lib/kst";
import { LEAVE_CATALOG, leaveLabel } from "@/lib/leave-catalog";
import { excludedBranchNames } from "@/lib/employee-scope";
import { logAudit } from "@/lib/audit";

// ─── 보상휴가·대체휴일 자동 부여와 종류별 잔여(2026-10-08 QA76 #50 #56) ─────────
// 본부 답변 #26(근로기준법 56조):
//  · 5/1 근로자의 날에 실제 출퇴근 기록(휴게 제외)이 있으면 보상휴가 — 8h 이내 ×1.5, 넘는 시간 ×2, 1일 = 8h
//    (8h → 12h = 1.5일, 4h → 6h = 0.75일, 10h → 12+4 = 16h = 2일). 쉰 사람은 없음(원래 쉬는 날이든 유급휴일로 쉬었든)
//  · 본부가 「대체휴무 부여」로 지정한 공휴일(Holiday.grantsLeave)에 **평일** 근무 기록이 있으면 대체휴일 1일(#56 요청: 주말 제외)
//  · 그룹마다 초과 사용 제한 없음(본부 답변 #19) — 잔여가 모자라도 신청은 막지 않는다. 잔여는 본부 화면에서만(#50)
// 자동 부여(AUTO)는 (userId, group, workDate) 하나다. 매일 밤 최근 45일을 다시 계산해 근무 기록이 바뀌면 갱신, 없어지면 지운다.
// 수동 조정(MANUAL)은 본부가 사유와 함께 넣는다(음수 = 차감). 잔여 = 부여 합 − 승인된 그 그룹 휴가 일수(기준일까지).
export const GRANT_GROUPS = ["보상휴가", "대체휴일"] as const;
export type GrantGroup = (typeof GRANT_GROUPS)[number];
export const isGrantGroup = (v: unknown): v is GrantGroup => typeof v === "string" && (GRANT_GROUPS as readonly string[]).includes(v);
const WORKERS_DAY = "05-01";
const LOOKBACK_DAYS = 45;
const GROUP_CODES: Record<GrantGroup, string[]> = {
  "보상휴가": LEAVE_CATALOG.filter((t) => t.group === "보상휴가").map((t) => t.code),
  "대체휴일": LEAVE_CATALOG.filter((t) => t.group === "대체휴일").map((t) => t.code),
};
const groupOfType = (code: string): GrantGroup | null => (GRANT_GROUPS.find((g) => GROUP_CODES[g].includes(code)) ?? null);

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

/** 근로기준법 56조 휴일근로 가산 시간 — 8h 이내 ×1.5, 초과 ×2 */
export function creditHours(netHours: number): number {
  if (netHours <= 0) return 0;
  return Math.min(netHours, 8) * 1.5 + Math.max(netHours - 8, 0) * 2;
}
/** 가산 시간 → 일수(1일 = 8h), 소수 둘째 자리 */
export const compDaysFromHours = (netHours: number) => Math.round((creditHours(netHours) / 8) * 100) / 100;
/** 실제 출퇴근 간격에서 휴게(근무일정과 같은 규칙: 4.5h↑ 30분, 9h↑ 1시간)를 뺀 시간 */
export function netHoursOf(clockIn: Date, clockOut: Date): number {
  const span = (clockOut.getTime() - clockIn.getTime()) / 3600000;
  if (span <= 0) return 0;
  return Math.round((span - breakHours(span)) * 100) / 100;
}

export type GrantRunResult = { from: string; to: string; created: number; updated: number; revoked: number; names: string[] };

/** 기간 안의 근무 기록으로 자동 부여를 다시 계산한다. 기본은 오늘까지 최근 45일(매일 밤). 본부 화면 [점검]은 기간을 준다 */
export async function runLeaveGrants(range?: { from: Date; to: Date }, actor?: { userId: string; name: string }): Promise<GrantRunResult> {
  const to = range?.to ?? kstTodayDateUTC();
  const from = range?.from ?? new Date(to.getTime() - LOOKBACK_DAYS * 86400000);
  const designated = new Map(
    (await prisma.holiday.findMany({ where: { date: { gte: from, lte: to }, grantsLeave: true }, select: { date: true, name: true } }))
      .map((h) => [ymdUTC(h.date), h.name]),
  );
  const att = await prisma.attendance.findMany({
    where: { date: { gte: from, lte: to }, clockIn: { not: null }, clockOut: { not: null }, user: { deletedAt: null } },
    select: { userId: true, date: true, clockIn: true, clockOut: true, user: { select: { name: true } } },
  });
  // 부여해야 할 것 — key = userId|group|ymd
  type Want = { userId: string; group: GrantGroup; workDate: Date; days: number; note: string; name: string };
  const want = new Map<string, Want>();
  for (const a of att) {
    const ymd = ymdUTC(a.date);
    const dow = a.date.getUTCDay();
    if (ymd.slice(5) === WORKERS_DAY) {
      const h = netHoursOf(a.clockIn!, a.clockOut!);
      const days = compDaysFromHours(h);
      if (days > 0) want.set(`${a.userId}|보상휴가|${ymd}`, { userId: a.userId, group: "보상휴가", workDate: a.date, days, name: a.user.name,
        note: `${ymd} 근로자의 날 근무 ${fmt(h)}시간(휴게 제외) → 가산 ${fmt(creditHours(h))}시간 = ${fmt(days)}일` });
    } else if (designated.has(ymd) && dow >= 1 && dow <= 5) {
      want.set(`${a.userId}|대체휴일|${ymd}`, { userId: a.userId, group: "대체휴일", workDate: a.date, days: 1, name: a.user.name,
        note: `${ymd} ${designated.get(ymd)}(지정 공휴일) 근무 → 대체휴일 1일` });
    }
  }
  const existing = await prisma.leaveGrant.findMany({
    where: { source: "AUTO", workDate: { gte: from, lte: to } },
    select: { id: true, userId: true, group: true, workDate: true, days: true, note: true, user: { select: { name: true } } },
  });
  const byKey = new Map(existing.map((e) => [`${e.userId}|${e.group}|${ymdUTC(e.workDate!)}`, e]));
  let created = 0, updated = 0, revoked = 0;
  const names = new Set<string>();
  for (const [key, w] of want) {
    const ex = byKey.get(key);
    if (!ex) {
      await prisma.leaveGrant.create({ data: { userId: w.userId, group: w.group, days: w.days, workDate: w.workDate, source: "AUTO", note: w.note } });
      created++; names.add(w.name);
    } else if (ex.days !== w.days || ex.note !== w.note) {
      await prisma.leaveGrant.update({ where: { id: ex.id }, data: { days: w.days, note: w.note } });
      updated++; names.add(w.name);
    }
  }
  // 근무 기록이 없어졌거나(출퇴근 삭제·수정) 지정이 풀린 날의 자동 부여는 거둔다
  for (const [key, ex] of byKey) {
    if (want.has(key)) continue;
    await prisma.leaveGrant.delete({ where: { id: ex.id } });
    revoked++; names.add(ex.user.name);
  }
  const result: GrantRunResult = { from: ymdUTC(from), to: ymdUTC(to), created, updated, revoked, names: [...names] };
  if (created || updated || revoked) {
    await logAudit({
      actorId: actor?.userId ?? "cubetee-bot", actorName: actor?.name ?? "큐브티 봇", action: "LEAVE_GRANT_AUTO", targetType: "LeaveGrant",
      detail: `보상휴가·대체휴일 자동 부여 점검 ${result.from}~${result.to}: 부여 ${created}·갱신 ${updated}·회수 ${revoked} — ${[...names].slice(0, 10).join(", ")}${names.size > 10 ? ` 외 ${names.size - 10}명` : ""}`,
    });
  }
  return result;
}

export type GrantRow = {
  userId: string; empNo: number | null; name: string; branch: string | null; department: string | null;
  groups: Record<GrantGroup, { granted: number; used: number; remaining: number }>;
  grants: { id: string; group: string; days: number; workDate: string | null; source: string; note: string; createdAt: string }[];
  uses: { id: string; group: GrantGroup; label: string; startDate: string; endDate: string; days: number }[];
};

/** 기준일까지의 직원별 종류별 부여·사용·잔여(#50). 대상 직원 범위는 「직원별 잔여 현황」과 같은 규칙 */
export async function grantSummary(opts: { asOf: Date; includeAdmins: boolean; includeTest: boolean }): Promise<GrantRow[]> {
  const excluded = opts.includeTest ? [] : await excludedBranchNames();
  const users = await prisma.user.findMany({
    where: {
      isActive: true, deletedAt: null,
      ...(opts.includeAdmins ? {} : { role: { not: "ADMIN" as const } }),
      ...(excluded.length > 0
        ? { OR: [{ branch: null }, { branch: { notIn: excluded } }, ...(opts.includeAdmins ? [{ role: "ADMIN" as const }] : [])] }
        : {}),
    },
    select: { id: true, empNo: true, name: true, branch: true, department: true },
    orderBy: [{ branch: "asc" }, { name: "asc" }],
  });
  const ids = users.map((u) => u.id);
  const asOfEnd = new Date(opts.asOf.getTime() + 86400000);
  const [grants, uses] = await Promise.all([
    prisma.leaveGrant.findMany({
      // 자동 부여는 근무일, 수동 조정은 넣은 날(KST)로 기준일을 가른다
      where: { userId: { in: ids }, OR: [{ workDate: { lte: opts.asOf } }, { workDate: null, createdAt: { lt: new Date(asOfEnd.getTime() - 9 * 3600000) } }] },
      orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.leaveRequest.findMany({
      where: { userId: { in: ids }, status: "APPROVED", startDate: { lte: opts.asOf }, type: { in: [...GROUP_CODES["보상휴가"], ...GROUP_CODES["대체휴일"]] as never[] } },
      select: { id: true, userId: true, type: true, days: true, startDate: true, endDate: true },
      orderBy: { startDate: "asc" },
    }),
  ]);
  const rows = new Map<string, GrantRow>(users.map((u) => [u.id, {
    userId: u.id, empNo: u.empNo, name: u.name, branch: u.branch, department: u.department,
    groups: { "보상휴가": { granted: 0, used: 0, remaining: 0 }, "대체휴일": { granted: 0, used: 0, remaining: 0 } },
    grants: [], uses: [],
  }]));
  for (const g of grants) {
    const r = rows.get(g.userId); if (!r || !isGrantGroup(g.group)) continue;
    r.groups[g.group].granted += g.days;
    r.grants.push({ id: g.id, group: g.group, days: g.days, workDate: g.workDate ? ymdUTC(g.workDate) : null, source: g.source, note: g.note, createdAt: g.createdAt.toISOString() });
  }
  for (const u of uses) {
    const r = rows.get(u.userId); const group = groupOfType(u.type); if (!r || !group) continue;
    r.groups[group].used += u.days;
    r.uses.push({ id: u.id, group, label: leaveLabel(u.type), startDate: ymdUTC(u.startDate), endDate: ymdUTC(u.endDate), days: u.days });
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const r of rows.values()) for (const g of GRANT_GROUPS) {
    r.groups[g].granted = r2(r.groups[g].granted); r.groups[g].used = r2(r.groups[g].used);
    r.groups[g].remaining = r2(r.groups[g].granted - r.groups[g].used);
  }
  return [...rows.values()];
}

/** 본부 수동 조정(#50) — 음수는 차감. 사유 필수 */
export async function addManualGrant(input: { userId: string; group: GrantGroup; days: number; note: string }, actor: { userId: string; name: string }) {
  const user = await prisma.user.findFirst({ where: { id: input.userId, deletedAt: null }, select: { name: true } });
  if (!user) throw new Error("USER_NOT_FOUND");
  const row = await prisma.leaveGrant.create({ data: { userId: input.userId, group: input.group, days: input.days, source: "MANUAL", note: input.note, createdBy: actor.userId } });
  await logAudit({
    actorId: actor.userId, actorName: actor.name, action: "LEAVE_GRANT_MANUAL", targetType: "LeaveGrant", targetId: row.id, targetName: user.name,
    detail: `${user.name} ${input.group} ${input.days > 0 ? "+" : ""}${fmt(input.days)}일 — ${input.note}`,
  });
  return row;
}
