// 포털(직영인사) 인원명부 → 큐브티 한 방향 동기화 (2026-09-15 디렉터 결정)
//
//  · 포털은 건드리지 않는다. 포털 담당자가 만든 **읽기 전용 뷰(cubetee_roster)** 를 하루 한 번 읽는다.
//  · 열쇠는 사번 — 포털 ems_id "02512" ↔ 큐브티 User.empNo 2512.
//  · 일반 칸(이름·지점·직책·직급·입사일)은 본부가 "자동 반영"을 켜 두면 바로 반영, 꺼져 있으면 확인 대기.
//  · 입사·퇴사·휴직·복직·사번 연결은 로그인·결재선이 따라 바뀌므로 **본부 확인 1클릭 뒤에만**.
//  · 사번은 같은데 이름이 다르면(다른 사람일 수 있음) 자동 반영하지 않고 확인으로 돌린다.
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { bumpTokenVersion } from "@/lib/auth";
import { syncMainManagerFor } from "@/lib/manager-branches";
import { logAudit } from "@/lib/audit";
import { isResigned, kstTodayMidnight } from "@/lib/resign";
import { currentLeaveYear } from "@/lib/leave-calc";

export const PORTAL_SETTING = { url: "portalRosterUrl", apikey: "portalRosterApiKey", token: "portalRosterToken", auto: "portalSyncAutoApply" } as const;
export const SYSTEM_ACTOR = { id: "system:portal-sync", name: "포털 인원명부 연동" };
// 입사 반영 시 임시 비밀번호 — 관리자 비밀번호 초기화와 같은 값·같은 규칙(24시간 뒤 봇이 변경 요청)
const TEMP_PASSWORD = "12345678";

export type Kind = "UPDATE" | "HIRE" | "RESIGN" | "LEAVE" | "RETURN" | "LINK";
type Actor = { id: string; name: string };
type FieldKey = "name" | "branch" | "jobGroup" | "position" | "hireDate";
export type Fields = Partial<Record<FieldKey, [string | null, string]>>;

// ── 연결 설정 ───────────────────────────────────────────────
type Cfg = { url: string; apikey: string; token: string };
async function setting(key: string): Promise<string> {
  const r = await prisma.appSetting.findUnique({ where: { key } });
  return r?.value ?? "";
}
export async function portalConfig(): Promise<Cfg | null> {
  const [url, apikey, token] = await Promise.all([setting(PORTAL_SETTING.url), setting(PORTAL_SETTING.apikey), setting(PORTAL_SETTING.token)]);
  if (!url || !apikey) return null;
  return { url, apikey, token: token || apikey };
}
export async function isAutoApply(): Promise<boolean> {
  return (await setting(PORTAL_SETTING.auto)) === "1";
}
/** 연결 주소 검사 — https 이고 Supabase REST 경로여야 한다(오타로 엉뚱한 곳에 키를 보내지 않게) */
export function validRosterUrl(url: string): boolean {
  try { const u = new URL(url); return u.protocol === "https:" && u.pathname.includes("/rest/v1/"); } catch { return false; }
}

// ── 포털 읽기 ───────────────────────────────────────────────
export type PortalRow = {
  portalId: string; empNo: number | null; name: string; status: string; job: string; position: string;
  branch: string; joinDate: string; leaveDate: string; email: string;
};
const t = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const dateOnly = (v: unknown) => {
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(t(v));
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
};

export async function fetchPortalRoster(cfg: Cfg): Promise<PortalRow[]> {
  if (!validRosterUrl(cfg.url)) throw new Error("연결 주소가 올바르지 않습니다(https://…/rest/v1/… 형식이어야 합니다).");
  const u = new URL(cfg.url);
  u.searchParams.set("select", "*");
  const res = await fetch(u, {
    headers: { apikey: cfg.apikey, Authorization: `Bearer ${cfg.token}`, Accept: "application/json", Prefer: "count=exact" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`포털 응답 ${res.status}${body ? ` — ${body}` : ""}`);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error("포털 응답이 목록 형식이 아닙니다.");
  // PostgREST 는 최대 행 수를 넘으면 조용히 자른다 — 일부만 받고 "포털에 없음"으로 오판하지 않게 전체 수를 대조
  const total = Number((res.headers.get("content-range") || "").split("/")[1]);
  if (Number.isFinite(total) && total > data.length)
    throw new Error(`포털 인원 ${total}명 중 ${data.length}명만 받았습니다. 포털 담당자에게 조회 최대 행 수를 늘려 달라고 요청해주세요.`);
  if (data.length > 5000) throw new Error(`포털 응답이 너무 큽니다(${data.length}행).`);
  return (data as Record<string, unknown>[]).map((r) => {
    const portalId = t(r.ems_id);
    const digits = portalId.replace(/\D/g, "");
    const n = digits ? parseInt(digits, 10) : NaN;
    return {
      portalId,
      empNo: Number.isInteger(n) && n > 0 ? n : null,
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

/** 포털 직무(+직급) → 큐브티 직책(원장·CM·TM·코디·학습실장·튜터). 모르면 null(반영하지 않음) */
export function mapJobGroup(job: string, position: string): string | null {
  if (job.includes("부원장")) return "CM";
  if (job.includes("원장")) return "원장";
  if (job.includes("코디")) return "코디";
  if (job.includes("학습실장")) return "학습실장";
  if (job.includes("튜터")) return "튜터";
  if (job.includes("교실장")) return "TM";
  if (/코칭|매니저|코치/.test(job)) return position.includes("교실장") ? "TM" : "CM";
  if (/교육생|인턴/.test(job)) {
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
function cubeteeState(u: CUser): "ACTIVE" | "LEAVE" | "RESIGNED" {
  if (!u.isActive || u.employmentStatus === "RESIGNED" || isResigned(u.resignDate)) return "RESIGNED";
  return u.employmentStatus === "ON_LEAVE" ? "LEAVE" : "ACTIVE";
}
const dstr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

// ── 비교(계획) ─────────────────────────────────────────────
export type Plan = { kind: Kind; empNo: number; portalId: string; name: string; userId: string | null; diff: Record<string, unknown>; forceConfirm?: boolean };
type Skip = { portalId: string; name: string; reason: string };
export type PlanResult = {
  plans: Plan[]; skipped: Skip[];
  roleMismatch: { empNo: number; name: string; branch: string | null }[];
  missingInPortal: { empNo: number | null; name: string; branch: string | null }[];
  fetched: number; matched: number;
};

export async function planPortalSync(rows: PortalRow[]): Promise<PlanResult> {
  const [users, branchRows] = await Promise.all([
    prisma.user.findMany({ where: { deletedAt: null, role: { not: "ADMIN" } }, select: userSelect }),
    prisma.branch.findMany({ select: { name: true, countInStats: true } }),
  ]);
  const known = new Set(branchRows.map((b) => b.name));
  const notCounted = new Set(branchRows.filter((b) => !b.countInStats).map((b) => b.name)); // 본부·테스트지점 — "포털에 없음" 목록에서 뺀다
  const byEmp = new Map<number, CUser>();
  for (const u of users) if (u.empNo != null) byEmp.set(u.empNo, u);

  const plans: Plan[] = [];
  const skipped: Skip[] = [];
  const roleMismatch: PlanResult["roleMismatch"] = [];
  const dupCount = new Map<number, number>();
  for (const r of rows) if (r.empNo) dupCount.set(r.empNo, (dupCount.get(r.empNo) ?? 0) + 1);
  const seen = new Set<string>();
  const unmatched: PortalRow[] = [];

  for (const r of rows) {
    const base = { empNo: r.empNo ?? 0, portalId: r.portalId, name: r.name };
    if (!r.empNo) { skipped.push({ portalId: r.portalId, name: r.name, reason: "사번 없음" }); continue; }
    if ((dupCount.get(r.empNo) ?? 0) > 1) { skipped.push({ portalId: r.portalId, name: r.name, reason: "포털에 같은 사번이 여러 명" }); continue; }
    const ps = portalState(r);
    if (ps === "OTHER") { skipped.push({ portalId: r.portalId, name: r.name, reason: `알 수 없는 상태: ${r.status || "(빈 값)"}` }); continue; }
    const u = byEmp.get(r.empNo);
    if (!u) { if (ps !== "RESIGNED") unmatched.push(r); continue; }
    seen.add(u.id);
    const cs = cubeteeState(u);

    if (cs === "RESIGNED") {
      if (ps === "ACTIVE" || ps === "LEAVE") plans.push({ ...base, kind: "RETURN", userId: u.id, diff: { from: "RESIGNED", to: ps } });
      continue; // 퇴사자의 일반 칸은 건드리지 않는다
    }
    if (ps === "RESIGNED") {
      const rd = r.leaveDate || dstr(kstTodayMidnight());
      if (dstr(u.resignDate) !== rd) plans.push({ ...base, kind: "RESIGN", userId: u.id, diff: { resignDate: rd, portalStatus: r.status } });
      continue;
    }
    if (ps === "LEAVE" && cs === "ACTIVE") plans.push({ ...base, kind: "LEAVE", userId: u.id, diff: { portalStatus: r.status } });
    if (ps === "ACTIVE" && cs === "LEAVE") plans.push({ ...base, kind: "RETURN", userId: u.id, diff: { from: "LEAVE", to: "ACTIVE" } });

    // 일반 칸
    const fields: Fields = {};
    if (r.name && r.name !== u.name) fields.name = [u.name, r.name];
    const mb = mapBranch(r.branch, known);
    if (mb.reason) skipped.push({ portalId: r.portalId, name: r.name, reason: mb.reason });
    else if (mb.value && mb.value !== u.branch) fields.branch = [u.branch, mb.value];
    const jg = mapJobGroup(r.job, r.position);
    if (!jg && r.job) skipped.push({ portalId: r.portalId, name: r.name, reason: `직무 대응 없음: ${r.job}${r.position ? `/${r.position}` : ""}` });
    else if (jg && jg !== u.jobGroup) fields.jobGroup = [u.jobGroup, jg];
    if (jg === "원장" && u.role !== "MANAGER") roleMismatch.push({ empNo: r.empNo, name: u.name, branch: u.branch });
    const pos = mapPosition(r.position);
    if (pos && pos !== u.position) fields.position = [u.position, pos];
    if (r.joinDate && r.joinDate !== dstr(u.hireDate)) fields.hireDate = [dstr(u.hireDate) || null, r.joinDate];
    if (Object.keys(fields).length) {
      const nameMismatch = !!fields.name;
      plans.push({ ...base, kind: "UPDATE", userId: u.id, diff: { fields, nameMismatch }, forceConfirm: nameMismatch });
    }
  }

  // 포털에만 있는 재직자 → 사번이 다르게 들어간 같은 사람인지 먼저 찾는다(회사 이메일 → 이름+지점). 없으면 입사.
  const free = users.filter((u) => !seen.has(u.id) && cubeteeState(u) !== "RESIGNED");
  const linked = new Set<string>();
  for (const r of unmatched) {
    const mb = mapBranch(r.branch, known).value;
    let target: CUser | undefined = r.email ? free.find((u) => !linked.has(u.id) && u.email.toLowerCase() === r.email) : undefined;
    let by = "email";
    if (!target) {
      const cands = free.filter((u) => !linked.has(u.id) && u.name === r.name && (!mb || u.branch === mb));
      if (cands.length === 1) { target = cands[0]; by = "name"; }
    }
    const base = { empNo: r.empNo as number, portalId: r.portalId, name: r.name };
    if (target) {
      linked.add(target.id);
      plans.push({ ...base, kind: "LINK", userId: target.id, diff: { fromEmpNo: target.empNo, toEmpNo: r.empNo, by, userName: target.name, userBranch: target.branch } });
      continue;
    }
    const missing: string[] = [];
    if (!r.email) missing.push("회사 이메일");
    if (!mb) missing.push("지점");
    plans.push({
      ...base, kind: "HIRE", userId: null,
      diff: { email: r.email || null, branch: mb, portalBranch: r.branch, jobGroup: mapJobGroup(r.job, r.position), position: mapPosition(r.position), hireDate: r.joinDate || null, onLeave: portalState(r) === "LEAVE", missing },
    });
  }

  const missingInPortal = free
    .filter((u) => !linked.has(u.id) && !(u.branch && notCounted.has(u.branch)))
    .map((u) => ({ empNo: u.empNo, name: u.name, branch: u.branch }));
  return { plans, skipped, roleMismatch, missingInPortal, fetched: rows.length, matched: seen.size };
}

function sigOf(p: Plan): string {
  const target = p.kind === "UPDATE"
    ? Object.entries((p.diff.fields ?? {}) as Fields).map(([k, v]) => [k, v?.[1]]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    : p.diff;
  return createHash("sha256").update(`${p.kind}|${p.empNo}|${JSON.stringify(target)}`).digest("hex").slice(0, 32);
}

// ── 반영 ───────────────────────────────────────────────────
const utcDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function applyUpdate(userId: string, fields: Fields, actor: Actor) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, branch: true, deletedAt: true } });
  if (!u || u.deletedAt) throw new Error("직원을 찾을 수 없습니다.");
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
  await logAudit({ actorId: actor.id, actorName: actor.name, action: "EMPLOYEE_UPDATE", targetType: "USER", targetId: userId, targetName: u.name, detail: `포털 인원명부 반영 — ${detail}` });
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
    if (missing.length) throw new Error(`${missing.join("·")}이(가) 없어 계정을 만들 수 없습니다. 포털에서 채운 뒤 다음 가져오기를 기다리거나 직원 관리에서 직접 등록해주세요.`);
    const email = s(d.email).toLowerCase();
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) throw new Error(`이미 ${email} 계정이 있습니다. 사번이 다르게 들어간 같은 사람인지 직원 관리에서 확인해주세요.`);
    if (await prisma.user.findUnique({ where: { empNo: c.empNo }, select: { id: true } })) throw new Error(`사번 ${c.empNo} 을(를) 이미 다른 직원이 쓰고 있습니다.`);
    const branch = s(d.branch);
    if (!(await prisma.branch.findFirst({ where: { name: branch }, select: { id: true } }))) throw new Error(`큐브티에 없는 지점입니다: ${branch}`);
    const user = await prisma.user.create({
      data: {
        name: c.name, email, password: await bcrypt.hash(TEMP_PASSWORD, 10), passwordResetAt: new Date(), empNo: c.empNo,
        role: "EMPLOYEE", jobGroup: s(d.jobGroup) || null, position: s(d.position) || null, branch,
        hireDate: s(d.hireDate) ? utcDate(s(d.hireDate)) : null,
        employmentStatus: d.onLeave ? "ON_LEAVE" : "ACTIVE",
      },
    });
    // 연차 행 — 직원 등록(POST /api/employees)과 같은 방식
    await prisma.leaveBalance.create({ data: { userId: user.id, year: currentLeaveYear(), total: 15, used: 0, remaining: 15 } });
    await logAudit({ actorId: actor.id, actorName: actor.name, action: "EMPLOYEE_CREATE", targetType: "USER", targetId: user.id, targetName: user.name, detail: `포털 인원명부 입사 반영 (${branch}, 사번 ${c.empNo}, 임시 비밀번호)` });
    return;
  }
  if (!c.userId) throw new Error("대상 직원이 없습니다.");
  const u = await prisma.user.findUnique({ where: { id: c.userId }, select: { id: true, name: true, role: true, deletedAt: true, resignDate: true } });
  if (!u || u.deletedAt) throw new Error("직원을 찾을 수 없습니다.");
  if (u.role === "ADMIN") throw new Error("관리자 계정은 연동으로 바꾸지 않습니다.");

  if (c.kind === "RESIGN") {
    const rd = s(d.resignDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rd)) throw new Error("퇴사일이 올바르지 않습니다.");
    const date = utcDate(rd);
    const past = date < kstTodayMidnight(); // 퇴사일 당일은 아직 재직(직원 수정 PATCH 와 같은 기준)
    await prisma.user.update({
      where: { id: u.id },
      data: { resignDate: date, resignReason: "포털 인원명부 퇴사", employmentStatus: past ? "RESIGNED" : "ACTIVE", ...(past ? { isActive: false } : {}) },
    });
    await bumpTokenVersion(u.id).catch(() => {});
    await syncMainManagerFor(u.id);
    await logAudit({ actorId: actor.id, actorName: actor.name, action: "EMPLOYEE_RESIGN", targetType: "USER", targetId: u.id, targetName: u.name, detail: `포털 인원명부 퇴사 반영 (${rd})` });
    return;
  }
  if (c.kind === "LEAVE") {
    await prisma.user.update({ where: { id: u.id }, data: { employmentStatus: "ON_LEAVE" } });
    await logAudit({ actorId: actor.id, actorName: actor.name, action: "EMPLOYEE_UPDATE", targetType: "USER", targetId: u.id, targetName: u.name, detail: "포털 인원명부 휴직 반영" });
    return;
  }
  if (c.kind === "RETURN") {
    const fromResigned = d.from === "RESIGNED";
    await prisma.user.update({
      where: { id: u.id },
      data: fromResigned
        ? { resignDate: null, resignReason: null, employmentStatus: d.to === "LEAVE" ? "ON_LEAVE" : "ACTIVE", isActive: true }
        : { employmentStatus: "ACTIVE" },
    });
    if (fromResigned) await syncMainManagerFor(u.id);
    await logAudit({ actorId: actor.id, actorName: actor.name, action: fromResigned ? "EMPLOYEE_RESTORE" : "EMPLOYEE_UPDATE", targetType: "USER", targetId: u.id, targetName: u.name, detail: fromResigned ? "포털 인원명부 재직 확인 — 계정 다시 켬" : "포털 인원명부 복직 반영" });
    return;
  }
  if (c.kind === "LINK") {
    const to = Number(d.toEmpNo);
    if (!Number.isInteger(to) || to <= 0) throw new Error("사번이 올바르지 않습니다.");
    const dup = await prisma.user.findUnique({ where: { empNo: to }, select: { id: true, name: true } });
    if (dup && dup.id !== u.id) throw new Error(`사번 ${to} 을(를) 이미 ${dup.name}님이 쓰고 있습니다.`);
    await prisma.user.update({ where: { id: u.id }, data: { empNo: to } });
    await logAudit({ actorId: actor.id, actorName: actor.name, action: "EMPLOYEE_UPDATE", targetType: "USER", targetId: u.id, targetName: u.name, detail: `포털 사번 연결 ${s(d.fromEmpNo) || "-"}→${to}` });
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
  if (claimed.count === 0) return { ok: false, error: "이미 처리된 항목입니다.", status: 409 };
  if (action === "dismiss") {
    await logAudit({ actorId: actor.id, actorName: actor.name, action: "PORTAL_SYNC_DISMISS", targetType: "USER", targetId: c.userId, targetName: c.name, detail: `포털 인원명부 ${c.kind} 무시 (사번 ${c.empNo})` });
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
export type RunResult = { runId: string | null; ok: boolean; error?: string; applied: number; pending: number; newPending: number; skipped: number };

export async function runPortalSync(trigger: "AUTO" | "MANUAL", actor: Actor = SYSTEM_ACTOR): Promise<RunResult> {
  if (g.__portalSyncRunning) return { runId: null, ok: false, error: "이미 가져오는 중입니다. 잠시 뒤 다시 시도해주세요.", applied: 0, pending: 0, newPending: 0, skipped: 0 };
  g.__portalSyncRunning = true;
  let runId: string | null = null;
  try {
    const run = await prisma.portalSyncRun.create({ data: { trigger, actorName: actor.name } });
    runId = run.id;
    const cfg = await portalConfig();
    if (!cfg) throw new Error("포털 연결 정보가 없습니다.");
    const rows = await fetchPortalRoster(cfg);
    // 0명이면 큐브티 재직자 전원이 "포털에 없음"이 된다 — 설정 사고로 보고 멈춘다
    if (!rows.length) throw new Error("포털에서 0명을 받았습니다. 뷰·권한 설정을 확인해주세요.");
    const plan = await planPortalSync(rows);
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
      const existing = await prisma.portalSyncChange.findFirst({ where: { empNo: p.empNo, kind: p.kind, status: "PENDING" }, select: { id: true, sig: true } });
      if (existing) {
        if (existing.sig !== sig) await prisma.portalSyncChange.update({ where: { id: existing.id }, data: { runId: run.id, diff, sig, name: p.name, userId: p.userId, portalId: p.portalId } });
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
  if (r.ok && r.newPending === 0) return;
  const { botSendDM } = await import("@/lib/bot");
  const { getAppUrl } = await import("@/lib/app-url");
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true, deletedAt: null, AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }] }] },
    select: { id: true },
  });
  const link = `${getAppUrl()}/admin/portal-sync`;
  let msg: string;
  if (!r.ok) msg = `⚠️ 포털 인원명부를 가져오지 못했습니다.\n${r.error}\n→ ${link}`;
  else {
    const rows = await prisma.portalSyncChange.groupBy({ by: ["kind"], where: { status: "PENDING" }, _count: { _all: true } });
    const label: Record<string, string> = { UPDATE: "정보 변경", HIRE: "입사", RESIGN: "퇴사", LEAVE: "휴직", RETURN: "복직", LINK: "사번 연결" };
    msg = `🔄 포털 인원명부 확인 대기 ${r.pending}건 (${rows.map((x) => `${label[x.kind] ?? x.kind} ${x._count._all}`).join(" · ")})\n반영 전에는 큐브티에 바뀌지 않습니다.\n→ ${link}`;
  }
  for (const a of admins) await botSendDM(a.id, msg);
}
