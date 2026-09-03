// 프록시(Caddy) 접근 로그에서 실패 응답을 집계한다 (2026-09-03)
//
// 왜 필요한가: instrumentation 의 onRequestError 는 **터진** 오류만 잡는다. 라우트 136개 중
// 상당수가 try/catch 로 오류를 받아 JSON 으로 돌려주므로 그건 기록에 안 남는다.
// 9/2 하루에 업무 정지급 결함이 3건(앱 첨부 401 / 백지 서명 / 워드 유출) 났는데
// SystemErrorLog 는 0건이었다. "로그가 조용하다"가 "문제가 없다"를 뜻하지 않았다.
//
// 그래서 앱이 아니라 **앞단 프록시가 본 응답 코드**를 집계한다. 앱 코드를 한 줄도 안 고쳐도
// 모든 경로가 잡히고, 앱이 통째로 죽어도(502) 그것까지 보인다.
import fs from "fs/promises";

const MAX_READ = 40 * 1024 * 1024; // 로그가 커도 메모리를 넘기지 않게 끝에서부터만 읽는다

export type FailureRow = { status: number; method: string; path: string; count: number };
export type FailureStats = {
  total: number;
  server: number;   // 5xx
  client: number;   // 4xx (401.403 제외)
  malformed: number; // 주소 자체가 깨진 요청 - 우리 잘못이 아니다(아래 설명)
  rows: FailureRow[];
  newestAt: Date | null;   // 로그가 살아 있는지 판단용
  lines: number;
};

// 퍼센트 인코딩이 깨진 주소(예: /api/contracts/%BE%F8)는 Next 라우팅이 경로 조각을 디코드하다
// 던져서 500 이 된다. 라우트 코드는 멀쩡하다(같은 경로에 정상 id 를 주면 404 를 준다).
// 이걸 서버 오류로 세면 **아무나 깨진 주소를 던져 알림을 흔들 수 있다.** 따로 센다.
function isMalformedUri(uri: string): boolean {
  try { decodeURIComponent(uri.split("?")[0]); return false; } catch { return true; }
}

/** 계약 id 같은 가변 조각을 :id 로 접어 같은 경로끼리 묶는다 */
function normalizePath(uri: string): string {
  const path = uri.split("?")[0];
  return path
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      if (/^c[a-z0-9]{20,}$/i.test(seg)) return ":id";       // cuid
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return ":id"; // uuid
      if (/^\d{4,}/.test(seg)) return ":id";                  // 업로드 파일명(타임스탬프 시작)
      return seg;
    })
    .join("/");
}

/** 집계에서 뺄 것 — 인증 흐름의 정상 응답과 브라우저가 알아서 찔러보는 것들 */
function isNoise(status: number, path: string): boolean {
  if (status === 401 || status === 403) return true; // 로그인 안 됨/권한 없음은 정상 동작
  if (status === 404 && (path.startsWith("/_next/") || path.startsWith("/.well-known/") ||
      path === "/favicon.ico" || path.startsWith("/icons/"))) return true;
  return false;
}

export async function collectFailures(hours = 24): Promise<FailureStats | null> {
  const p = process.env.ACCESS_LOG_PATH;
  if (!p) return null; // 설정 안 된 인스턴스(고객사 등)에서는 조용히 끈다
  let buf: string;
  try {
    const st = await fs.stat(p);
    const fh = await fs.open(p, "r");
    try {
      const start = Math.max(0, st.size - MAX_READ);
      const len = st.size - start;
      const b = Buffer.alloc(len);
      await fh.read(b, 0, len, start);
      buf = b.toString("utf8");
    } finally {
      await fh.close();
    }
  } catch {
    return null; // 파일이 없거나 못 읽으면 기능을 끈다(알림을 위해 앱이 죽으면 안 된다)
  }

  const since = Date.now() - hours * 3600 * 1000;
  const agg = new Map<string, FailureRow>();
  let total = 0, server = 0, client = 0, malformed = 0, lines = 0;
  let newest = 0;

  for (const line of buf.split("\n")) {
    if (!line || line[0] !== "{") continue; // 끝에서 잘라 읽어 첫 줄이 깨질 수 있다
    let e: { ts?: number; status?: number; request?: { uri?: string; method?: string } };
    try { e = JSON.parse(line); } catch { continue; }
    lines++;
    const tsMs = (e.ts ?? 0) * 1000;
    if (tsMs > newest) newest = tsMs;
    if (tsMs < since) continue;
    const status = e.status ?? 0;
    if (status < 400) continue;
    const rawUri = e.request?.uri ?? "";
    if (isMalformedUri(rawUri)) { malformed++; continue; }
    const path = normalizePath(rawUri);
    if (isNoise(status, path)) continue;
    const method = e.request?.method ?? "?";
    total++;
    if (status >= 500) server++; else client++;
    const key = `${status} ${method} ${path}`;
    const row = agg.get(key);
    if (row) row.count++;
    else agg.set(key, { status, method, path, count: 1 });
  }

  const rows = [...agg.values()].sort((a, b) => b.count - a.count || b.status - a.status);
  return { total, server, client, malformed, rows, newestAt: newest ? new Date(newest) : null, lines };
}

/** 하루 한 번 알릴 만한 내용을 문장으로 만든다. 알릴 게 없으면 null */
export function describeFailures(f: FailureStats | null): string | null {
  if (!f) return null;
  // 감시기 자체가 멈춘 것을 먼저 알린다 — 오늘 사고의 교훈: 조용한 것과 고장난 것을 구별해야 한다
  const staleMs = f.newestAt ? Date.now() - f.newestAt.getTime() : Infinity;
  if (staleMs > 3 * 3600 * 1000)
    return `🟠 접근 로그가 ${f.newestAt ? `${Math.round(staleMs / 3600000)}시간째` : ""} 갱신되지 않습니다 — 실패 응답 감시가 멈춘 상태일 수 있습니다.`;

  // 서버 오류(5xx)는 한 건도 정상이 아니다. 4xx 는 사용자의 잘못된 요청도 섞이므로 문턱을 둔다.
  if (f.server === 0 && f.client < 30) return null;
  const top = f.rows.slice(0, 6).map((r) => `  · ${r.status} ${r.method} ${r.path} — ${r.count}회`).join("\n");
  const head = f.server > 0
    ? `🔴 최근 24시간 서버 오류(5xx) ${f.server}건`
    : `🟠 최근 24시간 실패 응답 ${f.client}건`;
  return `${head}${f.server > 0 && f.client > 0 ? ` · 그 밖의 실패 ${f.client}건` : ""}\n${top}`;
}
