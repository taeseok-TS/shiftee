// 직영 인사 원장(구글 시트) 읽기 — 2026-09-16 디렉터 지시로 포털 DB 대신 이 파일을 원천으로 쓴다.
// ("로우에서 가져오는 게 가장 정확하다" — 이예지 대리)
//
// 읽기만 한다. 시트는 사람이 손으로 관리하는 원장이므로 형식이 흔들린다는 전제로 짠다:
//  · 사번 자릿수가 섞여 있다("01747" / "2180") → 숫자로 정규화
//  · 지점입사일이 129명 중 53명 비어 있고, 날짜 오타도 있다("2026-0601") → 못 읽으면 빈 값으로 두고 반영하지 않는다
//  · 재직·휴직·퇴사·본사발령 외에 **상태가 빈 행이 349개**(지원자·과거 이력) → 상태가 없는 행은 아무것도 하지 않는다
import type { PortalRow } from "@/lib/portal-roster";

/** 시트 열 이름 — 원장 파일의 머리글 그대로. 바뀌면 여기만 고친다. */
const COL = {
  empNo: ["사번"],
  name: ["이름", "성명"],
  status: ["현 상태", "현상태", "상태"],
  job: ["현 직무", "현직무", "직무"],
  position: ["현 직책", "현직책", "직책"],
  branch: ["현 소속", "현소속", "소속", "지점"],
  joinDate: ["지점입사일", "입사일"],
  routeDate: ["루트입과일"],
  leaveDate: ["퇴사일", "퇴직일"], // 지금 원장에는 없는 열 — 생기면 자동으로 쓰인다
  email: ["회사 E-Mail", "회사 이메일", "회사메일"],
} as const;

/**
 * 구글 시트 주소인가. 편집 주소(/edit)도 받아 CSV 내려받기 주소로 바꿔 쓴다.
 * 다른 호스트로는 나가지 않는다 — 주소를 잘못 넣어 사내 주소나 남의 서버를 긁지 않게.
 */
export function isSheetUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "docs.google.com"
      && /^\/spreadsheets\/d\/[A-Za-z0-9_-]+\//.test(u.pathname) && !u.username && !u.password;
  } catch { return false; }
}

/** 편집 주소 → CSV 내려받기 주소. gid(탭)가 있으면 그 탭을 그대로 쓴다. */
export function sheetCsvUrl(url: string): string {
  const u = new URL(url);
  const id = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)\//.exec(u.pathname)?.[1] ?? "";
  const gid = u.searchParams.get("gid") || (u.hash.match(/gid=(\d+)/)?.[1] ?? "");
  const out = new URL(`https://docs.google.com/spreadsheets/d/${id}/export`);
  out.searchParams.set("format", "csv");
  if (gid) out.searchParams.set("gid", gid);
  return out.toString();
}

/** 따옴표 안의 쉼표·줄바꿈까지 처리하는 최소 CSV 파서 (사람이 쓴 원장이라 주소·비고에 쉼표가 들어온다) */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
      continue;
    }
    if (c === '"') { q = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * 입사일 규칙 (2026-09-18 디렉터 확정)
 *  · **2026년 7월부터 입사한 사람은 루트입과일이 입사일**이다.
 *  · 그 전에는 교육을 수료해야 입사였으므로 입사일 = 지점입사일이고, **큐브티 값을 건드리지 않는다.**
 * 실측: 7월 이후 입사자 7명 중 5명은 큐브티가 이미 루트입과일과 같고, 나머지 2명은 신규 계정이다.
 * 이 규칙 전에는 "지점입사일"만 보고 07-06 → 07-27 로 21일 늦추라는 잘못된 제안을 5건 냈다.
 * ⚠ 루트입과일 칸에 날짜 대신 "재입사" 글자가 든 행이 있다(재직·휴직 7명, 전체 16행 — 전부 7월 이전).
 *   그 표기만 빈칸으로 보고, 그 밖에 날짜로 못 읽는 값은 입사일을 건드리지 않는 쪽으로 둔다.
 */
const ROUTE_RULE_FROM = "2026-07-01";

const dateOnly = (s: string) => {
  // 한국어 구글 시트 기본 표시는 "2026. 7. 6" / "2026. 7. 6." 이고 CSV 로 그대로 나온다 — 점 뒤 공백·끝 점을 받아준다
  const m = /^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?$/.exec(s.trim()) || /^(\d{4})(\d{2})(\d{2})$/.exec(s.trim());
  if (!m) return "";
  const [y, mo, d] = [m[1], m[2].padStart(2, "0"), m[3].padStart(2, "0")];
  // 2026-0601 같은 오타는 위 정규식에서 이미 걸러진다. 달·일 범위도 본다.
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return "";
  return `${y}-${mo}-${d}`;
};

/** 시트 한 탭을 CSV 로 받아 행 배열로. 공유가 끊겨 로그인 화면이 오면 오류로 세운다. */
async function fetchSheetRows(url: string, label: string): Promise<string[][]> {
  if (!isSheetUrl(url)) throw new Error("연결 주소가 올바르지 않습니다(https://docs.google.com/spreadsheets/d/… 형식이어야 합니다).");
  const res = await fetch(sheetCsvUrl(url), {
    headers: { Accept: "text/csv" },
    cache: "no-store",
    redirect: "follow", // 구글은 내려받기 주소로 한 번 넘긴다(같은 구글 도메인 안)
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${label} 응답 ${res.status} — 시트 공유 설정을 확인해주세요.`);
  const text = await res.text();
  // 공유가 끊기면 CSV 대신 로그인 화면(HTML)이 온다 — 그걸 0명으로 읽으면 전원 퇴사로 보일 수 있다
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("csv") || /^\s*<(!doctype|html)/i.test(text))
    throw new Error(`${label}을 읽지 못했습니다(로그인 화면이 돌아왔습니다). 공유 설정을 확인해주세요.`); // 두 이름 모두 받침으로 끝난다
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error(`${label}이 비어 있습니다.`);
  return rows;
}

// ── 퇴사자 탭 ─────────────────────────────────────────────
// 같은 파일의 「퇴사자 (RAW)」 탭(2026-09-18 디렉터 지시). 인사 원장에 퇴사일 칸이 없어서,
// 원장에서 퇴사로 바뀌었거나 원장에서 사라진 큐브티 재직자의 **퇴사일을 여기서 찾는다.**
// ⚠ 이 탭에는 **사번이 없다.** 그리고 같은 이름이 2줄 이상인 경우가 350명이다(동명이인·중복 줄).
//   이름만으로 찾으면 2006년에 퇴사한 동명이인의 퇴사일로 지금 직원을 퇴사시킨다(실측: 이지영).
//   그래서 이름 + **입사일**이 모두 맞을 때만 쓴다(portal-roster 의 findLeaveDate).
export type LeaverRow = { name: string; branch: string; joinDate: string; rejoinDate: string; leaveDate: string };

export async function fetchSheetLeavers(url: string): Promise<LeaverRow[]> {
  const rows = await fetchSheetRows(url, "퇴사자 탭");
  const hdr = rows[0].map((h) => h.trim());
  const at = (n: string) => hdr.indexOf(n);
  const col = { name: at("이름"), branch: at("지점"), join: at("입사일"), rejoin: at("재입사일"), leave: at("퇴사일") };
  const need = (["name", "join", "leave"] as const).filter((k) => col[k] < 0);
  if (need.length) throw new Error(`퇴사자 탭에서 열을 찾지 못했습니다: ${need.map((k) => ({ name: "이름", join: "입사일", leave: "퇴사일" })[k]).join(", ")}.`);
  const cell = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i].trim() : "");
  const out: LeaverRow[] = [];
  for (const r of rows.slice(1)) {
    const leaveDate = dateOnly(cell(r, col.leave));
    const name = cell(r, col.name);
    if (!name || !leaveDate) continue; // 퇴사일이 비었거나 못 읽는 줄은 쓰지 않는다
    out.push({ name, branch: cell(r, col.branch), joinDate: dateOnly(cell(r, col.join)), rejoinDate: dateOnly(cell(r, col.rejoin)), leaveDate });
  }
  return out;
}

export async function fetchSheetRoster(url: string): Promise<PortalRow[]> {
  const rows = await fetchSheetRows(url, "인사 원장");
  const hdr = rows[0].map((h) => h.trim());
  const pick = (names: readonly string[]) => {
    for (const n of names) { const i = hdr.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const at = {
    empNo: pick(COL.empNo), name: pick(COL.name), status: pick(COL.status), job: pick(COL.job),
    position: pick(COL.position), branch: pick(COL.branch), joinDate: pick(COL.joinDate),
    routeDate: pick(COL.routeDate), leaveDate: pick(COL.leaveDate), email: pick(COL.email),
  };
  // 열 이름이 바뀌면 조용히 빈 값으로 읽혀 **전원 정보가 지워진 것처럼** 보인다 — 필수 열이 없으면 멈춘다
  const missing = (["empNo", "name", "status", "branch"] as const).filter((k) => at[k] < 0);
  if (missing.length)
    throw new Error(`인사 원장에서 열을 찾지 못했습니다: ${missing.map((k) => COL[k][0]).join(", ")}. 머리글이 바뀌었는지 확인해주세요.`);

  const cell = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i].trim() : "");
  const out: PortalRow[] = [];
  for (const r of rows.slice(1)) {
    if (!r.some((c) => c.trim())) continue; // 빈 줄
    const portalId = cell(r, at.empNo);
    const status = cell(r, at.status);
    // 상태 칸이 비어 있는 행은 **명부가 아니다** — 지원자·과거 이력이 349행 있다.
    // 올리면 매일 "알 수 없는 상태" 건너뜀으로 기록돼 정작 봐야 할 몇 건이 묻히고,
    // 지원자 이름·사번이 인사 시스템 DB 에 쌓인다(2026-09-16 검증관 4).
    if (!status) continue;
    if (!portalId) continue;
    const n = /^\d{1,9}$/.test(portalId) ? parseInt(portalId, 10) : NaN;
    // 입사일 — 위 ROUTE_RULE_FROM 규칙. 7월 이후 입사자만 큐브티 입사일을 고칠 수 있다(hireDateEditable).
    const routeRaw = cell(r, at.routeDate);
    const route = dateOnly(routeRaw);
    // 루트입과일 칸에 뭔가 적혀 있는데 날짜로 못 읽으면(오타·다른 표기) **빈칸으로 보지 않는다** —
    // 빈칸 취급하면 지점입사일로 떨어져, 방금 막은 "07-06 → 07-27 늦추기" 제안이 되살아난다(검증관 D1).
    // "재입사" 표기만 알려진 값이라 빈칸으로 본다(전부 7월 이전 입사자).
    // "재입사" 는 **정확히 그 글자일 때만** — includes 로 보면 "재입사(2026.7.6)" 같은 값이 빈칸 취급돼 같은 구멍이 난다(검증관 D-A)
    const routeUnreadable = !!routeRaw && !route && routeRaw !== "재입사";
    const branchJoin = dateOnly(cell(r, at.joinDate));
    // 못 읽는 루트입과일이면 입사일을 **모르는 것**으로 둔다 — 지점입사일로 떨어지면 신규 계정이 그 날짜로
    // 만들어진다(입사일 변경 제안만 막고 계정 생성은 안 막던 것, 검증관 D-B)
    let joinDate = routeUnreadable ? "" : branchJoin;
    let hireDateEditable = false;
    if (route && route >= ROUTE_RULE_FROM) { joinDate = route; hireDateEditable = true; }
    else if (!route && !routeUnreadable && branchJoin && branchJoin >= ROUTE_RULE_FROM) hireDateEditable = true; // 7월 이후 입사인데 루트를 안 거친 경우
    out.push({
      portalId,
      empNo: Number.isFinite(n) && n > 0 ? n : null,
      name: cell(r, at.name),
      status,
      job: cell(r, at.job),
      position: cell(r, at.position),
      branch: cell(r, at.branch),
      joinDate,
      hireDateEditable,
      leaveDate: dateOnly(cell(r, at.leaveDate)),
      email: cell(r, at.email).toLowerCase(),
    });
  }
  if (out.length > 5000) throw new Error(`인사 원장이 너무 큽니다(${out.length}행).`);
  return out;
}
