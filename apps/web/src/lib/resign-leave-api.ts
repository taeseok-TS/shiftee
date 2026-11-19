// 퇴사자 잔여연차 읽기(직영 포털 급여 관리 — 퇴사 달 연차수당) — /api/v1/leave/balance 의 계산부(2026-11-19 이예지 요청, 디렉터 「진행해」).
// DB 읽기만 한다. 라우트는 키 확인 · 입력 검사만 하고 여기로 넘긴다(시험 스크립트가 같은 함수를 부른다).
//
// ■ 대상 — 기간(leaveFrom~leaveTo) 안에 퇴사일이 든 사람. 퇴사일은 두 곳에서 찾는다
//   ① 직원 관리의 퇴사일(User.resignDate — 본부 「연차 정산」 퇴사자 탭과 같은 기준)
//   ② 아직 ①이 비어 있어도 퇴사 서류(사직원 · 연차수당 정산 신청서)의 「퇴사일자」 — 퇴사 예정자를 그달 급여 작성 때 미리 보게(이예지 요청)
//   둘 다 있으면 ①을 쓰고, 서류 날짜가 다르면 notes 로 알린다. 범위는 다른 연동 API 와 같다(본부 · 휴지통 · 테스트 · 통계 제외 지점 제외).
// ■ 계산값(calculated) — 본부 「연차 정산」 퇴사자 탭과 **같은 함수**(lib/leave-settlement-server · resignedCalc)
//   · annual.granted = 입사일 기준 총 발생(퇴사일까지) − 회계 기준 전년도까지 누적 발생 = 퇴사 연도에 쓸 수 있던 일수
//   · annual.used = 퇴사 연도 사용(퇴사일까지 시작한 승인 연차 차감 휴가, 반차 0.5 · 반반차 0.25)
//   · annual.remaining = granted − used(초과 사용이면 음수 그대로)
//   · substituteRemaining(대체휴일) · compensatoryRemaining(보상휴가 — 근로자의 날 보상 등) = 부여 합 − 승인 사용 합, 연차와 **따로** 센다
//   · asOf = 퇴사일
// ■ 퇴사 서류 값(document) — 서류에 사람이 적은 「미소진연차일수」 · 「연차사용일수」 그대로. 정인 님이 연차 · 대체휴일 · 보상휴가를 합쳐 적는 경우가
//   있다(11/18 김승영 11.5 = 연차 5 + 대체 6 + 보상 0.5). 그래서 계산값과 맞춰 보고 documentIncludes 로 무엇을 합친 값인지 알려 준다.
// ■ 정산 일수(settlementDays) — 서명 완료된 서류 값이 있으면 그것(직원이 서명한 값이 정산 기준), 서류가 연차만 적었으면 대체 · 보상 잔여를 더한다.
//   서류가 없거나 아직 서명 전이면 계산값 합계(연차 + 대체 + 보상). settlementSource 로 어느 쪽인지 알린다. 대체휴일은 연차 1일과 같이 정산(이예지).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { kstDate } from "@/lib/leave-accrual";
import { resignedCalc } from "@/lib/leave-settlement";
import { r2, dayStart, addDays, usedBy, grantLeftBy } from "@/lib/leave-settlement-server";
import { excludedBranchNames, testAccountWhere } from "@/lib/employee-scope";
import { ensureLeaveCatalog } from "@/lib/leave-catalog-db";
import { kstIso } from "@/lib/salary-contract-api";

const DOC_TITLE = /사직원|연차\s*수당\s*정산/;
const DOC_STATUS: Record<string, string> = { DRAFT: "작성 중", SENT: "서명 대기", APPROVED: "서명 대기", SIGNED: "서명 완료" };

/** "2026년 11월 20일" · "2026-11-20" · "2026.11.20" → "2026-11-20". 아니면 null */
export function parseKoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /(\d{4})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/.exec(v);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
/** 서류에 적힌 일수 — **첫 번째 숫자만**(「11.5 (연차5+대체6)」 → 11.5). 숫자를 다 이어 붙이면 11.556 이 된다(검증 7) */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && Math.abs(v) <= 400 ? v : null;
  if (typeof v !== "string") return null;
  const m = /-?\d+(?:\.\d+)?/.exec(v.replace(/,/g, ""));
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && Math.abs(n) <= 400 ? n : null;
}

export type ResignLeaveRow = {
  empNo: number | null; name: string; branch: string | null; jobGroup: string | null;
  hireDate: string | null;
  leaveDate: string;                       // 퇴사일 YYYY-MM-DD
  leaveDateSource: "employee" | "document"; // 직원 관리 퇴사일 · 퇴사 서류 퇴사일자
  asOf: string;                            // 계산 기준일 = 퇴사일
  granted: number | null; used: number | null; remaining: number | null;   // 연차만(계산값) — 입사일이 없으면 null
  substituteRemaining: number;             // 대체휴일 잔여(일) — 연차와 따로. 음수로 계산되면 0(notes · needsCheck 로 알림)
  compensatoryRemaining: number;           // 보상휴가 잔여(일) — 연차와 따로. 음수로 계산되면 0(notes · needsCheck 로 알림)
  basis: string | null;                    // 산정 근거 한 줄
  document: null | {
    documentId: string; docNo: string | null; title: string; status: string; statusCode: string;
    leaveDate: string | null; remaining: number | null; used: number | null; confirmedAt: string | null;
  };
  documentIncludes: "연차만" | "연차+대체휴일" | "연차+대체휴일+보상휴가" | "연차+보상휴가" | "계산과 다름" | null;
  settlementDays: number | null;
  settlementSource: "document" | "calculated" | null;
  needsCheck: boolean;
  notes: string[];
};

type Who = { id: string; empNo: number | null; name: string; branch: string | null; jobGroup: string | null; hireDate: Date | null; resignDate: Date | null };
const WHO = { id: true, empNo: true, name: true, branch: true, jobGroup: true, hireDate: true, resignDate: true } as const;

async function userScope(): Promise<Prisma.UserWhereInput> {
  const excluded = await excludedBranchNames();
  return {
    deletedAt: null, role: { not: "ADMIN" },
    NOT: await testAccountWhere(),
    ...(excluded.length ? { OR: [{ branch: null }, { branch: { notIn: excluded } }] } : {}),
  };
}

type Doc = { id: string; docNo: string | null; title: string; status: string; userId: string; createdAt: Date; signedAt: Date | null; extraFields: Prisma.JsonValue };

/** 한 사람의 퇴사 서류 중 대표 하나 — 퇴사일자가 직원 관리 퇴사일과 같은 것 > 퇴사일자를 읽을 수 있는 것 > 서명 완료 > 서명 대기 > 작성 중
 *  > 연차수당 정산 신청서 > 사직원 > 최근 작성(검증 5). 조회 기간은 보지 않는다 — 달마다 다른 서류가 뽑혀 두 달에 나오지 않게(재검증 A) */
function pickDoc(docs: Doc[], leaveDate: string | null): Doc | null {
  const rank = (d: Doc) => {
    const st = d.status === "SIGNED" ? 3 : d.status === "SENT" || d.status === "APPROVED" ? 2 : 1;
    const ld = parseKoDate((d.extraFields as Record<string, unknown> | null)?.["퇴사일자"]);
    return [ld && leaveDate && ld === leaveDate ? 1 : 0, ld ? 1 : 0, st, /연차\s*수당/.test(d.title) ? 1 : 0, d.createdAt.getTime()];
  };
  const greater = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
  let best: Doc | null = null, bestR: number[] = [];
  for (const d of docs) {
    const r = rank(d);
    if (!best || greater(r, bestR)) { best = d; bestR = r; }
  }
  return best;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

export type ResignLeaveQuery = { mode: "range"; from: string; to: string } | { mode: "empNo"; empNo: number };

export async function resignLeaveBalances(q: ResignLeaveQuery): Promise<{ rows: ResignLeaveRow[] } | { notFound: string }> {
  await ensureLeaveCatalog();   // 본부가 만든 휴가 유형의 차감 여부 · 보상/대체 그룹까지 보게(api/leave/settlement 와 같음)
  const scope = await userScope();

  // 퇴사 서류 — 시험 · 옮겨 온 것 · 외부 · 취소(만료 · 반려) 제외
  const docWhere: Prisma.ContractWhereInput = {
    isTest: false, importBatch: null, externalName: null, status: { notIn: ["EXPIRED", "REJECTED"] },
    OR: [{ title: { contains: "사직원" } }, { title: { contains: "연차" } }],
  };

  let users: Who[];
  let docs: Doc[];
  if (q.mode === "empNo") {
    const u = await prisma.user.findFirst({ where: { AND: [scope, { empNo: q.empNo }] }, select: WHO });
    if (!u) return { notFound: "그 사번의 직원이 없습니다(본부 · 테스트 계정 · 휴지통은 조회하지 않습니다)." };
    users = [u];
    docs = await prisma.contract.findMany({ where: { ...docWhere, userId: u.id }, select: { id: true, docNo: true, title: true, status: true, userId: true, createdAt: true, signedAt: true, extraFields: true } });
  } else {
    // 서류는 최근 400일 안에 만든 것만 본다(퇴사일자는 글자라 DB 에서 거를 수 없다)
    const allDocs = await prisma.contract.findMany({
      where: { ...docWhere, createdAt: { gte: addDays(dayStart(q.from), -400) }, user: scope },
      select: { id: true, docNo: true, title: true, status: true, userId: true, createdAt: true, signedAt: true, extraFields: true },
    });
    const docInRange = allDocs.filter((d) => {
      if (!DOC_TITLE.test(d.title)) return false;
      const ld = parseKoDate((d.extraFields as Record<string, unknown> | null)?.["퇴사일자"]);
      return !!ld && ld >= q.from && ld <= q.to;
    });
    // 저장 시각(UTC 자정 · KST 자정)이 섞여 있을 수 있어 하루 넉넉히 뽑고 KST 날짜로 다시 거른다(api/leave/settlement 와 같음)
    const byResign = await prisma.user.findMany({
      where: { AND: [scope, { resignDate: { gte: addDays(dayStart(q.from), -1), lt: addDays(dayStart(q.to), 2) } }] },
      select: WHO,
    });
    const ids = new Set(byResign.filter((u) => { const r = kstDate(u.resignDate!); return r >= q.from && r <= q.to; }).map((u) => u.id));
    const docOnly = [...new Set(docInRange.map((d) => d.userId))].filter((id) => !ids.has(id));
    const extra = docOnly.length ? await prisma.user.findMany({ where: { AND: [scope, { id: { in: docOnly } }] }, select: WHO }) : [];
    // 직원 관리 퇴사일이 기간 밖으로 따로 정해진 사람은 그 날짜가 이긴다 — 아래에서 빼고, 그 퇴사일이 든 달 조회에 「날짜가 다름」 메모와 함께 나온다
    users = [...byResign.filter((u) => ids.has(u.id)), ...extra];
    const uidSet = new Set(users.map((u) => u.id));
    docs = allDocs.filter((d) => uidSet.has(d.userId));
  }

  // 사람마다 퇴사일 · 대표 서류
  type Plan = { u: Who; leaveDate: string; src: "employee" | "document"; doc: Doc | null; notes: string[] };
  const plans: Plan[] = [];
  for (const u of users) {
    const mine = docs.filter((d) => d.userId === u.id && DOC_TITLE.test(d.title));
    const emp = u.resignDate ? kstDate(u.resignDate) : null;
    const notes: string[] = [];
    const doc = pickDoc(mine, emp);
    const docDates = [...new Set(mine.map((d) => parseKoDate((d.extraFields as Record<string, unknown> | null)?.["퇴사일자"])).filter((x): x is string => !!x))];
    if (docDates.length > 1) notes.push(`퇴사 서류마다 퇴사일자가 다릅니다(${docDates.sort().join(", ")}) — 대표 서류 「${doc?.title ?? ""}」 기준입니다. 확인해 주세요.`);
    const docDate = doc ? parseKoDate((doc.extraFields as Record<string, unknown> | null)?.["퇴사일자"]) : null;
    let leaveDate: string | null = emp, src: "employee" | "document" = "employee";
    if (!leaveDate && docDate) { leaveDate = docDate; src = "document"; notes.push("직원 관리에 퇴사일이 아직 없어 퇴사 서류의 퇴사일자로 계산했습니다(퇴사 예정)."); }
    if (!leaveDate) {
      if (q.mode === "empNo") return { notFound: "이 직원은 퇴사일이 정해지지 않았습니다(직원 관리 퇴사일 · 퇴사 서류 퇴사일자 모두 없음)." };
      continue;
    }
    if (emp && docDate && emp !== docDate) notes.push(`직원 관리 퇴사일(${emp})과 퇴사 서류 퇴사일자(${docDate})가 다릅니다 — 직원 관리 퇴사일로 계산했습니다.`);
    // 정해진 퇴사일이 조회 기간 밖이면 뺀다 — 한 사람이 두 달 조회에 모두 나와 수당이 두 번 계산되지 않게(검증 6). 그 퇴사일이 든 달 조회에 나온다
    if (q.mode === "range" && (leaveDate < q.from || leaveDate > q.to)) continue;
    plans.push({ u, leaveDate, src, doc, notes });
  }

  const ids = plans.map((p) => p.u.id);
  const [uses, grants] = await Promise.all([
    usedBy(new Map(plans.map((p) => [p.u.id, { year: Number(p.leaveDate.slice(0, 4)), cut: p.leaveDate, afterAll: true }]))),
    grantLeftBy(ids),
  ]);

  const rows = plans.map(({ u, leaveDate, src, doc, notes }): ResignLeaveRow => {
    const hire = u.hireDate ? kstDate(u.hireDate) : null;
    const use = uses.get(u.id)!;
    const g = grants.get(u.id) ?? { compHours: 0, substHours: 0 };
    // 부여 기록이 부족하면(시프티 때 부여분이 큐브티에 없는 경우 등) 잔여가 음수로 나온다 — 정산에서 빼지 않게 0 으로 두고 확인을 알린다(11/19 실측: 4명 음수)
    const substRaw = r2(g.substHours / 8), compRaw = r2(g.compHours / 8);
    const subst = Math.max(0, substRaw), comp = Math.max(0, compRaw);
    const calc = hire && hire <= leaveDate ? resignedCalc(hire, leaveDate, use.hours) : null;
    if (!hire) notes.push("직원 관리에 입사일이 없어 연차를 계산하지 못했습니다.");
    else if (!calc) notes.push("입사일이 퇴사일보다 늦어 연차를 계산하지 못했습니다(입력 확인 필요).");
    if (use.afterCut > 0) notes.push(`퇴사일 뒤로 잡힌 승인 휴가 ${use.afterCut}일이 있습니다(정산에 넣지 않음 — 취소 필요).`);
    if (use.crossCut) notes.push("퇴사일을 걸친 휴가가 있어 통째로 사용에 넣었습니다(확인 필요).");
    if (substRaw < 0) notes.push(`대체휴일 잔여가 ${substRaw}일(음수)로 계산됩니다 — 큐브티에 부여 기록이 부족한 것으로 보여 0 으로 두었습니다. 확인해 주세요.`);
    if (compRaw < 0) notes.push(`보상휴가 잔여가 ${compRaw}일(음수)로 계산됩니다 — 큐브티에 부여 기록이 부족한 것으로 보여 0 으로 두었습니다. 확인해 주세요.`);

    const granted = calc ? r2(calc.hireBasis - calc.fiscalBeforeYear) : null;
    const used = calc ? calc.used : null;
    const remaining = calc ? calc.settlement : null;

    const ef = (doc?.extraFields ?? null) as Record<string, unknown> | null;
    const document = doc ? {
      documentId: doc.id, docNo: doc.docNo, title: doc.title,
      status: DOC_STATUS[doc.status] ?? doc.status, statusCode: doc.status,
      leaveDate: parseKoDate(ef?.["퇴사일자"]),
      remaining: num(ef?.["미소진연차일수"]), used: num(ef?.["연차사용일수"]),
      confirmedAt: doc.status === "SIGNED" ? kstIso(doc.signedAt) : null,
    } : null;

    let includes: ResignLeaveRow["documentIncludes"] = null;
    if (document?.remaining != null && remaining != null) {
      const d = document.remaining;
      if (near(d, remaining)) includes = "연차만";
      else if (near(d, r2(remaining + subst + comp))) includes = subst && comp ? "연차+대체휴일+보상휴가" : subst ? "연차+대체휴일" : "연차+보상휴가";
      else if (near(d, r2(remaining + subst))) includes = "연차+대체휴일";
      else if (near(d, r2(remaining + comp))) includes = "연차+보상휴가";
      else includes = "계산과 다름";
    }
    // 「연차만」인데 대체 · 보상 잔여가 0 이면 합친 것과 같다 — 더해도 그대로
    let settlementDays: number | null = null, settlementSource: ResignLeaveRow["settlementSource"] = null;
    if (document && document.statusCode === "SIGNED" && document.remaining != null) {
      settlementSource = "document";
      settlementDays = includes === "연차만" ? r2(document.remaining + subst + comp)
        : includes === "연차+대체휴일" ? r2(document.remaining + comp)
        : includes === "연차+보상휴가" ? r2(document.remaining + subst)
        : document.remaining;
    } else if (remaining != null) {
      settlementSource = "calculated";
      settlementDays = r2(remaining + subst + comp);
    }
    if (includes === "계산과 다름") notes.push("퇴사 서류의 미소진 일수가 큐브티 계산과 다릅니다 — 서류 값(직원 서명)을 정산 일수로 두었습니다. 확인해 주세요.");
    if (document && document.statusCode !== "SIGNED") notes.push(`퇴사 서류가 아직 ${document.status} 상태라 계산값으로 정산 일수를 냈습니다.`);
    if (!document) notes.push("큐브티 퇴사 서류가 없어 계산값으로 정산 일수를 냈습니다.");

    const needsCheck = includes === "계산과 다름" || !calc || use.afterCut > 0 || use.crossCut || substRaw < 0 || compRaw < 0
      || notes.some((n) => n.includes("다릅니다"));
    return {
      empNo: u.empNo, name: u.name, branch: u.branch, jobGroup: u.jobGroup, hireDate: hire,
      leaveDate, leaveDateSource: src, asOf: leaveDate,
      granted, used, remaining,
      substituteRemaining: subst, compensatoryRemaining: comp,
      basis: calc?.basis ?? null,
      document, documentIncludes: includes,
      settlementDays, settlementSource, needsCheck, notes,
    };
  });
  rows.sort((a, b) => a.leaveDate.localeCompare(b.leaveDate) || (a.branch ?? "").localeCompare(b.branch ?? "", "ko") || a.name.localeCompare(b.name, "ko"));
  return { rows };
}
