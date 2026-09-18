// 포털(직영인사) 인원명부 → 큐브티 한 방향 동기화 (2026-09-15 디렉터 결정)
//
//  · 포털은 건드리지 않는다. 포털 담당자가 만든 **읽기 전용 뷰(cubetee_roster)** 를 하루 한 번 읽는다.
//  · 열쇠는 사번 — 포털 ems_id "02512" ↔ 큐브티 User.empNo 2512.
//  · 일반 칸(이름·지점·직책·직급·입사일)은 본부가 "자동 반영"을 켜 두면 바로 반영, 꺼져 있으면 확인 대기.
//  · 입사·퇴사·휴직·복직·사번 연결은 로그인·결재선이 따라 바뀌므로 **본부 확인 1클릭 뒤에만**.
//  · ⚠ 사번은 같은데 이름·이메일이 모두 다르면 **아무것도 하지 않는다** — 큐브티 사번은 1001부터 자동 발급이라
//    포털 사번과 우연히 겹친 다른 사람일 수 있다(검증관 H1: 남의 계정을 되살리거나 퇴사시키는 사고).
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { bumpTokenVersion, clearSessionCache } from "@/lib/auth";
import { syncMainManagerFor } from "@/lib/manager-branches";
import { logAudit } from "@/lib/audit";
import { isResigned, kstTodayMidnight } from "@/lib/resign";
import { currentLeaveYear } from "@/lib/leave-calc";
import { isSheetUrl, fetchSheetRoster, fetchSheetLeavers, type LeaverRow } from "@/lib/roster-sheet";

export const PORTAL_SETTING = { url: "portalRosterUrl", leaversUrl: "portalLeaversUrl", apikey: "portalRosterApiKey", token: "portalRosterToken", auto: "portalSyncAutoApply" } as const;
export const SYSTEM_ACTOR = { id: "system:portal-sync", name: "인사명부 연동" };
// 입사 반영 시 임시 비밀번호 — 관리자 비밀번호 초기화와 같은 값·같은 규칙(24시간 뒤 봇이 변경 요청)
const TEMP_PASSWORD = "12345678";
// 봇 계정(비활성 EMPLOYEE)은 사람이 아니다 — 대조에서 뺀다
const BOT_EMAILS = ["bot@cubetee.co.kr", "hr-bot@cubetee.co.kr"];

export type Kind = "UPDATE" | "HIRE" | "RESIGN" | "LEAVE" | "RETURN" | "LINK";
type Actor = { id: string; name: string };
type FieldKey = "name" | "branch" | "jobGroup" | "position" | "hireDate";
export type Fields = Partial<Record<FieldKey, [string | null, string]>>;

// ── 연결 설정 ───────────────────────────────────────────────
type Cfg = { url: string; apikey: string; token: string; leaversUrl: string };
async function setting(key: string): Promise<string> {
  const r = await prisma.appSetting.findUnique({ where: { key } });
  return r?.value ?? "";
}
export async function portalConfig(): Promise<Cfg | null> {
  const [url, apikey, token, leaversUrl] = await Promise.all([setting(PORTAL_SETTING.url), setting(PORTAL_SETTING.apikey), setting(PORTAL_SETTING.token), setting(PORTAL_SETTING.leaversUrl)]);
  if (!url) return null;
  // 구글 시트(인사 원장)은 공유 주소만으로 읽는다 — 열쇠가 없어도 설정된 것으로 본다
  if (!apikey && !isSheetUrl(url)) return null;
  // 퇴사자 탭은 선택 — 없으면 퇴사일을 못 찾아 퇴사는 종전처럼 건너뜀으로만 알린다
  return { url, apikey, token: token || apikey, leaversUrl: isSheetUrl(leaversUrl) ? leaversUrl : "" };
}
export async function isAutoApply(): Promise<boolean> {
  return (await setting(PORTAL_SETTING.auto)) === "1";
}
/** 연결 주소 검사 — https + *.supabase.co + REST 경로만(키를 엉뚱한 곳·내부망으로 보내지 않게, 검증관 L9) */
export function validRosterUrl(url: string): boolean {
  if (isSheetUrl(url)) return true; // 인사 원장(구글 시트) — 2026-09-16부터 기본 원천
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".supabase.co") && u.pathname.startsWith("/rest/v1/") && !u.username && !u.password;
  } catch { return false; }
}

// ── 포털 읽기 ───────────────────────────────────────────────
export type PortalRow = {
  portalId: string; empNo: number | null; name: string; status: string; job: string; position: string;
  branch: string; joinDate: string; leaveDate: string; email: string;
  // false 면 입사일을 고치지 않는다 — 인사명부 규칙상 7월 이전 입사자(roster-sheet.ts ROUTE_RULE_FROM).
  // 없으면(예전 포털 DB 경로) 종전처럼 고칠 수 있는 것으로 본다.
  hireDateEditable?: boolean;
};
const t = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const dateOnly = (v: unknown) => {
  const s = t(v);
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s) || /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
};

export async function fetchPortalRoster(cfg: Cfg): Promise<PortalRow[]> {
  // 인사 원장(구글 시트) — 디렉터 지시로 2026-09-16부터 이쪽을 쓴다. 아래 포털 DB 경로는 그대로 둠.
  if (isSheetUrl(cfg.url)) return fetchSheetRoster(cfg.url);
  if (!validRosterUrl(cfg.url)) throw new Error("연결 주소가 올바르지 않습니다(https://…supabase.co/rest/v1/… 형식이어야 합니다).");
  const u = new URL(cfg.url);
  u.searchParams.set("select", "*");
  const res = await fetch(u, {
    headers: { apikey: cfg.apikey, Authorization: `Bearer ${cfg.token}`, Accept: "application/json", Prefer: "count=exact" },
    cache: "no-store",
    redirect: "error", // 다른 곳으로 넘기면 키가 따라간다 — 따라가지 않는다
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`포털 응답 ${res.status}${body ? ` — ${body}` : ""}`);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error("포털 응답이 목록 형식이 아닙니다.");
  // PostgREST 는 최대 행 수를 넘으면 조용히 자른다 — 일부만 받고 "명부에 없음"으로 오판하지 않게 전체 수를 대조
  const total = Number((res.headers.get("content-range") || "").split("/")[1]);
  if (Number.isFinite(total) && total > data.length)
    throw new Error(`포털 인원 ${total}명 중 ${data.length}명만 받았습니다. 포털 담당자에게 조회 최대 행 수를 늘려 달라고 요청해주세요.`);
  if (data.length > 5000) throw new Error(`포털 응답이 너무 큽니다(${data.length}행).`);
  return (data as Record<string, unknown>[]).map((r) => {
    const portalId = t(r.ems_id);
    // 사번은 숫자만(앞자리 0 허용). "A-0100"·"12.5" 같은 값은 숫자만 추려 엉뚱한 사람과 맞추지 않게 버린다(검증관 L4)
    const empNo = /^\d{1,9}$/.test(portalId) ? parseInt(portalId, 10) : null;
    return {
      portalId,
      empNo: empNo && empNo > 0 ? empNo : null,
      name: t(r.name), status: t(r.status), job: t(r.job), position: t(r.position), branch: t(r.branch),
      joinDate: dateOnly(r.join_date), leaveDate: dateOnly(r.leave_date), email: t(r.email_company).toLowerCase(),
    };
  });
}

// ── 값 대응 (포털 → 큐브티) ─────────────────────────────────
// 대치2·대치 재수종합은 대치점 소속(직영 학생수 보고 기준과 같다). 큐브티에 없는 지점이면 반영하지 않고 알린다.
const BRANCH_ALIAS: Record<string, string> = { 대치2: "대치", "대치 재수종합": "대치", 대치재수종합: "대치" };
export function mapBranch(branch: string, known: Set<string>): { value: string | null; reason?: string } {
  if (!branch) return { value: null };
  const v = BRANCH_ALIAS[branch] ?? branch;
  return known.has(v) ? { value: v } : { value: null, reason: `큐브티에 없는 지점: ${branch}` };
}

/** 포털 직무(+직급) → 큐브티 직책(원장·CM·TM·코디·학습실장·튜터). 확실하지 않으면 null(반영하지 않고 알림) */
export function mapJobGroup(job: string, position: string): string | null {
  const j = job.replace(/\s+/g, "");
  if (!j) return null;
  if (j.includes("코디")) return "코디"; // "원장실 코디" 도 코디
  if (j.includes("학습실장")) return "학습실장";
  if (j.includes("튜터")) return "튜터";
  if (j.includes("부원장")) return "CM";
  if (j === "원장") return "원장";
  if (j.includes("원장")) return null; // 원장대행 등 — 확실하지 않다
  if (j.includes("교실장")) return "TM";
  if (/코칭|매니저|코치/.test(j)) {
    if (position === "원장") return null; // 직무와 직급이 어긋남
    return position.includes("교실장") ? "TM" : "CM";
  }
  if (/교육생|인턴/.test(j)) {
    if (position.includes("교실장")) return "TM";
    if (position.includes("매니저")) return "CM";
  }
  return null;
}

/** 직급 — 큐브티는 원장의 직급을 비워 두고, 교육생은 직급 체계에 없다 → 이 둘은 반영하지 않는다 */
export function mapPosition(position: string): string | null {
  if (!position || position === "원장" || position === "교육생") return null;
  return position;
}

type PState = "ACTIVE" | "LEAVE" | "RESIGNED" | "OTHER";
function portalState(r: PortalRow): PState {
  // 인사 원장의 "본사발령"은 큰브티 관리 대상이 아니다(본사 인원은 계정 체계가 따로다) — OTHER 로 두어 손대지 않는다
  if (r.status === "퇴사" || r.status === "퇴직") return "RESIGNED";
  if (r.status === "휴직") return "LEAVE";
  if (r.status === "재직") return r.leaveDate ? "RESIGNED" : "ACTIVE";
  return "OTHER";
}

const userSelect = {
  id: true, name: true, email: true, empNo: true, role: true, branch: true, jobGroup: true, position: true,
  hireDate: true, resignDate: true, employmentStatus: true, isActive: true,
} as const;
type CUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;
type CState = "ACTIVE" | "LEAVE" | "RESIGNED" | "DISABLED";
function cubeteeState(u: { isActive: boolean; employmentStatus: string; resignDate: Date | null }): CState {
  if (u.employmentStatus === "RESIGNED" || isResigned(u.resignDate)) return "RESIGNED";
  // 퇴사가 아닌데 비활성 = 관리자가 일부러 끈 계정 — 연동이 되살리지 않는다(검증관 M1)
  if (!u.isActive) return "DISABLED";
  return u.employmentStatus === "ON_LEAVE" ? "LEAVE" : "ACTIVE";
}
const dstr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const normName = (s: string) => s.replace(/\s+/g, "");

// ── 비교(계획) ─────────────────────────────────────────────
export type Plan = { kind: Kind; empNo: number; portalId: string; name: string; userId: string | null; diff: Record<string, unknown>; forceConfirm?: boolean };
type Skip = { portalId: string; name: string; reason: string };
export type PlanResult = {
  plans: Plan[]; skipped: Skip[];
  roleMismatch: { empNo: number; name: string; branch: string | null }[];
  missingInPortal: { empNo: number | null; name: string; branch: string | null }[];
  fetched: number; matched: number;
};

/**
 * 퇴사자 탭에서 이 직원의 퇴사일을 찾는다 — **이름 + 입사일**(하루 차까지)이 모두 맞는 줄만.
 * 퇴사자 탭에는 사번이 없고 같은 이름이 350명이라, 이름만 보면 2006년 동명이인의 퇴사일을 쓰게 된다(실측).
 * 재입사자는 재입사일로도 맞춰 본다. 줄이 여럿이어도 퇴사일이 하나로 모이면 쓰고, 갈리면 쓰지 않는다.
 */
type LeaveHit = { date: string; branch: string } | { reason: string };
function findLeaveDate(leavers: Map<string, LeaverRow[]>, name: string, hireDates: string[]): LeaveHit {
  const cands = leavers.get(normName(name)) ?? [];
  if (!cands.length) return { reason: "퇴사자 탭에 아직 없습니다" };
  const near = (a: string, b: string) => !!a && !!b && Math.abs(Date.parse(a) - Date.parse(b)) <= 86_400_000;
  const hits = cands.filter((l) => hireDates.some((h) => near(l.joinDate, h) || near(l.rejoinDate, h)) && (!l.joinDate || l.leaveDate >= l.joinDate));
  if (!hits.length) return { reason: "퇴사자 탭에 같은 이름은 있지만 입사일이 맞는 사람이 없습니다(동명이인)" };
  const dates = [...new Set(hits.map((h) => h.leaveDate))];
  if (dates.length > 1) return { reason: `퇴사자 탭에 같은 이름·입사일로 퇴사일이 여럿입니다(${dates.join(", ")})` };
  return { date: dates[0], branch: hits[0].branch };
}

export async function planPortalSync(rows: PortalRow[], leaverRows: LeaverRow[] = []): Promise<PlanResult> {
  const leavers = new Map<string, LeaverRow[]>();
  for (const l of leaverRows) { const k = normName(l.name); leavers.set(k, [...(leavers.get(k) ?? []), l]); }
  const [users, branchRows] = await Promise.all([
    prisma.user.findMany({ where: { deletedAt: null, role: { not: "ADMIN" }, email: { notIn: BOT_EMAILS } }, select: userSelect }),
    prisma.branch.findMany({ select: { name: true, countInStats: true } }),
  ]);
  const known = new Set(branchRows.map((b) => b.name));
  const notCounted = new Set(branchRows.filter((b) => !b.countInStats).map((b) => b.name)); // 본부·테스트지점 — "명부에 없음" 목록에서 뺀다
  const byEmp = new Map<number, CUser>();
  for (const u of users) if (u.empNo != null) byEmp.set(u.empNo, u);

  const plans: Plan[] = [];
  const skipped: Skip[] = [];
  const roleMismatch: PlanResult["roleMismatch"] = [];
  const dupCount = new Map<number, number>();
  for (const r of rows) if (r.empNo) dupCount.set(r.empNo, (dupCount.get(r.empNo) ?? 0) + 1);
  const seen = new Set<string>();
  const unmatched: PortalRow[] = [];
  const skip = (r: PortalRow, reason: string) => skipped.push({ portalId: r.portalId, name: r.name, reason });

  for (const r of rows) {
    if (!r.empNo) { skip(r, r.portalId ? `사번 형식이 숫자가 아님: ${r.portalId}` : "사번 없음"); continue; }
    if ((dupCount.get(r.empNo) ?? 0) > 1) { skip(r, "명부에 같은 사번이 여러 명"); continue; }
    const ps = portalState(r);
    if (ps === "OTHER") { skip(r, `알 수 없는 상태: ${r.status || "(빈 값)"}`); continue; }
    const u = byEmp.get(r.empNo);
    if (!u) { if (ps !== "RESIGNED") unmatched.push(r); continue; }

    // 같은 사람인가 — 이름(공백 무시) 또는 회사 이메일이 같아야 한다. 둘 다 다르면 아무것도 하지 않는다(H1).
    // ⚠ 건너뛸 때는 seen 에 넣지 않는다 — 그 큐브티 직원은 자기 진짜 포털 행과 "사번 연결"로 이어져야 한다.
    //   넣으면 진짜 행이 "입사"로 떠서 확인 한 번에 중복 계정이 생긴다(검증관 N2).
    const sameName = !!r.name && normName(r.name) === normName(u.name);
    const sameEmail = !!r.email && u.email.trim().toLowerCase() === r.email;
    if (!r.name) { skip(r, "명부 이름이 비어 있음"); continue; }
    if (!sameName && !sameEmail) {
      skip(r, `사번 충돌 의심 — 큐브티 ${u.branch ?? "-"} ${u.name} / 명부 ${r.branch || "-"} ${r.name}. 같은 사람이 아니면 한쪽 사번을 고쳐주세요`);
      continue;
    }
    seen.add(u.id);
    // 이름만 같고 이메일·지점·입사일이 하나도 안 맞으면 동명이인이 사번까지 우연히 겹친 것일 수 있다 —
    // 자동 반영하지 않고, 카드·확인창에 양쪽 지점·입사일을 보여 확인받는다(검증관 N1)
    const portalBranch = mapBranch(r.branch, known).value;
    const cHire = dstr(u.hireDate);
    const sameBranch = !!portalBranch && portalBranch === u.branch;
    // 입사일은 하루 차이까지 같은 날로 본다 — 옛 데이터 중 KST 자정으로 저장돼 하루 앞서 보이는 행이 있다(검증관 4차 낮음 3)
    const dayGap = r.joinDate && cHire ? Math.abs(Date.parse(r.joinDate) - Date.parse(cHire)) / 86_400_000 : NaN;
    const sameHire = dayGap <= 1;
    // 양쪽에 다 있는데 다른 것만 "반대 증거"로 친다 — 값이 비어 있는 건 증거가 아니다(검증관 3차 낮음 1: 정상 전근자 오경고)
    const emailDiffers = !!r.email && !!u.email && u.email.trim().toLowerCase() !== r.email;
    const hireDiffers = dayGap > 1;
    const weakIdentity = !sameEmail && !sameBranch && !sameHire && (emailDiffers || hireDiffers);
    // 반대 증거는 없어도 이메일·지점·입사일 어느 것으로도 같은 사람임이 확인되지 않으면 — 경고는 안 띄우되
    // 자동 반영하지 않고 확인으로 돌린다(검증관 4차 중간: 이메일·입사일이 비면 동명이인의 지점 이동이 새던 경로)
    const unverified = !sameEmail && !sameBranch && !sameHire;
    const weakReasons = weakIdentity ? [emailDiffers ? "이메일 다름" : "", hireDiffers ? "입사일 다름" : "", portalBranch && u.branch && portalBranch !== u.branch ? "지점 다름" : ""].filter(Boolean) : [];
    const base = { empNo: r.empNo, portalId: r.portalId, name: r.name, userId: u.id };
    const idf = { target: { name: u.name, branch: u.branch, empNo: u.empNo, hireDate: cHire || null }, portal: { branch: r.branch || null, joinDate: r.joinDate || null }, weakIdentity, weakReasons, unverified };
    const cs = cubeteeState(u);

    if (cs === "DISABLED") { if (ps !== "RESIGNED") skip(r, "큐브티에서 비활성 처리된 직원 — 직원 관리에서 확인해주세요"); continue; }
    if (cs === "RESIGNED") {
      if (ps === "ACTIVE" || ps === "LEAVE") plans.push({ ...base, kind: "RETURN", diff: { from: "RESIGNED", to: ps, ...idf } });
      continue; // 퇴사자의 일반 칸은 건드리지 않는다
    }
    if (ps === "RESIGNED") {
      // 퇴사일이 비어 있으면 "오늘"로 채우지 않는다 — 날마다 내용이 달라져 [무시]가 안 먹고 실제 퇴사일도 틀린다(M2)
      // 인사 원장에는 퇴사일 칸이 없다 → 퇴사자 탭에서 이름+입사일로 찾는다(2026-09-18 디렉터 지시)
      let leaveDate = r.leaveDate;
      let from = "명부";
      if (!leaveDate) {
        const hit = findLeaveDate(leavers, u.name, [dstr(u.hireDate), r.joinDate].filter(Boolean));
        if ("reason" in hit) { skip(r, `명부에서 퇴사로 바뀌었지만 퇴사일을 알 수 없습니다 — ${hit.reason}. 직원 관리에서 퇴사일을 직접 넣어주세요`); continue; }
        leaveDate = hit.date; from = "퇴사자 탭";
      }
      if (dstr(u.resignDate) !== leaveDate) plans.push({ ...base, kind: "RESIGN", diff: { resignDate: leaveDate, portalStatus: r.status, leaveDateFrom: from, ...idf } });
      continue;
    }
    if (ps === "LEAVE" && cs === "ACTIVE") plans.push({ ...base, kind: "LEAVE", diff: { portalStatus: r.status, ...idf } });
    if (ps === "ACTIVE" && cs === "LEAVE") plans.push({ ...base, kind: "RETURN", diff: { from: "LEAVE", to: "ACTIVE", ...idf } });

    // 일반 칸
    const fields: Fields = {};
    if (!sameName) fields.name = [u.name, r.name]; // 이메일로 같은 사람임을 확인한 개명 — 확인 후에만
    const mb = mapBranch(r.branch, known);
    if (mb.reason) skip(r, mb.reason);
    else if (mb.value && mb.value !== u.branch) fields.branch = [u.branch, mb.value];
    const jg = mapJobGroup(r.job, r.position);
    if (!jg && r.job) skip(r, `직무 대응 없음: ${r.job}${r.position ? `/${r.position}` : ""}`);
    else if (jg && jg !== u.jobGroup) fields.jobGroup = [u.jobGroup, jg];
    if (jg === "원장" && u.role !== "MANAGER") roleMismatch.push({ empNo: r.empNo, name: u.name, branch: u.branch });
    const pos = mapPosition(r.position);
    if (pos && pos !== u.position) fields.position = [u.position, pos];
    // 7월 이전 입사자는 입사일을 건드리지 않는다(디렉터 확정 2026-09-18) — 교육 수료 후 입사라 기준이 다르다
    if (r.joinDate && r.hireDateEditable !== false && r.joinDate !== dstr(u.hireDate)) fields.hireDate = [dstr(u.hireDate) || null, r.joinDate];
    if (Object.keys(fields).length) {
      const nameMismatch = !!fields.name;
      // ⚠ 입사일은 연차 산정의 기준이다(leave-calc) — 바뀌는 건은 항상 확인받는다.
      //   어느 날짜를 입사일로 보는지는 roster-sheet.ts 의 ROUTE_RULE_FROM 규칙을 따른다
      //   (7월 이후 입사자 = 루트입과일, 그 전 입사자 = 건드리지 않음 — 2026-09-18 디렉터 확정).
      const hireChange = !!fields.hireDate;
      // 원장 계정의 지점·직책이 바뀌면 담당 범위·권한 판정이 따라 바뀐다 — 자동으로 두지 않는다(M5)
      const managerScope = u.role === "MANAGER" && !!(fields.branch || fields.jobGroup);
      plans.push({ ...base, kind: "UPDATE", diff: { fields, nameMismatch, managerScope, ...idf }, forceConfirm: nameMismatch || managerScope || hireChange || weakIdentity || unverified });
    }
  }

  // 포털에만 있는 재직자 → 사번이 다르게 들어간 같은 사람인지 찾는다. 없으면 입사.
  //  1차: 회사 이메일(모든 행을 먼저 끝낸다 — 순서에 따라 결과가 바뀌지 않게, M4)
  //  2차: 이름+지점 — 포털 지점이 큐브티 지점으로 대응되고, 양쪽 모두에서 그 이름·지점이 한 명뿐일 때만
  const free = users.filter((u) => !seen.has(u.id) && cubeteeState(u) === "ACTIVE" || (!seen.has(u.id) && cubeteeState(u) === "LEAVE"));
  const linked = new Map<PortalRow, { u: CUser; by: "email" | "name" }>();
  const taken = new Set<string>();
  for (const r of unmatched) {
    if (!r.email) continue;
    const hits = free.filter((u) => !taken.has(u.id) && u.email.trim().toLowerCase() === r.email);
    if (hits.length === 1) { linked.set(r, { u: hits[0], by: "email" }); taken.add(hits[0].id); }
  }
  const nameKey = (name: string, branch: string | null) => `${normName(name)}|${branch ?? ""}`;
  const portalKeyCount = new Map<string, number>();
  for (const r of unmatched) {
    if (linked.has(r)) continue;
    const mb = mapBranch(r.branch, known).value;
    if (mb) portalKeyCount.set(nameKey(r.name, mb), (portalKeyCount.get(nameKey(r.name, mb)) ?? 0) + 1);
  }
  for (const r of unmatched) {
    if (linked.has(r) || !r.name) continue;
    const mb = mapBranch(r.branch, known).value;
    if (!mb || (portalKeyCount.get(nameKey(r.name, mb)) ?? 0) !== 1) continue;
    const cands = free.filter((u) => !taken.has(u.id) && normName(u.name) === normName(r.name) && u.branch === mb);
    if (cands.length === 1) { linked.set(r, { u: cands[0], by: "name" }); taken.add(cands[0].id); }
  }
  for (const r of unmatched) {
    const base = { empNo: r.empNo as number, portalId: r.portalId, name: r.name };
    const hit = linked.get(r);
    if (hit) {
      plans.push({ ...base, kind: "LINK", userId: hit.u.id, diff: { fromEmpNo: hit.u.empNo, toEmpNo: r.empNo, by: hit.by, target: { name: hit.u.name, branch: hit.u.branch, empNo: hit.u.empNo, hireDate: dstr(hit.u.hireDate) || null }, portal: { branch: r.branch || null, joinDate: r.joinDate || null } } });
      continue;
    }
    const mb = mapBranch(r.branch, known).value;
    const missing: string[] = [];
    if (!r.name) missing.push("이름");
    if (!r.email || !EMAIL_RE.test(r.email)) missing.push("회사 이메일");
    if (!mb) missing.push("지점");
    plans.push({
      ...base, kind: "HIRE", userId: null,
      diff: {
        email: r.email || null, branch: mb, portalBranch: r.branch, jobGroup: mapJobGroup(r.job, r.position), position: mapPosition(r.position), hireDate: r.joinDate || null, onLeave: portalState(r) === "LEAVE", missing,
        portal: { branch: r.branch || null, joinDate: r.joinDate || null },
        sameNameInCubetee: users.filter((u) => normName(u.name) === normName(r.name)).slice(0, 3).map((u) => ({ name: u.name, branch: u.branch, empNo: u.empNo, state: cubeteeState(u) })),
      },
    });
  }

  // 큐브티엔 재직인데 명부에 아예 없는 사람 → 퇴사자 탭에 이름+입사일로 있으면 퇴사 확인으로 올린다
  // (디렉터: "원래 있었는데 인사명부에 없다면 퇴사명부를 찾아보고"). 없으면 종전처럼 목록으로만 알린다.
  const missingInPortal: PlanResult["missingInPortal"] = [];
  for (const u of free) {
    if (taken.has(u.id) || (u.branch && notCounted.has(u.branch))) continue;
    const hire = dstr(u.hireDate);
    const hit = u.empNo != null && hire ? findLeaveDate(leavers, u.name, [hire]) : null;
    if (hit && "date" in hit && dstr(u.resignDate) !== hit.date) {
      plans.push({
        empNo: u.empNo as number, portalId: `퇴사자탭:${u.name}`, name: u.name, userId: u.id, kind: "RESIGN",
        diff: { resignDate: hit.date, portalStatus: "명부에 없음", leaveDateFrom: "퇴사자 탭",
          target: { name: u.name, branch: u.branch, empNo: u.empNo, hireDate: hire }, portal: { branch: hit.branch || null, joinDate: hire } },
      });
      continue;
    }
    missingInPortal.push({ empNo: u.empNo, name: u.name, branch: u.branch });
  }
  return { plans, skipped, roleMismatch, missingInPortal, fetched: rows.length, matched: seen.size };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sigOf(p: Plan): string {
  // 큐브티 쪽 현재값(target·before)은 빼고 "명부 값"만으로 — 무시한 뒤 큐브티가 조금 바뀌어도 다시 올리지 않게
  const target = p.kind === "UPDATE"
    ? Object.entries((p.diff.fields ?? {}) as Fields).map(([k, v]) => [k, v?.[1]]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    : Object.fromEntries(Object.entries(p.diff).filter(([k]) => !["target", "portal", "weakIdentity", "weakReasons", "unverified", "sameNameInCubetee"].includes(k)));
  return createHash("sha256").update(`${p.kind}|${p.empNo}|${p.userId ?? ""}|${JSON.stringify(target)}`).digest("hex").slice(0, 32);
}

// ── 반영 ───────────────────────────────────────────────────
const utcDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const stateSelect = { id: true, name: true, role: true, branch: true, empNo: true, deletedAt: true, isActive: true, employmentStatus: true, resignDate: true } as const;

async function applyUpdate(userId: string, fields: Fields, actor: Actor) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: stateSelect });
  if (!u || u.deletedAt) throw new Error("직원을 찾을 수 없습니다.");
  // 관리자 계정은 연동으로 바꾸지 않는다(관리자 수정은 메인 관리자 전용 — PATCH 와 같은 선, L5)
  if (u.role === "ADMIN") throw new Error("관리자 계정은 연동으로 바꾸지 않습니다.");
  // 확인 대기가 묵는 사이 퇴사·비활성된 사람의 정보는 바꾸지 않는다(L6)
  const st = cubeteeState(u);
  if (st === "RESIGNED" || st === "DISABLED") throw new Error("그사이 큐브티에서 퇴사·비활성 처리된 직원입니다.");
  if (fields.branch && !(await prisma.branch.findFirst({ where: { name: fields.branch[1] }, select: { id: true } })))
    throw new Error(`큐브티에 없는 지점입니다: ${fields.branch[1]}`);
  const data: Prisma.UserUpdateInput = {};
  if (fields.name) data.name = fields.name[1];
  if (fields.branch) data.branch = fields.branch[1];
  if (fields.jobGroup) data.jobGroup = fields.jobGroup[1];
  if (fields.position) data.position = fields.position[1];
  if (fields.hireDate) data.hireDate = utcDate(fields.hireDate[1]);
  if (!Object.keys(data).length) return;
  await prisma.user.update({ where: { id: userId }, data });
  // 지점이 바뀌면 토큰에 박힌 지점이 낡는다 — 직원 수정(PATCH)과 같은 규칙으로 끊고, 메인 원장 지정을 정리한다
  if (fields.branch && fields.branch[1] !== u.branch) {
    await bumpTokenVersion(userId).catch(() => {});
    await syncMainManagerFor(userId);
  }
  const labels: Record<FieldKey, string> = { name: "이름", branch: "지점", jobGroup: "직책", position: "직급", hireDate: "입사일" };
  const detail = (Object.entries(fields) as [FieldKey, [string | null, string]][]).map(([k, v]) => `${labels[k]} ${v[0] ?? "-"}→${v[1]}`).join(", ");
  await logAudit({ actorId: actor.id, actorName: actor.name, action: "EMPLOYEE_UPDATE", targetType: "USER", targetId: userId, targetName: u.name, detail: `인사명부 반영 — ${detail}` });
}

type ChangeRow = { id: string; kind: string; empNo: number; name: string; userId: string | null; diff: Prisma.JsonValue };

async function applyChange(c: ChangeRow, actor: Actor) {
  const d = (c.diff ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  if (c.kind === "UPDATE") {
    if (!c.userId) throw new Error("대상 직원이 없습니다.");
    return applyUpdate(c.userId, (d.fields ?? {}) as Fields, actor);
  }
  if (c.kind === "HIRE") {
    const missing = Array.isArray(d.missing) ? (d.missing as string[]) : [];
    if (missing.length) throw new Error(`${missing.join("·")}이(가) 없어 계정을 만들 수 없습니다. 명부에서 채운 뒤 다음 가져오기를 기다리거나 직원 관리에서 직접 등록해주세요.`);
    const email = s(d.email).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("회사 이메일 형식이 올바르지 않습니다.");
    if (await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } }))
      throw new Error(`이미 ${email} 계정이 있습니다. 사번이 다르게 들어간 같은 사람인지 직원 관리에서 확인해주세요.`);
    if (await prisma.user.findUnique({ where: { empNo: c.empNo }, select: { id: true } })) throw new Error(`사번 ${c.empNo} 을(를) 이미 다른 직원이 쓰고 있습니다.`);
    const branch = s(d.branch);
    if (!(await prisma.branch.findFirst({ where: { name: branch }, select: { id: true } }))) throw new Error(`큐브티에 없는 지점입니다: ${branch}`);
    const hashed = await bcrypt.hash(TEMP_PASSWORD, 10);
    // 계정과 연차 행을 함께 — 하나만 만들어지면 재시도가 "이미 계정 있음"으로 영구히 막힌다(L3)
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: c.name, email, password: hashed, passwordResetAt: new Date(), empNo: c.empNo,
          role: "EMPLOYEE", jobGroup: s(d.jobGroup) || null, position: s(d.position) || null, branch,
          hireDate: s(d.hireDate) ? utcDate(s(d.hireDate)) : null,
          employmentStatus: d.onLeave ? "ON_LEAVE" : "ACTIVE",
        },
      });
      // 연차 행 — 직원 등록(POST /api/employees)과 같은 방식
      await tx.leaveBalance.create({ data: { userId: created.id, year: currentLeaveYear(), total: 15, used: 0, remaining: 15 } });
      return created;
    });
    await logAudit({ actorId: actor.id, actorName: actor.name, action: "EMPLOYEE_CREATE", targetType: "USER", targetId: user.id, targetName: user.name, detail: `인사명부 입사 반영 (${branch}, 사번 ${c.empNo}, 임시 비밀번호)` });
    return;
  }
  if (!c.userId) throw new Error("대상 직원이 없습니다.");
  const u = await prisma.user.findUnique({ where: { id: c.userId }, select: stateSelect });
  if (!u || u.deletedAt) throw new Error("직원을 찾을 수 없습니다.");
  if (u.role === "ADMIN") throw new Error("관리자 계정은 연동으로 바꾸지 않습니다.");
  const cs = cubeteeState(u);
  const changed = () => new Error("그사이 큐브티에서 상태가 바뀌었습니다. 다음 가져오기에서 다시 확인해주세요.");

  if (c.kind === "RESIGN") {
    const rd = s(d.resignDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rd)) throw new Error("퇴사일이 올바르지 않습니다.");
    if (cs === "RESIGNED" || cs === "DISABLED") throw changed();
    const date = utcDate(rd);
    const past = date < kstTodayMidnight(); // 퇴사일 당일은 아직 재직(직원 수정 PATCH 와 같은 기준)
    await prisma.user.update({
      where: { id: u.id },
      // 미래 퇴사일이면 지금 상태(휴직 등)를 그대로 둔다 — 날짜가 지나면 조회 시점에 퇴직자로 잡힌다
      data: { resignDate: date, resignReason: "인사명부 퇴사", ...(past ? { employmentStatus: "RESIGNED", isActive: false } : {}) },
    });
    await bumpTokenVersion(u.id).catch(() => {});
    await syncMainManagerFor(u.id);
    await logAudit({ actorId: actor.id, actorName: actor.name, action: "EMPLOYEE_RESIGN", targetType: "USER", targetId: u.id, targetName: u.name, detail: `인사명부 퇴사 반영 (${rd})` });
    return;
  }
  if (c.kind === "LEAVE") {
    if (cs !== "ACTIVE") throw changed();
    await prisma.user.update({ where: { id: u.id }, data: { employmentStatus: "ON_LEAVE" } });
    await logAudit({ actorId: actor.id, actorName: actor.name, action: "EMPLOYEE_UPDATE", targetType: "USER", targetId: u.id, targetName: u.name, detail: "인사명부 휴직 반영" });
    return;
  }
  if (c.kind === "RETURN") {
    const fromResigned = d.from === "RESIGNED";
    if (fromResigned ? cs !== "RESIGNED" : cs !== "LEAVE") throw changed();
    await prisma.user.update({
      where: { id: u.id },
      // 재입사 — 퇴사일을 비워야 로그인이 풀린다(직원 수정에서 퇴사일을 지우는 것과 같은 동작)
      data: fromResigned
        ? { resignDate: null, resignReason: null, employmentStatus: d.to === "LEAVE" ? "ON_LEAVE" : "ACTIVE", isActive: true }
        : { employmentStatus: "ACTIVE" },
    });
    if (fromResigned) {
      await syncMainManagerFor(u.id);
      clearSessionCache(u.id); // 되살렸는데 "비활성" 캐시가 30초 남아 있으면 그동안 로그인이 안 된다(restore 와 같게)
    }
    await logAudit({ actorId: actor.id, actorName: actor.name, action: fromResigned ? "EMPLOYEE_RESTORE" : "EMPLOYEE_UPDATE", targetType: "USER", targetId: u.id, targetName: u.name, detail: fromResigned ? `인사명부 재입사 반영 — 퇴사일 ${dstr(u.resignDate)} 해제, 계정 다시 켬` : "인사명부 복직 반영" });
    return;
  }
  if (c.kind === "LINK") {
    const to = Number(d.toEmpNo);
    if (!Number.isInteger(to) || to <= 0) throw new Error("사번이 올바르지 않습니다.");
    if ((u.empNo ?? null) !== ((d.fromEmpNo as number | null) ?? null)) throw changed();
    const dup = await prisma.user.findUnique({ where: { empNo: to }, select: { id: true, name: true } });
    if (dup && dup.id !== u.id) throw new Error(`사번 ${to} 을(를) 이미 ${dup.name}님이 쓰고 있습니다.`);
    await prisma.user.update({ where: { id: u.id }, data: { empNo: to } });
    await logAudit({ actorId: actor.id, actorName: actor.name, action: "EMPLOYEE_UPDATE", targetType: "USER", targetId: u.id, targetName: u.name, detail: `명부 사번 연결 ${s(d.fromEmpNo) || "-"}→${to}` });
    return;
  }
  throw new Error("알 수 없는 항목입니다.");
}

/** 확인 대기 한 건 반영/무시. 두 사람이 동시에 눌러도 한 번만 처리된다(PENDING → APPLYING 을 원자적으로 잡는다). */
export async function decideChange(id: string, action: "apply" | "dismiss", actor: Actor): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const c = await prisma.portalSyncChange.findUnique({ where: { id }, select: { id: true, kind: true, empNo: true, name: true, userId: true, diff: true, status: true } });
  if (!c) return { ok: false, error: "항목을 찾을 수 없습니다.", status: 404 };
  const claimed = await prisma.portalSyncChange.updateMany({
    where: { id, status: "PENDING" },
    data: { status: action === "apply" ? "APPLYING" : "DISMISSED", decidedBy: actor.name, decidedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, error: "이미 처리됐거나 처리 중인 항목입니다.", status: 409 };
  if (action === "dismiss") {
    await logAudit({ actorId: actor.id, actorName: actor.name, action: "PORTAL_SYNC_DISMISS", targetType: "USER", targetId: c.userId, targetName: c.name, detail: `인사명부 ${c.kind} 무시 (사번 ${c.empNo})` });
    return { ok: true };
  }
  try {
    await applyChange(c, actor);
    await prisma.portalSyncChange.update({ where: { id }, data: { status: "DONE" } });
    return { ok: true };
  } catch (e) {
    await prisma.portalSyncChange.update({ where: { id }, data: { status: "PENDING", decidedBy: null, decidedAt: null } }).catch(() => {});
    return { ok: false, error: (e as Error).message || "반영하지 못했습니다.", status: 400 };
  }
}

// ── 실행 ───────────────────────────────────────────────────
const g = globalThis as unknown as { __portalSyncRunning?: boolean };
export type RunResult = { runId: string | null; ok: boolean; busy?: boolean; error?: string; applied: number; pending: number; newPending: number; skipped: number };

export async function runPortalSync(trigger: "AUTO" | "MANUAL", actor: Actor = SYSTEM_ACTOR): Promise<RunResult> {
  if (g.__portalSyncRunning) return { runId: null, ok: false, busy: true, error: "이미 가져오는 중입니다. 잠시 뒤 다시 시도해주세요.", applied: 0, pending: 0, newPending: 0, skipped: 0 };
  g.__portalSyncRunning = true;
  let runId: string | null = null;
  try {
    // 반영 도중 프로세스가 죽어(배포 재시작 등) APPLYING 에 멈춘 항목을 확인 대기로 되돌린다(M3).
    // 되돌려도 안전하다 — 반영 단계마다 현재 상태·중복을 다시 확인하므로 두 번 적용되지 않는다.
    await prisma.portalSyncChange.updateMany({ where: { status: "APPLYING", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: "PENDING", decidedBy: null, decidedAt: null } });
    const run = await prisma.portalSyncRun.create({ data: { trigger, actorName: actor.name } });
    runId = run.id;
    const cfg = await portalConfig();
    if (!cfg) throw new Error("인사명부 연결 정보가 없습니다.");
    const rows = await fetchPortalRoster(cfg);
    // 0명이면 큐브티 재직자 전원이 "명부에 없음"이 된다 — 설정 사고로 보고 멈춘다
    if (!rows.length) throw new Error("인사명부에서 0명을 받았습니다. 공유·권한 설정을 확인해주세요.");
    // 퇴사자 탭은 못 읽어도 나머지 동기화는 한다 — 대신 퇴사 건은 "퇴사일 모름"으로 건너뛰고 사유를 남긴다
    let leavers: LeaverRow[] = [];
    let leaversError = "";
    if (cfg.leaversUrl) {
      try { leavers = await fetchSheetLeavers(cfg.leaversUrl); }
      catch (e) { leaversError = (e as Error)?.message || String(e); }
    }
    const plan = await planPortalSync(rows, leavers);
    if (leaversError) plan.skipped.unshift({ portalId: "-", name: "퇴사자 탭", reason: `읽지 못했습니다 — ${leaversError}` });
    const auto = await isAutoApply();
    let applied = 0, pending = 0, newPending = 0;
    const keep = new Set<string>();

    for (const p of plan.plans) {
      const sig = sigOf(p);
      // 본부가 "무시"한 같은 내용은 다시 올리지 않는다(포털 값이 또 바뀌면 새 내용이라 다시 올라온다)
      if (await prisma.portalSyncChange.findFirst({ where: { sig, status: "DISMISSED" }, select: { id: true } })) continue;
      const diff = p.diff as Prisma.InputJsonValue;
      if (p.kind === "UPDATE" && auto && !p.forceConfirm && p.userId) {
        try {
          await applyUpdate(p.userId, p.diff.fields as Fields, actor);
          await prisma.portalSyncChange.create({ data: { runId: run.id, empNo: p.empNo, portalId: p.portalId, name: p.name, userId: p.userId, kind: p.kind, diff, sig, status: "APPLIED", decidedBy: actor.name, decidedAt: new Date() } });
          applied++;
        } catch (e) {
          plan.skipped.push({ portalId: p.portalId, name: p.name, reason: `반영 실패: ${(e as Error).message}` });
        }
        continue;
      }
      keep.add(`${p.empNo}|${p.kind}`);
      // 처리 중(APPLYING)인 것도 "있음"으로 본다 — 옆에 같은 항목을 또 만들지 않게
      const existing = await prisma.portalSyncChange.findFirst({ where: { empNo: p.empNo, kind: p.kind, status: { in: ["PENDING", "APPLYING"] } }, select: { id: true, sig: true, status: true } });
      if (existing) {
        if (existing.status === "PENDING" && existing.sig !== sig) await prisma.portalSyncChange.update({ where: { id: existing.id }, data: { runId: run.id, diff, sig, name: p.name, userId: p.userId, portalId: p.portalId } });
      } else {
        await prisma.portalSyncChange.create({ data: { runId: run.id, empNo: p.empNo, portalId: p.portalId, name: p.name, userId: p.userId, kind: p.kind, diff, sig, status: "PENDING" } });
        newPending++;
      }
      pending++;
    }
    // 이번에 다시 나오지 않은 확인 대기는 포털 값이 바뀌었거나 이미 맞춰진 것 — 치운다
    const open = await prisma.portalSyncChange.findMany({ where: { status: "PENDING" }, select: { id: true, empNo: true, kind: true } });
    const stale = open.filter((c) => !keep.has(`${c.empNo}|${c.kind}`)).map((c) => c.id);
    if (stale.length) await prisma.portalSyncChange.updateMany({ where: { id: { in: stale }, status: "PENDING" }, data: { status: "SUPERSEDED" } });
    // [무시]는 그 상황이 이어지는 동안만 — (사번, 종류)가 이번에 안 나오면 만료시켜, 다음에 다시 휴직·복직하면 새로 올라오게(검증관 4차 낮음 4)
    const planned = new Set(plan.plans.map((p) => `${p.empNo}|${p.kind}`));
    const dismissed = await prisma.portalSyncChange.findMany({ where: { status: "DISMISSED" }, select: { id: true, empNo: true, kind: true } });
    const expire = dismissed.filter((c) => !planned.has(`${c.empNo}|${c.kind}`)).map((c) => c.id);
    if (expire.length) await prisma.portalSyncChange.updateMany({ where: { id: { in: expire }, status: "DISMISSED" }, data: { status: "EXPIRED" } });

    await prisma.portalSyncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(), ok: true, fetched: plan.fetched, matched: plan.matched, applied, pending, skipped: plan.skipped.length,
        summary: { skipped: plan.skipped, roleMismatch: plan.roleMismatch, missingInPortal: plan.missingInPortal } as Prisma.InputJsonValue,
      },
    });
    return { runId: run.id, ok: true, applied, pending, newPending, skipped: plan.skipped.length };
  } catch (e) {
    const msg = ((e as Error).message || String(e)).slice(0, 500);
    if (runId) await prisma.portalSyncRun.update({ where: { id: runId }, data: { finishedAt: new Date(), ok: false, error: msg } }).catch(() => {});
    return { runId, ok: false, error: msg, applied: 0, pending: 0, newPending: 0, skipped: 0 };
  } finally {
    g.__portalSyncRunning = false;
  }
}

/** 매일 06:30 봇 틱에서 부른다. 연결 전에는 조용히 건너뛴다. 실패·새 확인 대기는 본부에 봇 DM. */
export async function runPortalSyncDaily() {
  if (!(await portalConfig())) return;
  const r = await runPortalSync("AUTO");
  // 수동 가져오기가 돌고 있으면 그게 오늘 몫을 한다 — 실패로 알리지 않는다(L8)
  if (r.busy) return;
  if (r.ok && r.newPending === 0) return;
  const { botSendDM } = await import("@/lib/bot");
  const { getAppUrl } = await import("@/lib/app-url");
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true, deletedAt: null, AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }] }] },
    select: { id: true },
  });
  const link = `${getAppUrl()}/admin/portal-sync`;
  let msg: string;
  if (!r.ok) msg = `⚠️ 인사명부를 가져오지 못했습니다.\n${r.error}\n→ ${link}`;
  else {
    const rows = await prisma.portalSyncChange.groupBy({ by: ["kind"], where: { status: "PENDING" }, _count: { _all: true } });
    const label: Record<string, string> = { UPDATE: "정보 변경", HIRE: "입사", RESIGN: "퇴사", LEAVE: "휴직", RETURN: "복직", LINK: "사번 연결" };
    msg = `🔄 인사명부 확인 대기 ${r.pending}건 (${rows.map((x) => `${label[x.kind] ?? x.kind} ${x._count._all}`).join(" · ")})\n반영 전에는 큐브티에 바뀌지 않습니다.\n→ ${link}`;
  }
  for (const a of admins) await botSendDM(a.id, msg);
}
