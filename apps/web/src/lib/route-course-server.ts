import { prisma } from "@/lib/db";
import { DEFAULT_COHORTS, ROUTE_COURSE_KEY, parseCohorts, type Cohort } from "@/lib/route-course";
import { portalAssignDates } from "@/lib/portal-hr-contact";

// 루트코스 교육 중인 신입(서버 전용, 2026-10-27 이예지 ②) — 신입 매니저는 입사일(= 입과일)부터 **수료일까지 본사 교육** 중이라
// 지점 근무일정 · 출퇴근 · 미출근 집계에 넣지 않는다. 지점 발령일 = 수료일 다음 날부터 센다(김수진 213기 10/12 입과 → 10/29 수료 → 10/30 부터).
// 일정표는 「루트코스 일정」 화면(AppSetting routeCourse.schedule)과 같은 것 하나를 쓴다 — 발령일 칸을 따로 두지 않는다.
// 입사일이 일정표의 입과일과 같은 사람만 교육생으로 본다(일정표에 없는 입사일은 그대로 지점 근무로 센다).

const TTL_MS = 60_000;
let cache: { at: number; cohorts: Cohort[] } | null = null;

export async function loadCohorts(): Promise<Cohort[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.cohorts;
  let cohorts = DEFAULT_COHORTS;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: ROUTE_COURSE_KEY } });
    if (row) {
      const parsed = parseCohorts(row.value);
      if (parsed.length) cohorts = parsed;
    }
  } catch (e) {
    console.error("[route-course] 일정표 읽기 실패(기본 일정 사용):", e instanceof Error ? e.message : e);
  }
  cache = { at: Date.now(), cohorts };
  return cohorts;
}

// 입사일은 UTC 자정으로 저장되지만 시각이 붙어 들어온 값(…T00:00+09:00 = 15:00Z)도 있을 수 있어 KST 로 자른다(lib/leave-accrual kstDate 와 같은 규칙)
const ymdOf = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 입사일(= 입과일)이 일정표에 있으면 그 기수의 수료일(YYYY-MM-DD), 없으면 null */
export function trainingEndOf(hireDate: Date | null | undefined, cohorts: Cohort[]): string | null {
  if (!hireDate) return null;
  const start = ymdOf(hireDate);
  return cohorts.find((c) => c.start === start)?.end ?? null;
}

/** 그날(YYYY-MM-DD) 루트코스 교육 중인가 — 입과일 ≤ 그날 ≤ 수료일 */
export function isTrainingOn(hireDate: Date | null | undefined, dayYmd: string, cohorts: Cohort[]): boolean {
  const end = trainingEndOf(hireDate, cohorts);
  if (!end || !hireDate) return false;
  return ymdOf(hireDate) <= dayYmd && dayYmd <= end;
}

/**
 * userIds 중 그날 아직 지점 근무 전(교육 중)인 사람 id.
 *  1) 포털 인사카드 「지점 발령일」(branch_assign_date, 2026-10-28 이예지)이 있으면 그 날짜 **전**까지 제외 — 입사일 조정 · 발령 지연과 상관없이 맞다
 *  2) 없으면 입사일 = 루트코스 입과일인 사람만 수료일까지(종전 규칙)
 */
export async function trainingUserIds(userIds: string[], dayYmd: string): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const [cohorts, users] = await Promise.all([
    loadCohorts(),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, branch: true, hireDate: true } }),
  ]);
  // 발령일은 입사 120일 안인 사람만 물어본다(포털 호출 · 비교 범위를 줄인다 — 오래된 직원은 어차피 발령이 지났다. 발령 지연까지 넉넉히)
  const recent = users.filter((u) => u.hireDate && dayYmd <= new Date(u.hireDate.getTime() + 120 * 86400_000 + 9 * 3600_000).toISOString().slice(0, 10));
  // 포털이 느리거나 죽어 있으면 집계가 기다리지 않는다 — 2초 안에 안 오면 종전 규칙(입과일 → 수료일)으로. 응답은 10분 기억이라 보통 즉시 온다
  const assign = recent.length
    ? await Promise.race([
        portalAssignDates(recent).catch(() => new Map<string, string>()),
        new Promise<Map<string, string>>((r) => setTimeout(() => r(new Map()), 2000)),
      ])
    : new Map<string, string>();
  const out = new Set<string>();
  for (const u of users) {
    const a = assign.get(u.id);
    if (a) { if (dayYmd < a) out.add(u.id); continue; }
    if (isTrainingOn(u.hireDate, dayYmd, cohorts)) out.add(u.id);
  }
  return out;
}
