import { prisma } from "@/lib/db";
import { kstTodayMidnight } from "@/lib/resign";
import { branchHasApprover } from "@/lib/approval-delegate";
import { branchHasOtherManager, getManagerBranches, branchMainManager } from "@/lib/manager-branches";
import { parseRules, rowSteps, defaultRules, type ApprovalRules, type RuleStep, type RequestKind } from "@/lib/approval-rules-core";

// ─── 결재 규칙 — 서버(2026-10-15 QA76 #16) ─────────────────────────────────────────────────
// 표·검사는 lib/approval-rules-core.ts(순수). 여기서는 저장값을 읽고(60초 캐시) 신청 한 건의 결재선을 만든다.
// 휴가 신청·휴가 취소(lib/leave-policy) · 근무일정 신청(api/schedule-requests) · 출퇴근 요청(lib/attendance-request)이 이 파일만 부른다.
// 결재선은 **신청할 때** 만들어 저장한다 — 규칙을 바꿔도 이미 대기 중인 건은 그대로(디렉터 결정 10/15).

export const APPROVAL_RULES_KEY = "approvalRules";
export type PolicyStep = { approverRole: string; branch: string | null; approverId?: string };

const TTL_MS = 60 * 1000;
let cache: { at: number; value: ApprovalRules } | null = null;
let inflight: Promise<ApprovalRules> | null = null;
let generation = 0;

/** 지금 규칙(60초 캐시). 읽기 실패면 직전 값, 그것도 없으면 기본값(= 종전 결재선) */
export async function readApprovalRules(): Promise<ApprovalRules> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  if (inflight) return inflight;
  const gen = generation;
  inflight = (async () => {
    try {
      const row = await prisma.appSetting.findUnique({ where: { key: APPROVAL_RULES_KEY } });
      const value = parseRules(row?.value);
      if (gen === generation) cache = { at: Date.now(), value };
      return value;
    } catch (e) {
      console.error("[approval-rules] 규칙 읽기 실패(직전 값·기본값 사용):", e instanceof Error ? e.message : e);
      const value = cache?.value ?? defaultRules();
      if (gen === generation) cache = { at: Date.now() - TTL_MS + 10_000, value };
      return value;
    } finally { inflight = null; }
  })();
  return inflight;
}

/** 저장 — rev 가 다르면(그 사이 다른 관리자가 저장) 덮지 않고 false */
export async function saveApprovalRules(next: ApprovalRules, expectedRev: number): Promise<{ ok: true; rules: ApprovalRules } | { ok: false; current: ApprovalRules }> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('approvalRules'))`;   // 동시 저장을 한 줄로 세운다(검증 F)
    const row = await tx.appSetting.findUnique({ where: { key: APPROVAL_RULES_KEY } });
    const cur = parseRules(row?.value);
    if (cur.rev !== expectedRev) return { ok: false as const, current: cur };
    const saved: ApprovalRules = { ...next, v: 1, rev: cur.rev + 1 };
    const value = JSON.stringify(saved);
    await tx.appSetting.upsert({ where: { key: APPROVAL_RULES_KEY }, create: { key: APPROVAL_RULES_KEY, value }, update: { value } });
    return { ok: true as const, rules: saved };
  });
  generation += 1; cache = null;   // 즉시 반영(같은 프로세스). 운영은 컨테이너 1개
  return result;
}

type Submitter = { id: string; role: string; branch: string | null };

/** 원장 신청의 「같은 지점 메인 원장」 단계 — 종전 근무일정 규칙 그대로(9/9 디렉터 지시) */
async function peerManagerStep(me: Submitter): Promise<PolicyStep | null> {
  if (!me.branch) return null;
  const mine = await getManagerBranches(me.id);
  if (mine.length > 1) return null;                     // 겸직 원장은 원장끼리 먼저 받지 않는다
  const main = await branchMainManager(me.branch);
  if (main) return main.id !== me.id ? { approverRole: "MANAGER", branch: me.branch, approverId: main.id } : null;
  return (await branchHasOtherManager(me.branch, me.id)) ? { approverRole: "MANAGER", branch: me.branch } : null;
}

/** 규칙 단계 → 실제 결재 단계. 쓸 수 없는 단계(원장 공석·본인·퇴사)는 건너뛴다 */
async function expand(steps: RuleStep[], me: Submitter): Promise<PolicyStep[]> {
  const out: PolicyStep[] = [];
  const people = await prisma.user.findMany({
    where: {
      id: { in: steps.filter((s) => s.type === "USER" && s.userId).map((s) => s.userId!) }, isActive: true, deletedAt: null, role: { in: ["ADMIN", "MANAGER"] },
      OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }],   // 퇴사일이 지난 사람은 건너뛴다(퇴사일 당일까지 재직, 검증 D)
    },
    select: { id: true, role: true },
  });
  const roleOf = new Map(people.map((p) => [p.id, p.role]));
  for (const s of steps) {
    let st: PolicyStep | null = null;
    if (s.type === "HQ") st = { approverRole: "ADMIN", branch: null };
    else if (s.type === "BRANCH_MANAGER") {
      // 원장이 신청하면 「지점 원장」은 자기 자신이다 — 같은 지점 메인 원장 규칙으로 읽는다
      if (me.role === "MANAGER") st = await peerManagerStep(me);
      else if (me.branch && (await branchHasApprover(me.branch, me.id))) st = { approverRole: "MANAGER", branch: me.branch };
    } else if (s.type === "PEER_MANAGER") {
      st = me.role === "MANAGER" ? await peerManagerStep(me) : (me.branch && (await branchHasApprover(me.branch, me.id)) ? { approverRole: "MANAGER", branch: me.branch } : null);
    } else if (s.type === "USER" && s.userId && s.userId !== me.id) {
      const role = roleOf.get(s.userId);
      if (role === "ADMIN") st = { approverRole: "ADMIN", branch: null, approverId: s.userId };
      // 지정 원장은 branch 없이 — 지점이 있으면 그 지점 원장대행도 결재할 수 있게 된다(isMyStep 대행 규칙). 고른 사람만 결재(검증 A)
      else if (role === "MANAGER") st = { approverRole: "MANAGER", branch: null, approverId: s.userId };
    }
    if (!st) continue;
    const prev = out[out.length - 1];
    if (prev && prev.approverRole === st.approverRole && prev.branch === st.branch && (prev.approverId ?? null) === (st.approverId ?? null)) continue;
    if (st.approverId && out.some((x) => x.approverId === st!.approverId)) continue;   // 같은 지정 결재자를 두 번 넣지 않는다(검증 J)
    out.push(st);
  }
  // 아무도 남지 않으면 본부. 원장 신청은 본부 결재가 꼭 있어야 한다(디렉터 지시 — 원장끼리만으로 끝나지 않게)
  if (!out.length) out.push({ approverRole: "ADMIN", branch: null });
  if (me.role === "MANAGER" && !out.some((s) => s.approverRole === "ADMIN")) out.push({ approverRole: "ADMIN", branch: null });
  return out;
}

/** 관리자 본인 신청 — 다른 관리자 1명, 없으면 자동 승인(빈 결재선). 표 밖, 종전 그대로 */
async function adminSelfSteps(userId: string): Promise<PolicyStep[]> {
  const others = await prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { not: userId } } });
  return others > 0 ? [{ approverRole: "ADMIN", branch: null }] : [];
}

/**
 * 휴가·근무일정 신청 한 건의 결재선. 예외(직원 > 지점) → 규칙 표 순서로 고른다.
 * holiday: 근무일정에 주말·공휴일 날짜가 들어 있는지(휴일근무)
 */
export async function resolveRequestSteps(opts: { kind: "LEAVE" | "SCHEDULE"; userId: string; holiday?: boolean }): Promise<PolicyStep[]> {
  const u = await prisma.user.findUnique({ where: { id: opts.userId }, select: { id: true, role: true, branch: true } });
  if (!u) return [{ approverRole: "ADMIN", branch: null }];
  if (u.role === "ADMIN") return adminSelfSteps(u.id);
  const rules = await readApprovalRules();
  const ex = rules.exceptions.find((x) => x.targetType === "USER" && x.userId === u.id && x.kinds.includes(opts.kind))
    // 지점 예외는 그 지점 **직원**에게만 — 원장은 직원 한 명 예외로 따로 둔다(검증 E: 원장 휴가가 원장끼리 결재로 늘지 않게)
    ?? (u.branch && u.role !== "MANAGER" ? rules.exceptions.find((x) => x.targetType === "BRANCH" && x.branch === u.branch && x.kinds.includes(opts.kind)) : undefined);
  if (ex) return expand(ex.steps, u);
  const key = opts.kind === "LEAVE"
    ? (u.role === "MANAGER" ? "LEAVE.MANAGER" : "LEAVE.EMPLOYEE")
    : (u.role === "MANAGER" ? "SCHEDULE.MANAGER" : opts.holiday ? "SCHEDULE.EMPLOYEE.HOLIDAY" : "SCHEDULE.EMPLOYEE.WEEKDAY");
  return expand(rowSteps(rules, key), u);
}

const ATT_ROW: Record<string, string> = {
  OUTSIDE: "ATT_OUTSIDE.EMPLOYEE", PHOTO: "ATT_PHOTO.EMPLOYEE", CORRECTION: "ATT_CORRECTION.EMPLOYEE", MISSED_OUT: "ATT_MISSED_OUT.EMPLOYEE",
};

/** 출퇴근 요청의 결재자(한 단계). 본부 처리·기기 변경·원장 본인·관리자·지점 없는 사람은 본부 */
export async function resolveAttendanceStep(user: Submitter, kind: string): Promise<{ approverRole: string; branch: string | null }> {
  const hq = { approverRole: "ADMIN", branch: user.branch };
  if (kind === "HQ" || kind === "DEVICE") return hq;
  if (user.role === "MANAGER" || user.role === "ADMIN" || !user.branch) return hq;
  const key = ATT_ROW[kind];
  if (!key) return hq;
  const step = rowSteps(await readApprovalRules(), key)[0];
  if (step?.type !== "BRANCH_MANAGER") return hq;
  // 신청자 본인은 빼고 센다 — 유일한 대행자가 자기 요청을 내면 처리할 원장이 없다
  return (await branchHasApprover(user.branch, user.id)) ? { approverRole: "MANAGER", branch: user.branch } : hq;
}

/** 신청 화면 미리보기 — 실제 결재선을 사람이 읽는 줄로(이름은 지정 결재자만) */
export async function previewRequestSteps(opts: { kind: "LEAVE" | "SCHEDULE"; userId: string; holiday?: boolean }): Promise<{ label: string; sub: string }[]> {
  const steps = await resolveRequestSteps(opts);
  if (!steps.length) return [{ label: "자동 승인", sub: "결재할 다른 관리자가 없습니다" }];
  const me = await prisma.user.findUnique({ where: { id: opts.userId }, select: { role: true } });
  const ids = steps.map((s) => s.approverId).filter((x): x is string => !!x);
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return steps.map((s) => s.approverId
    ? { label: names.get(s.approverId) ?? "지정 결재자", sub: s.approverRole === "ADMIN" ? "본부 · 지정 결재자" : "원장 · 지정 결재자" }
    : s.approverRole === "ADMIN" ? { label: "관리자", sub: "본부 관리자 누구나" } : me?.role === "MANAGER" ? { label: "같은 지점 원장", sub: "같은 지점의 다른 원장" } : { label: "소속 지점 원장", sub: "원장이 없으면 원장대행, 그것도 없으면 관리자" });
}

/** 지점 이름 변경 — 지점 예외의 지점명도 따라간다(검증 C). branches PATCH 가 부른다. 실패해도 지점 변경은 막지 않는다 */
export async function renameBranchInRules(from: string, to: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('approvalRules'))`;
    const row = await tx.appSetting.findUnique({ where: { key: APPROVAL_RULES_KEY } });
    if (!row) return;
    const cur = parseRules(row.value);
    if (!cur.exceptions.some((x) => x.targetType === "BRANCH" && x.branch === from)) return;
    const next: ApprovalRules = { ...cur, rev: cur.rev + 1, exceptions: cur.exceptions.map((x) => (x.targetType === "BRANCH" && x.branch === from ? { ...x, branch: to } : x)) };
    await tx.appSetting.update({ where: { key: APPROVAL_RULES_KEY }, data: { value: JSON.stringify(next) } });
  });
  generation += 1; cache = null;
}

export type { RequestKind };
