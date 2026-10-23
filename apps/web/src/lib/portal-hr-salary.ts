// 직영포털 연봉 창구 → 재계약 작성 화면의 연봉 칸 기본값(2026-10-23 본부 이예지 답장 2번)
//
//  · 원천: GET $PORTAL_HR_SALARY_URL (Authorization: Bearer $PORTAL_HR_SALARY_KEY)
//    주소를 따로 두지 않으면 인사명부 창구 주소(PORTAL_HR_CONTACT_URL)의 끝 「hr-contact」를 「hr-salary」로 바꿔 쓴다(같은 포털 서버, **다른 키**).
//    항목: emp_no(사번) · ems_id · name · annual_salary(원 단위 정수 또는 null) · salary_from · salary_to — 오늘 이미 시작한 계약 중 가장 최근 계약의 연봉
//  · **큐브티에 저장하지 않는다**(본부 합의) — DB·파일에 쓰지 않고 메모리에만 5분 기억한다. 화면은 기본값으로만 채우고 사람이 확인해야 나간다.
//  · 보는 권한은 인사 › 연봉과 같다(lib/salary-access — API 쪽 assertSalaryAccess). 이 모듈은 권한을 보지 않으니 반드시 그 뒤에서만 부른다.
//  · 사람 맞추기: **포털 ems_id(EMS 사번 5자리)만** 본다(2026-10-23 이예지 답 — 포털 emp_no 는 큐브티 사번과 다른 번호라 비교하지 않는다).
//    큐브티 User.empNo 와 ems_id 가 같고(앞자리 0 무시) **이름도 같을 때만** 채운다(사번이 우연히 겹친 다른 사람 방지 — portal-roster 검증 H1).
//    사유 코드(reason): no_emp_no(큐브티 사번 없음) · not_found(포털에 그 ems_id 없음) · name_mismatch(같은 ems_id 인데 이름이 다름 — 화면 「확인 필요」)
//    · duplicate(같은 ems_id · 이름이 값이 다른 여러 줄). 사람이 읽는 말은 message.
//  · 키는 응답·로그 어디에도 내보내지 않는다. 실패 로그엔 상태 코드·오류 이름만. 서버(API)에서만 가져다 쓴다(화면 코드에서 import 금지).

export type PortalSalary = { amount: number | null; from: string; to: string };   // 날짜는 YYYY-MM-DD, 없으면 ""
type Row = PortalSalary & { emsNo: number; name: string };

const TTL_MS = 5 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;          // 실패도 1분은 기억 — 포털이 죽었을 때 화면마다 8초씩 기다리지 않게
const STALE_MAX_MS = 60 * 60 * 1000;    // 실패 때 옛 기억은 1시간까지만 쓴다(연봉은 오래된 값이 더 위험하다)
let cache: { at: number; rows: Row[] } | null = null;
let failedAt = 0;
let inflight: Promise<{ ok: boolean; rows: Row[] }> | null = null;

/** 연봉 창구 주소 — 따로 정한 주소가 없으면 인사명부 창구 주소에서 만든다 */
function salaryUrl(): string | null {
  const own = (process.env.PORTAL_HR_SALARY_URL || "").trim();
  if (own) return own;
  const base = (process.env.PORTAL_HR_CONTACT_URL || "").trim();
  if (!base) return null;
  try {
    const u = new URL(base);
    u.pathname = /hr-contact\/?$/.test(u.pathname) ? u.pathname.replace(/hr-contact\/?$/, "hr-salary") : "/api/export/hr-salary";
    u.search = ""; u.hash = "";
    return u.toString();
  } catch { return null; }
}

export function portalSalaryConfigured(): boolean {
  return !!(salaryUrl() && (process.env.PORTAL_HR_SALARY_KEY || "").trim());
}

const normName = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, "") : "");
const numId = (v: unknown): number | null => {
  const s = typeof v === "number" && Number.isInteger(v) ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,9}$/.test(s)) return null;   // 「A-0100」 같은 값은 숫자만 추려 엉뚱한 사람과 맞추지 않게 버린다
  const n = parseInt(s, 10);
  return n > 0 ? n : null;
};
const ymd = (v: unknown): string => {
  if (typeof v !== "string") return "";
  const m = v.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
};
const won = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*[\d,]+\s*$/.test(v) ? Number(v.replace(/[^0-9]/g, "")) : NaN;
  // 원 단위 정수만. 0·음수·10억 넘는 값은 잘못 들어온 값으로 보고 쓰지 않는다(직접 입력)
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 && n < 1_000_000_000 ? n : null;
};

/** 응답에서 사람 목록 찾기 — 배열이 맨 위이거나 employees·data·rows·items 아래(한 단계 더 감싼 것까지) */
function pickList(d: unknown): unknown[] | null {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const KEYS = ["employees", "data", "rows", "items", "salaries", "results", "result"];
  for (const k of KEYS) if (Array.isArray(o[k])) return o[k] as unknown[];
  for (const k of KEYS) {
    const inner = o[k];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      for (const k2 of KEYS) if (Array.isArray((inner as Record<string, unknown>)[k2])) return (inner as Record<string, unknown>)[k2] as unknown[];
    }
  }
  return null;
}

async function loadRows(): Promise<{ ok: boolean; rows: Row[] }> {
  const url = salaryUrl(); const key = (process.env.PORTAL_HR_SALARY_KEY || "").trim();
  if (!url || !key) return { ok: false, rows: [] };
  const now = Date.now();
  const stale = () => (cache && now - cache.at < STALE_MAX_MS ? { ok: true, rows: cache.rows } : { ok: false, rows: [] as Row[] });
  if (cache && now - cache.at < TTL_MS) return { ok: true, rows: cache.rows };
  if (failedAt && now - failedAt < FAIL_TTL_MS) return stale();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // redirect: "error" — 다른 곳으로 넘기면 키를 들고 따라가지 않는다
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(8000), cache: "no-store", redirect: "error" });
      if (!res.ok) { console.error("[portal-hr-salary] 응답", res.status); failedAt = Date.now(); return stale(); }
      const list = pickList(await res.json());
      if (!list || list.length > 20000) { console.error("[portal-hr-salary] 응답 모양이 예상과 다름"); failedAt = Date.now(); return stale(); }
      const rows: Row[] = [];
      for (const e of list) {
        const o = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
        const name = normName(o.name);
        const emsNo = numId(o.ems_id);   // 사람 맞추기는 ems_id 만(emp_no 는 읽지 않는다)
        if (!name || emsNo === null) continue;
        rows.push({ emsNo, name, amount: won(o.annual_salary), from: ymd(o.salary_from), to: ymd(o.salary_to) });
      }
      cache = { at: Date.now(), rows }; failedAt = 0;
      return { ok: true, rows };
    } catch (e) {
      console.error("[portal-hr-salary] 가져오기 실패:", e instanceof Error ? e.name : "error");   // 값·본문·키는 적지 않는다
      failedAt = Date.now();
      return stale();
    } finally { inflight = null; }
  })();
  return inflight;
}

// 이 저장소는 strict 가 꺼져 있어 합집합으로 좁혀지지 않는다 — 한 모양으로(lib/salary-access 와 같게). found=false 면 reason(코드) · message 만
export type PortalSalaryMissReason = "no_emp_no" | "not_found" | "name_mismatch" | "duplicate";
export type PortalSalaryLookup = { found: boolean; amount?: number | null; from?: string; to?: string; reason?: PortalSalaryMissReason; message?: string };

/**
 * 직원들의 포털 연봉. portal = "ok"(받음) · "fail"(포털 응답 없음 — 화면은 「직접 입력」) · "unconfigured"(키·주소 없음)
 * 반드시 연봉 권한 확인(assertSalaryAccess) 뒤에만 부른다.
 */
export async function portalSalaryFor(users: { id: string; empNo: number | null; name: string }[]): Promise<{ portal: "ok" | "fail" | "unconfigured"; byUser: Record<string, PortalSalaryLookup> }> {
  if (!portalSalaryConfigured()) return { portal: "unconfigured", byUser: {} };
  const { ok, rows } = await loadRows();
  if (!ok) return { portal: "fail", byUser: {} };
  const byUser: Record<string, PortalSalaryLookup> = {};
  for (const u of users) {
    if (u.empNo == null) { byUser[u.id] = { found: false, reason: "no_emp_no", message: "사번이 없어 포털과 맞추지 못했습니다" }; continue; }
    const n = normName(u.name);
    // User.empNo 는 숫자(앞자리 0 이 빠져 있다) — ems_id 도 numId 가 앞자리 0 을 지운 숫자라 그대로 비교한다
    const sameNo = rows.filter((r) => r.emsNo === u.empNo);
    if (!sameNo.length) { byUser[u.id] = { found: false, reason: "not_found", message: "포털 연봉 목록에 없습니다" }; continue; }
    const named = sameNo.filter((r) => r.name === n);
    if (!named.length) { byUser[u.id] = { found: false, reason: "name_mismatch", message: "포털의 같은 사번 이름이 달라 채우지 않았습니다" }; continue; }
    const kinds = new Set(named.map((r) => `${r.amount}|${r.from}|${r.to}`));
    if (kinds.size !== 1) { byUser[u.id] = { found: false, reason: "duplicate", message: "포털에 이 사번이 여러 줄이라 채우지 않았습니다" }; continue; }
    const r = named[0];
    byUser[u.id] = { found: true, amount: r.amount, from: r.from, to: r.to };
  }
  return { portal: "ok", byUser };
}
