// 직영포털 인사카드 연락처 자동 채움(2026-10-12 개선 제안 #25, 본부 답변 33번·디렉터 채택)
//
//  · 원천: GET $PORTAL_HR_CONTACT_URL (Authorization: Bearer $PORTAL_HR_CONTACT_KEY) → { employees: [{ name, branch, address, birth_date, phone, ems_id, branch_assign_date }] }
//    branch_assign_date(version 3, 2026-10-28 이예지) = 인사카드 발령 기록의 최초 「지점발령」 날짜 = 지점 근무 시작일. 신입 집계 제외 기준(lib/route-course-server)
//  · 쓰임: 계약 문서를 만들 때(buildContractMergeData) 프로필(User.address·birthDate·phone)이 비어 있는 칸만 채운다.
//    **어디에도 저장하지 않고 화면에 목록으로 보여 주지 않는다**(본부 요청: 자동 채움에만 쓰고 따로 저장·노출 금지).
//  · 사람 맞추기: 이름(공백 제거) + 지점(큐브티 지점명으로 맞춘 뒤) 이 같은 사람. 그래도 하나가 아니면 이름만 유일할 때.
//  · 응답은 10분 동안 기억한다(계약 한 건 렌더마다 포털을 부르지 않게). 키가 없거나 포털이 죽어도 계약 작성은 그대로 된다(빈 칸으로).
import { prisma } from "@/lib/db";
import { mapBranch } from "@/lib/portal-roster";

export type HrContact = { address: string; birthDate: string; phone: string };   // 비면 ""
type Row = { name: string; branch: string; address: string; birthDate: string; phone: string; branchAssignDate: string };

const TTL_MS = 10 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;   // 실패도 1분은 기억 — 포털이 죽었을 때 렌더마다 8초씩 기다리지 않게(143693e 검증 P1)
let cache: { at: number; rows: Row[] } | null = null;
let failedAt = 0;
let inflight: Promise<Row[]> | null = null;

export function portalHrContactConfigured(): boolean {
  return !!(process.env.PORTAL_HR_CONTACT_URL && process.env.PORTAL_HR_CONTACT_KEY);
}

const normName = (s: string) => (s || "").replace(/\s+/g, "");
const ymd = (v: unknown): string => {
  if (typeof v !== "string") return "";
  const m = v.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return "";
  if (+m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return "";   // 달 · 일 범위 밖(「2026-13-45」)은 빈 값
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
};
const phoneOf = (v: unknown): string => {
  const d = typeof v === "string" ? v.replace(/[^0-9]/g, "") : "";
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return typeof v === "string" ? v.trim() : "";
};

async function loadRows(): Promise<Row[]> {
  const url = process.env.PORTAL_HR_CONTACT_URL; const key = process.env.PORTAL_HR_CONTACT_KEY;
  if (!url || !key) return [];
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  if (failedAt && now - failedAt < FAIL_TTL_MS) return cache?.rows ?? [];
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(8000), cache: "no-store" });
      if (!res.ok) { console.error("[portal-hr-contact] 응답", res.status); failedAt = Date.now(); return cache?.rows ?? []; }   // 실패하면 옛 기억이라도
      const d = (await res.json()) as { employees?: unknown };
      const known = new Set((await prisma.branch.findMany({ select: { name: true } })).map((b) => b.name));
      const rows: Row[] = [];
      for (const e of Array.isArray(d.employees) ? d.employees : []) {
        const o = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
        const name = typeof o.name === "string" ? normName(o.name) : "";
        if (!name) continue;
        const branchRaw = typeof o.branch === "string" ? o.branch.trim() : "";
        const branch = mapBranch(branchRaw, known).value ?? branchRaw;
        rows.push({ name, branch, address: typeof o.address === "string" ? o.address.trim() : "", birthDate: ymd(o.birth_date), phone: phoneOf(o.phone), branchAssignDate: ymd(o.branch_assign_date) });
      }
      cache = { at: Date.now(), rows }; failedAt = 0;
      return rows;
    } catch (e) {
      console.error("[portal-hr-contact] 가져오기 실패:", e instanceof Error ? e.name : "error");   // 값·본문은 적지 않는다
      failedAt = Date.now();
      return cache?.rows ?? [];
    } finally { inflight = null; }
  })();
  return inflight;
}

/** 직원 한 사람의 포털 인사카드 연락처. 못 찾으면 null */
export async function portalHrContactFor(user: { name: string; branch: string | null }): Promise<HrContact | null> {
  if (!portalHrContactConfigured()) return null;
  const rows = await loadRows();
  const n = normName(user.name); if (!n) return null;
  const byName = rows.filter((r) => r.name === n);
  if (byName.length === 0) return null;
  // 지점이 둘 다 있으면 반드시 같아야 한다 — 이름이 하나뿐이어도 지점이 다르면 다른 사람(신규 입사자가 포털에 아직 없을 때
  // 같은 이름의 다른 지점 사람 주소가 들어갔다, 143693e 검증 F1). 한쪽 지점이 비어 있을 때만 이름 유일성으로 본다
  const b = (user.branch || "").trim();
  const cands = b ? byName.filter((r) => !r.branch || r.branch === b) : byName;
  const row = cands.length === 1 ? cands[0] : null;
  if (!row) return null;   // 동명이인인데 지점으로도 못 가르면 채우지 않는다(남의 주소가 들어가면 안 된다)
  return { address: row.address, birthDate: row.birthDate, phone: row.phone };
}

/**
 * 지점 발령일(YYYY-MM-DD) — 여러 사람을 한 번에(출퇴근 집계가 매 화면마다 부른다 — 응답은 10분 기억이라 포털을 자주 부르지 않는다).
 * 사람 맞추기는 portalHrContactFor 와 같은 규칙(이름 + 지점). 없거나 못 가르면 빈 값 → 호출부가 입사일 · 수료일 규칙으로 돌아간다.
 * 창구가 꺼져 있으면(키 없음 · 실패) 빈 Map.
 */
export async function portalAssignDates(users: { id: string; name: string; branch: string | null }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!portalHrContactConfigured() || !users.length) return out;
  const rows = await loadRows();
  if (!rows.length) return out;
  for (const u of users) {
    const n = normName(u.name); if (!n) continue;
    const byName = rows.filter((r) => r.name === n);
    const b = (u.branch || "").trim();
    const cands = b ? byName.filter((r) => !r.branch || r.branch === b) : byName;
    if (cands.length === 1 && cands[0].branchAssignDate) out.set(u.id, cands[0].branchAssignDate);
  }
  return out;
}

/** 프로필이 비어 있어 포털이 채워 줄 수 있는 칸 이름(「주소」「생년월일」「연락처」) — 서명 화면의 입력 요청을 건너뛸 때 쓴다 */
export async function portalFillableFields(user: { name: string; branch: string | null; address: string | null; birthDate: Date | null; phone: string | null }): Promise<string[]> {
  if (!portalHrContactConfigured()) return [];
  if (user.address && user.birthDate && user.phone) return [];
  const hc = await portalHrContactFor(user);
  if (!hc) return [];
  const out: string[] = [];
  if (!user.address && hc.address) out.push("주소");
  if (!user.birthDate && hc.birthDate) out.push("생년월일");
  if (!user.phone && hc.phone) out.push("연락처");
  return out;
}
