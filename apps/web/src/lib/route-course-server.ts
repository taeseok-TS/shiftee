import { prisma } from "@/lib/db";
import { DEFAULT_COHORTS, ROUTE_COURSE_KEY, parseCohorts, type Cohort } from "@/lib/route-course";

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

/** userIds 중 그날 교육 중인 사람 id */
export async function trainingUserIds(userIds: string[], dayYmd: string): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const [cohorts, users] = await Promise.all([
    loadCohorts(),
    prisma.user.findMany({ where: { id: { in: userIds }, hireDate: { not: null } }, select: { id: true, hireDate: true } }),
  ]);
  return new Set(users.filter((u) => isTrainingOn(u.hireDate, dayYmd, cohorts)).map((u) => u.id));
}
