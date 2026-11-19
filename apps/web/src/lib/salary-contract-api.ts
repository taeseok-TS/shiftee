// 연봉 계약 읽기(직영 포털 급여 관리) — /api/v1/contracts/salary 의 계산부(2026-11-19 이예지 요청, 디렉터 「진행해」).
// DB 읽기만 한다. 라우트는 키 확인 · 입력 검사만 하고 여기로 넘긴다(시험 스크립트가 같은 함수를 부른다).
//
// ■ 대상 계약 — 포털 연봉 자동 전송(lib/portal-contract-push)과 같은 기준
//   · 큐브티에서 작성한 근로 · 고용 · 파트타임 · 연봉 계약서(제목). 확인서 · 동의서 · 신청서 · 서약서 · 합의서 · 통지서는 뺀다
//   · 시험 발송(isTest) · 모두싸인에서 옮겨 온 것(importBatch — 금액 칸이 없다) · 외부(미가입) 계약자 계약은 뺀다
//   · 금액 칸이 있는 것만 — 연봉 양식 「연봉」(연액) 또는 계약직 양식 「월급여액」(월액)
//   · 직원(EMPLOYEE) 계약만 — 원장(MANAGER) · 본부(ADMIN) 계약은 주지 않는다(이예지: 원장 연봉은 본부가 보지 않는다)
//   · 휴지통(deletedAt) · 테스트 계정 · 통계 제외 지점(본부 · 테스트지점)은 뺀다(다른 연동 API 와 같은 범위)
// ■ 금액 단위 — payUnit 으로 가른다(월 금액이 연봉 칸에 들어가 12분의 1 로 계산될 뻔한 사고 방지, 이예지 요청)
//   · payUnit "year"  → annualSalary(연액, 원) · monthlySalary null
//   · payUnit "month" → monthlySalary(월액, 원) · annualSalary null — 큐브티가 12 를 곱해 만들지 않는다
// ■ 같은 사람 · 같은 시작일로 다시 쓴 계약(금액 정정) — 큐브티는 옛 계약을 자동으로 취소하지 않는다(둘 다 「체결 완료」로 남는다).
//   그래서 체결 완료끼리 비교해 **나중에 체결된 것**이 옛것을 대신한다고 superseded · supersededBy 로 알려 준다.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { excludedBranchNames, testAccountWhere } from "@/lib/employee-scope";

const TARGET_TITLE = /근로\s*계약서|고용\s*계약서|파트\s*타임\s*계약서|연봉\s*계약서/;
const NOT_TARGET = /확인서|동의서|신청서|서약서|합의서|통지서/;
const CONTRACT_JOB = /계약직|파트\s*타임/;
export const SALARY_MAX_ROWS = 1000;

const STATUS: Record<string, string> = {
  DRAFT: "작성 중", SENT: "서명 대기", APPROVED: "서명 대기", SIGNED: "체결 완료", EXPIRED: "취소", REJECTED: "취소",
};

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);   // @db.Date 는 UTC 자정 저장
export function kstIso(d: Date | null): string | null {
  if (!d) return null;
  return `${new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 19)}+09:00`;
}
/** "34,000,000원" · "1,290,520" → 원 단위 정수. 범위 밖이면 null */
function won(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const digits = String(v).replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
/** "22.5" · "117.32" · "약 209 H" → 시간(숫자). 없으면 null */
function hours(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  // 「4시간 30분」처럼 손으로 고쳐 적은 값 → 4.5(첫 숫자만 읽으면 4 — 4차 검증)
  const hm = /(\d+)\s*시간\s*(\d+)\s*분/.exec(String(v));
  if (hm) { const n = Number(hm[1]) + Number(hm[2]) / 60; return n > 0 && n <= 400 ? Math.round(n * 100) / 100 : null; }
  const m = /\d+(?:\.\d+)?/.exec(String(v).replace(/,/g, ""));
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 && n <= 400 ? n : null;
}

export type SalaryAmount = { payUnit: "year" | "month"; annualSalary: number | null; monthlySalary: number | null };
/** 계약 입력값(extraFields)에서 금액 — 연봉 칸이 있으면 연액, 없고 월급여액이 있으면 월액. 둘 다 없으면 null(대상 아님) */
export function salaryAmountOf(extra: unknown): SalaryAmount | null {
  const e = (extra && typeof extra === "object" ? extra : {}) as Record<string, unknown>;
  const annual = won(e["연봉"], 1_000_000, 1_000_000_000);
  if (annual != null) return { payUnit: "year", annualSalary: annual, monthlySalary: null };
  const monthly = won(e["월급여액"], 10_000, 100_000_000);
  if (monthly != null) return { payUnit: "month", annualSalary: null, monthlySalary: monthly };
  return null;
}
export function isSalaryContractTitle(title: string): boolean {
  return TARGET_TITLE.test(title) && !NOT_TARGET.test(title);
}

export type SalaryContractRow = {
  id: string; docNo: string | null; title: string;
  empNo: number; emsId: string; name: string; branch: string | null; jobGroup: string | null;
  resignDate: string | null;        // 직원 관리 퇴사일(KST, 있으면) — 「지금 유효」 목록에도 퇴사한 달 급여 계산용으로 남긴다
  startDate: string | null; endDate: string | null;
  effectiveEndDate: string | null;  // 실제 적용 끝 — endDate 와 「그 사람의 다음 체결 계약 시작 전날」 중 이른 날. 둘 다 없으면 null
  payUnit: "year" | "month"; annualSalary: number | null; monthlySalary: number | null;
  employmentType: "정규직" | "계약직";
  weeklyHours: number | null; monthlyHours: number | null;
  dailyHours: number | null;        // 1일 소정근로시간 — 계약서 「일근무시간」(계약직 양식, 예 4.5). 단시간 연차수당 계산용(11/19 이예지 추가 요청)
  contractKind: string | null;      // 신규입사 · 재계약(양식에 있으면)
  status: string; statusCode: string;
  signedAt: string | null; updatedAt: string;
  superseded: boolean; supersededBy: string | null;
};

export type SalaryQuery =
  | { mode: "current"; today: string }          // 지금 유효(실제 적용 끝(effectiveEndDate)이 없거나 오늘 이후) — 상태 「취소」는 뺀다
  | { mode: "since"; since: Date }              // 이 시각 이후 체결됐거나 바뀐 계약(취소 포함)
  | { mode: "empNo"; empNo: number };           // 한 사람의 지난 계약까지 전부

const SELECT = {
  id: true, docNo: true, title: true, status: true, startDate: true, endDate: true, extraFields: true,
  signedAt: true, updatedAt: true, userId: true,
  user: { select: { empNo: true, name: true, branch: true, jobGroup: true, resignDate: true } },
} as const;
type Found = Prisma.ContractGetPayload<{ select: typeof SELECT }>;

async function baseWhere(): Promise<Prisma.ContractWhereInput> {
  const excluded = await excludedBranchNames();
  return {
    isTest: false, importBatch: null, externalName: null,
    OR: [{ title: { contains: "근로" } }, { title: { contains: "고용" } }, { title: { contains: "파트" } }, { title: { contains: "연봉" } }],
    user: {
      role: "EMPLOYEE", deletedAt: null, empNo: { not: null },
      NOT: await testAccountWhere(),
      ...(excluded.length ? { OR: [{ branch: null }, { branch: { notIn: excluded } }] } : {}),
    },
  };
}

/** 이어 받기 자리 — "<updatedAt ISO>|<id>" 를 base64url 로(포털은 그대로 다시 보낸다) */
export function encodeSalaryCursor(updatedAt: Date, id: string): string {
  return Buffer.from(`${updatedAt.toISOString()}|${id}`, "utf8").toString("base64url");
}
export function decodeSalaryCursor(v: string): { at: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(v, "base64url").toString("utf8").split("|");
    const at = new Date(iso);
    if (!id || !/^[a-z0-9]{10,40}$/i.test(id) || Number.isNaN(at.getTime())) return null;
    return { at, id };
  } catch { return null; }
}

/**
 * 계약 목록 — (updatedAt, id) 오름차순으로 SALARY_MAX_ROWS 건씩. 더 있으면 nextCursor(같은 질의에 cursor 로 다시 보낸다).
 * DB 에서는 제목 일부로만 거르고 금액 칸 · 정확한 제목은 코드에서 거르므로, DB 를 나눠 읽어 한 쪽을 채운다(앞에서 잘려 조용히 빠지지 않게 — 검증 2).
 * (updatedAt, id) 자리로 이어 받으므로 같은 시각에 많은 계약이 바뀌어도 제자리를 돌지 않는다.
 */
export async function salaryContracts(q: SalaryQuery, cursor?: { at: Date; id: string } | null): Promise<{ rows: SalaryContractRow[]; nextCursor: string | null }> {
  const base = await baseWhere();
  let where: Prisma.ContractWhereInput;
  if (q.mode === "current") {
    where = { AND: [base, { status: { notIn: ["EXPIRED", "REJECTED"] } }, { OR: [{ endDate: null }, { endDate: { gte: new Date(`${q.today}T00:00:00Z`) } }] }] };
  } else if (q.mode === "since") {
    where = { AND: [base, { OR: [{ updatedAt: { gte: q.since } }, { signedAt: { gte: q.since } }] }] };
  } else {
    where = { AND: [base, { user: { empNo: q.empNo } }] };
  }
  const page: Found[] = [];
  let pos = cursor ?? null;
  let more = false;
  for (let round = 0; round < 20; round++) {
    const after: Prisma.ContractWhereInput = pos ? { OR: [{ updatedAt: { gt: pos.at } }, { updatedAt: pos.at, id: { gt: pos.id } }] } : {};
    const batch: Found[] = await prisma.contract.findMany({ where: { AND: [where, after] }, select: SELECT, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 1000 });
    for (const c of batch) {
      if (isSalaryContractTitle(c.title) && salaryAmountOf(c.extraFields) != null && c.user?.empNo != null) {
        if (page.length >= SALARY_MAX_ROWS) { more = true; break; }
        page.push(c);
      }
      pos = { at: c.updatedAt, id: c.id };
    }
    if (more || batch.length < 1000) break;
    if (round === 19) more = true;   // 20,000 건을 읽고도 끝나지 않으면 여기까지 — 읽은 자리부터 이어 받는다
  }
  // 다음 자리 = 마지막으로 **처리한** 계약(넣었거나 걸러 낸 것). 넘친 계약은 처리 전이라 다음 쪽 첫 줄이 된다
  const nextPos = more ? pos : null;

  // 같은 사람의 체결 완료 계약 — ① 같은 시작일이면 나중에 체결된 것이 옛것을 대신한다(superseded)
  //   ② 그 사람의 다음 계약(시작일이 더 늦은 체결 완료) 시작 전날을 effectiveEndDate 로 준다 — 끝나는 날이 빈 옛 계약이 계속 남지 않게(검증 3)
  const userIds = [...new Set(page.map((c) => c.userId))];
  const signed = userIds.length
    ? await prisma.contract.findMany({
        where: { AND: [base, { userId: { in: userIds }, status: "SIGNED" }] },
        select: { id: true, title: true, userId: true, startDate: true, signedAt: true, extraFields: true },
      })
    : [];
  const latest = new Map<string, { id: string; at: number }>();
  const startsByUser = new Map<string, string[]>();
  for (const s of signed) {
    if (!isSalaryContractTitle(s.title) || !salaryAmountOf(s.extraFields) || !s.startDate) continue;
    const st = ymd(s.startDate)!;
    const k = `${s.userId}|${st}`;
    const at = s.signedAt?.getTime() ?? 0;
    const cur = latest.get(k);
    if (!cur || at > cur.at || (at === cur.at && s.id > cur.id)) latest.set(k, { id: s.id, at });
    const arr = startsByUser.get(s.userId) ?? [];
    if (!arr.includes(st)) arr.push(st);
    startsByUser.set(s.userId, arr);
  }
  const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);

  const rows = page.map((c): SalaryContractRow => {
    const e = (c.extraFields && typeof c.extraFields === "object" ? c.extraFields : {}) as Record<string, unknown>;
    const amt = salaryAmountOf(c.extraFields)!;
    const start = ymd(c.startDate), end = ymd(c.endDate);
    const win = c.status === "SIGNED" && start ? latest.get(`${c.userId}|${start}`) : undefined;
    const superseded = !!win && win.id !== c.id;
    const nextStart = start ? (startsByUser.get(c.userId) ?? []).filter((x) => x > start).sort()[0] : undefined;
    const cap = nextStart ? dayBefore(nextStart) : null;
    const effectiveEndDate = end && cap ? (end < cap ? end : cap) : (end ?? cap);
    return {
      id: c.id, docNo: c.docNo, title: c.title,
      empNo: c.user.empNo!, emsId: String(c.user.empNo).padStart(5, "0"), name: c.user.name, branch: c.user.branch, jobGroup: c.user.jobGroup,
      resignDate: c.user.resignDate ? kstIso(c.user.resignDate)!.slice(0, 10) : null,
      startDate: start, endDate: end, effectiveEndDate,
      ...amt,
      employmentType: amt.payUnit === "month" || CONTRACT_JOB.test(c.title) ? "계약직" : "정규직",
      weeklyHours: hours(e["주근무시간"]),
      monthlyHours: hours(e["월근로시간"]),
      dailyHours: hours(e["일근무시간"]),
      contractKind: typeof e["계약구분"] === "string" ? (e["계약구분"] as string) : null,
      status: STATUS[c.status] ?? c.status, statusCode: c.status,
      signedAt: kstIso(c.signedAt), updatedAt: kstIso(c.updatedAt)!,
      superseded, supersededBy: superseded ? win!.id : null,
    };
  });
  // 「지금 유효」는 실제 적용 끝(effectiveEndDate)까지 본다 — 끝나는 날이 빈 옛 계약이 재계약 시작 뒤에도 남지 않게(재검증 B)
  const out = q.mode === "current" ? rows.filter((r) => !r.effectiveEndDate || r.effectiveEndDate >= q.today) : rows;
  return { rows: out, nextCursor: nextPos ? encodeSalaryCursor(nextPos.at, nextPos.id) : null };
}
