import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { kstTodayMidnight } from "@/lib/resign";

// 인원 "숫자"를 셀 때 쓰는 공용 기준 — **모든 화면의 인원 숫자는 여기 한 곳에서 나온다**(2026-10-23 본부 요청 ■0-9 · ■3).
//
// 기준은 포털 인사카드(10/23 기준 전체 직원 115 = 지점 재직 112 + 휴직 3, 원장 18).
//   · 전체 직원 = 지점 재직 + 휴직          → headcount scope "all"
//   · 지점 직원 = 지점 재직(휴직 빼고)       → scope "staff"(기본 — 근태 · 일정 분모도 이것)
//   · 휴직      = 휴직 중(ON_LEAVE · 임시휴무 TEMPORARY)
//   · 원장      = 지점 원장
// 어느 숫자에도 넣지 않는 사람:
//   1) 관리자(서브 포함) — 전원 본부 소속(본사발령)
//   2) 지점 관리에서 "통계 포함"을 끈 지점 소속(본부 · 테스트지점) · 소속 지점이 없는 사람
//   3) 퇴사자 · 퇴사일이 지난 사람(퇴사일 당일까지는 재직 — lib/resign isResigned 와 같은 규칙) · 입사 예정자(입사일이 기준일보다 뒤)
//   4) 테스트 계정(아래 testAccountWhere — DB 표 변경 없이 규칙 + AppSetting 목록)
//
// 주의: 이건 카운트용이다. 연차 부여·결재선·봇 축하처럼 그 사람을 대상으로 하는
// 기능에는 쓰지 말 것(빼면 관리자 본인 연차가 사라진다).

/** 지점 관리에서 "통계 포함"이 꺼진 지점명 목록 */
export async function excludedBranchNames(): Promise<string[]> {
  const rows = await prisma.branch.findMany({
    where: { countInStats: false },
    select: { name: true },
  });
  return rows.map((b) => b.name);
}

// ─── 테스트 계정 ─────────────────────────────────────────────────────────────
// 스키마를 바꾸지 않는다. 기본 규칙 + AppSetting `testAccounts`(JSON 배열 또는 쉼표 구분 — 계정 id 나 이메일).
//   · test5555@cubetee.co.kr(직원 검증용) · review@cubetee.co.kr(앱 심사용) · kim@cubetee.co.kr(원장 검증용, 이예지 10/23 답)
//   · 이메일 끝이 쉼표인 계정(김정인 06705 — 「….co,」로 들어간 테스트 계정, 오픈 뒤 본부가 지울 예정)
//   · 이름 「김가산」(테스트지점 · 본부 두 계정)
// 테스트지점 소속은 위 2)로 이미 빠진다.
export const TEST_ACCOUNTS_KEY = "testAccounts";
const DEFAULT_TEST_EMAILS = ["test5555@cubetee.co.kr", "review@cubetee.co.kr", "kim@cubetee.co.kr"];
const DEFAULT_TEST_NAMES = ["김가산"];
const TEST_TTL_MS = 60_000;
let testCache: { at: number; ids: string[]; emails: string[] } | null = null;

async function testAccountSetting(): Promise<{ ids: string[]; emails: string[] }> {
  if (testCache && Date.now() - testCache.at < TEST_TTL_MS) return testCache;
  let list: string[] = [];
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: TEST_ACCOUNTS_KEY } });
    const v = row?.value?.trim();
    if (v) {
      let parsed: unknown;
      try { parsed = JSON.parse(v); } catch { parsed = v.split(","); }
      list = (Array.isArray(parsed) ? parsed : [parsed]).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
    }
  } catch (e) {
    console.error("[employee-scope] 테스트 계정 설정 읽기 실패(기본 규칙만 사용):", e instanceof Error ? e.message : e);
  }
  const emails = list.filter((x) => x.includes("@")).map((x) => x.toLowerCase());
  const ids = list.filter((x) => !x.includes("@"));
  testCache = { at: Date.now(), ids, emails };
  return testCache;
}

/** 테스트 계정에 맞는 User where(이것에 **맞는** 사람이 테스트 계정) */
export async function testAccountWhere(): Promise<Prisma.UserWhereInput> {
  const s = await testAccountSetting();
  const emails = [...new Set([...DEFAULT_TEST_EMAILS, ...s.emails])];
  return {
    OR: [
      ...emails.map((e) => ({ email: { equals: e, mode: "insensitive" as const } })),
      { email: { endsWith: "," } },
      { name: { in: DEFAULT_TEST_NAMES } },
      ...(s.ids.length ? [{ id: { in: s.ids } }] : []),
    ],
  };
}

/** 이 사람들 중 테스트 계정 id — 화면에 「테스트 계정」 표시를 붙일 때 */
export async function testAccountIds(userIds?: string[]): Promise<Set<string>> {
  const rows = await prisma.user.findMany({
    where: { AND: [await testAccountWhere(), ...(userIds ? [{ id: { in: userIds } }] : [])] },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

// ─── 결재함 · 명단 화면의 테스트 계정(2026-10-23 이예지 답 — 검증 G) ─────────────────────
// 숫자(직원 수 · 근태 숫자 · 통계)에서는 늘 뺀다(countableEmployeeWhere). 결재함 · 명단 · 기록 화면은 기본으로 빼되
//  · 관리자가 「테스트 포함」(?includeTest=1)을 켜거나, 명단 화면에서 테스트지점(통계 제외 지점)만 고르면 보인다 — 라이브 검증용
//  · 보는 사람이 테스트 계정이면(원장 검증 계정 kim@ 등) 테스트 계정 요청도 보인다 — 테스트 직원 요청을 테스트 원장이 결재해 볼 수 있게
const isOn = (v: string | null | undefined) => v === "1" || v === "true";

/** 이 사람이 테스트 계정인가 */
export async function isTestAccount(userId: string): Promise<boolean> {
  return (await testAccountIds([userId])).has(userId);
}

/**
 * 결재함 목록 · 숫자에서 테스트 계정 요청을 뺄 User where — 빼지 않을 때는 null.
 * includeTest 는 관리자만 쓸 수 있다(원장 · 직원이 넣어도 무시).
 */
export async function testRequesterExclusion(
  session: { userId: string; role: string },
  includeTest?: string | null,
): Promise<Prisma.UserWhereInput | null> {
  if (session.role === "ADMIN" && isOn(includeTest)) return null;
  if (await isTestAccount(session.userId)) return null;
  return { NOT: await testAccountWhere() };
}

/**
 * 명단 · 기록 화면(출퇴근 보드 등)에 테스트 계정을 보일까 — 숫자 칸에는 쓰지 말 것.
 *  · ?includeTest=1(관리자) · 고른 지점이 모두 통계 제외 지점(테스트지점) · 보는 사람이 테스트 계정
 */
export async function showTestRows(
  session: { userId: string; role: string },
  opts: { includeTest?: string | null; branches?: string[] | null },
): Promise<boolean> {
  if (session.role === "ADMIN" && isOn(opts.includeTest)) return true;
  if (opts.branches?.length) {
    const excluded = new Set(await excludedBranchNames());
    if (opts.branches.every((b) => excluded.has(b))) return true;
  }
  return isTestAccount(session.userId);
}

type Options = {
  /** 화면의 "관리자 포함" 체크박스가 켜졌을 때만 true — 관리자는 소속 지점과 무관하게 넣는다 */
  includeAdmins?: boolean;
  /** 원장 담당 지점 등으로 범위를 좁힐 때 (getManagerBranches 결과) */
  branches?: string[];
  /** "staff"(기본) = 지점 재직(휴직 빼고) · "all" = 재직 + 휴직 · "onLeave" = 휴직만 */
  scope?: "staff" | "all" | "onLeave";
  /** 퇴사일 기준일 — 이 날 이전에 퇴사한 사람은 뺀다(기본: 오늘 KST). 지난 달 현황 · 최근 7일 누락 등 */
  activeOn?: Date;
  /** 입사일 기준일 — 입사일이 이 날보다 뒤인 사람(입사 예정자)은 뺀다(기본: 오늘 KST, 10/23 검증 H). 입사일 미입력은 넣는다 */
  hiredBy?: Date;
};

const ON_LEAVE_STATES = ["ON_LEAVE", "TEMPORARY"] as const;

/**
 * 집계 대상 직원의 prisma where.
 * 지점을 지정하면 그 안에서도 통계 제외 지점은 다시 걸러진다.
 * 모양: 평평한 객체(role · isActive · deletedAt · employmentStatus · branch(또는 OR) · NOT · AND[퇴사일]) —
 *   기존 호출처 중 `{ ...where, AND: [...] }` 로 퇴사일 조건만 바꿔 끼우는 곳이 있어(관리자 대시보드 최근 7일 누락) 퇴사일은 AND 에만 둔다.
 *   AND 의 두 번째 = 입사일(입사 예정자 빼기). AND 를 바꿔 끼우는 곳은 hiredOnlyAnd(where) 로 입사일 조건을 함께 넣는다.
 */
export async function countableEmployeeWhere(opts: Options = {}) {
  const [excluded, tests] = await Promise.all([excludedBranchNames(), testAccountWhere()]);
  const scope = opts.scope ?? "staff";
  const activeOn = opts.activeOn ?? kstTodayMidnight();
  const hiredBy = opts.hiredBy ?? kstTodayMidnight();

  const branchRule: Prisma.UserWhereInput = opts.branches
    ? { branch: { in: opts.branches.filter((b) => !excluded.includes(b)) } }
    : { branch: excluded.length ? { not: null, notIn: excluded } : { not: null } };

  const employmentStatus = scope === "staff"
    ? ("ACTIVE" as const)
    : scope === "onLeave"
      ? { in: [...ON_LEAVE_STATES] }
      : { in: ["ACTIVE" as const, ...ON_LEAVE_STATES] };

  return {
    ...(opts.includeAdmins
      ? { OR: [{ role: "ADMIN" as const }, branchRule] }
      : { role: { not: "ADMIN" as const }, ...branchRule }),
    isActive: true,
    deletedAt: null,
    employmentStatus,
    NOT: tests,
    AND: [
      { OR: [{ resignDate: null }, { resignDate: { gte: activeOn } }] },
      { OR: [{ hireDate: null }, { hireDate: { lte: hiredBy } }] },
    ],
  } satisfies Prisma.UserWhereInput;
}

/** countableEmployeeWhere 의 AND 에서 퇴사일(첫 칸)을 뺀 나머지(입사일 조건) — AND 를 바꿔 끼울 때 함께 넣는다 */
export function hiredOnlyAnd(where: { AND: Prisma.UserWhereInput[] }): Prisma.UserWhereInput[] {
  return where.AND.slice(1);
}

// ─── 인원 요약(화면 숫자 칸) ──────────────────────────────────────────────────
/** 숫자 옆에 적을 「무엇을 셌는지」 — 화면마다 같은 말 */
export const HEADCOUNT_BASIS = {
  total: "지점 재직 + 휴직",
  staff: "지점 재직 · 휴직 빼고",
  onLeave: "휴직 중",
  managers: "지점 원장(직급 원장)",
  excluded: "본부 · 퇴사자 · 테스트 계정 · 테스트지점은 세지 않음",
} as const;

export type HeadcountBranch = { branch: string; total: number; staff: number; onLeave: number; managers: number };
export type Headcount = {
  total: number;      // 전체 직원 = 지점 재직 + 휴직
  staff: number;      // 지점 직원 = 재직(휴직 빼고)
  onLeave: number;    // 휴직
  managers: number;   // 원장
  branchCount: number; // 인원을 세는 지점 수(통계 포함 · 운영 중)
  byBranch: HeadcountBranch[];
  basis: typeof HEADCOUNT_BASIS;
};

/**
 * 원장 판정 — 포털 인사카드 「직급 원장」(요청서 기준, 10/23 검증 H). 역할(role)은 보지 않는다 — 역할 MANAGER 는 결재 · 메뉴 권한이라
 * 직급과 다를 수 있다(종전 「역할 MANAGER 또는 직군 원장」이라 화면마다 17 / 18명으로 갈렸다).
 * ⚠ 큐브티는 인사명부 연동 때 원장의 직급(position)을 **비워 두고** 직군(jobGroup)에 「원장」을 넣는다(lib/portal-roster mapPosition ·
 *   mapJobGroup). 그래서 직급 「원장」 · 「대표원장」 또는 직군 「원장」이면 원장이다.
 * 인원 숫자를 내는 모든 곳(headcount · 인사 › 현황 · 대시보드)은 이 함수만 쓴다.
 */
export const MANAGER_POSITIONS: readonly string[] = ["원장", "대표원장"];
export const isManagerRow = (u: { position: string | null; jobGroup: string | null }) =>
  MANAGER_POSITIONS.includes((u.position ?? "").trim()) || (u.jobGroup ?? "").trim() === "원장";

/** 인원 요약 — 대시보드 · 인사 › 직원 · 인사 › 현황 · 원장 화면이 같은 숫자를 쓴다 */
export async function headcountSummary(opts: { branches?: string[]; activeOn?: Date } = {}): Promise<Headcount> {
  const where = await countableEmployeeWhere({ scope: "all", branches: opts.branches, activeOn: opts.activeOn });
  const [rows, branchRows] = await Promise.all([
    prisma.user.findMany({ where, select: { branch: true, position: true, jobGroup: true, employmentStatus: true } }),
    prisma.branch.findMany({ where: { countInStats: true, isActive: true }, select: { name: true } }),
  ]);
  const map = new Map<string, HeadcountBranch>();
  let staff = 0, onLeave = 0, managers = 0;
  for (const u of rows) {
    const b = u.branch || "(지점 미지정)";
    const r = map.get(b) ?? { branch: b, total: 0, staff: 0, onLeave: 0, managers: 0 };
    r.total++;
    if (u.employmentStatus === "ACTIVE") { r.staff++; staff++; } else { r.onLeave++; onLeave++; }
    if (isManagerRow(u)) { r.managers++; managers++; }
    map.set(b, r);
  }
  const visibleBranches = opts.branches ? branchRows.filter((b) => opts.branches!.includes(b.name)) : branchRows;
  return {
    total: rows.length,
    staff,
    onLeave,
    managers,
    branchCount: visibleBranches.length,
    byBranch: [...map.values()].sort((a, b) => b.staff - a.staff || a.branch.localeCompare(b.branch, "ko")),
    basis: HEADCOUNT_BASIS,
  };
}
