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
import path from "path";
import zlib from "zlib";
import { promisify } from "util";

const gunzip = promisify(zlib.gunzip);

const MAX_READ = 40 * 1024 * 1024; // 로그가 커도 메모리를 넘기지 않게 끝에서부터만 읽는다

/** 이 조각의 가장 이른 줄이 창 시작(since)보다 앞서면 true — 더 거슬러 올라갈 필요가 없다. */
function reachesBack(text: string, since: number): boolean {
  let pos = 0;
  for (let n = 0; n < 50 && pos < text.length; n++) {
    const nl = text.indexOf("\n", pos);
    const line = text.slice(pos, nl === -1 ? text.length : nl);
    pos = (nl === -1 ? text.length : nl) + 1;
    if (line[0] !== "{") continue; // 잘라 붙여 첫 줄이 깨질 수 있다
    try {
      const ts = (JSON.parse(line) as { ts?: number }).ts;
      if (ts) return ts * 1000 <= since;
    } catch { /* 다음 줄로 */ }
  }
  return false;
}

export type FailureRow = {
  status: number; method: string; path: string; count: number;
  /** 접기 전 실제 주소 1개 — :id 로 뭉개면 "어느 파일이 404 냐"를 알 수 없다 */
  sample: string;
  /** 서로 다른 주소 가짓수 — 1이면 한 건이 계속 깨지는 것, 많으면 그 경로 전체가 깨진 것 */
  distinct: number;
};
export type FailureStats = {
  /** 설정은 됐는데 로그를 못 읽는 상태 — 감시가 꺼진 것이므로 반드시 알려야 한다 */
  unavailable?: boolean;
  /** 실제로 들여다본 시간 (로그 회전 때문에 요청한 24시간보다 짧을 수 있다) */
  coveredHours: number;
  /** 게이트가 걸린 업로드 경로의 401 — 앱이 티켓을 못 붙이면 여기가 치솟는다 (9/2 사고 형태) */
  uploadsUnauthorized: number;
  /** 마지막 하트비트(/api/health-beat) 시각 — 정지 판정은 **이것으로** 한다 */
  lastBeatAt: Date | null;
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

// 결과를 잠깐 재사용한다. 20MB 파싱은 동기라 그동안 **다른 요청이 전부 대기**한다
// (실측 약 0.3초 멈춤 + 메모리 50MB). 관리자가 화면을 새로고침할 때마다 이러면 안 된다.
let cache: { at: number; hours: number; value: FailureStats | null } | null = null;
const CACHE_MS = 60_000;

let inflight: { hours: number; promise: Promise<FailureStats | null> } | null = null;

export async function collectFailures(hours = 24): Promise<FailureStats | null> {
  if (cache && cache.hours === hours && Date.now() - cache.at < CACHE_MS) return cache.value;
  // ⚠ 캐시가 만료된 순간 두 사람이 동시에 열면 수십 MB 파싱이 **겹쳐서** 돈다.
  //   먼저 들어온 스캔에 올라타게 한다 (검증관 C M-7).
  if (inflight && inflight.hours === hours) return inflight.promise;
  const promise = collectFailuresUncached(hours);
  inflight = { hours, promise };
  let value: FailureStats | null = null;
  try { value = await promise; } finally { if (inflight?.promise === promise) inflight = null; }
  cache = { at: Date.now(), hours, value };
  return value;
}

async function collectFailuresUncached(hours: number): Promise<FailureStats | null> {
  const p = process.env.ACCESS_LOG_PATH;
  if (!p) return null; // 설정 안 된 인스턴스(고객사 등)에서는 조용히 끈다
  const EMPTY = { unavailable: true, coveredHours: 0, uploadsUnauthorized: 0, total: 0, server: 0,
                  client: 0, malformed: 0, rows: [], newestAt: null, lastBeatAt: null, lines: 0 } as FailureStats;
  const since = Date.now() - hours * 3600 * 1000;
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
    // ⚠ 현재 파일만 읽으면 "최근 24시간"이 사실이 아니다. 로그가 20MiB 마다 회전해
    //   실제로는 4~8시간치만 남는다(2026-09-04 실측). 회전본이 바로 옆에 있는데 안 읽었다.
    //   부족한 만큼만 최신 회전본부터 거슬러 붙인다.
    if (buf.length < MAX_READ) {
      try {
        const dir = path.dirname(p);
        const self = path.basename(p);
        const ext = path.extname(p); // ".log"
        const base = path.basename(p, ext);
        // ⚠ `startsWith(base)` 만으로 거르면 같은 이름으로 시작하는 아무 파일이나
        //   통째로 읽는다(예: cubetee-debug-dump.log). 회전본 형태만 받는다.
        const sibs = (await fs.readdir(dir))
          .filter((f) => f !== self && f.startsWith(base) && (f.endsWith(ext) || f.endsWith(ext + ".gz")))
          .sort()
          .reverse();
        for (const f of sibs) {
          // ⚠ 상한 검사를 **반복 진입 전에만** 하면 상한을 뚫는다:
          //   16.6MB(<40 통과) → 37.5MB(<40 통과) → 58.5MB. 40MB 상한이 실제로는
          //   58.5MB 가 됐다(2026-09-04 검증관 C 실측, 회전본 압축비 23배).
          //   붙이기 **전에** 남은 여유를 계산해 그만큼만 가져온다.
          const room = MAX_READ - buf.length;
          if (room < 1024 * 1024) break; // 1MB 미만이면 더 읽어도 의미가 없다
          const full = path.join(dir, f);
          const st2 = await fs.stat(full).catch(() => null);
          if (!st2 || !st2.isFile() || st2.size > MAX_READ) continue; // 비정상적으로 큰 파일은 건너뛴다
          const raw = await fs.readFile(full);
          let text = f.endsWith(".gz")
            ? (await gunzip(raw)).toString("utf8")
            : raw.toString("utf8");
          if (text.length > room) text = text.slice(text.length - room);
          buf = text + String.fromCharCode(10) + buf;
          // 창(24시간)을 이미 덮었으면 더 거슬러 올라가지 않는다 — 종전에는 바이트 상한만
          // 봐서, 필요 없는데도 메모리를 끝까지 쓰고 그러면서 24시간에는 못 닿았다.
          if (reachesBack(text, since)) break;
        }
      } catch { /* 회전본을 못 읽어도 현재 파일만으로 진행한다 */ }
    }
  } catch {
    // ⚠ 여기서 null 을 돌려주면 **감시가 통째로 무음**이 된다(마운트 누락.권한.경로 오타).
    //   설정을 해 놓고 못 읽는 것은 "문제 없음"이 아니라 "감시가 꺼짐"이다 — 그렇게 알린다.
    return EMPTY;
  }

  const agg = new Map<string, FailureRow>();
  let newestBeat = 0;
  const distinctUris = new Map<string, Set<string>>();
  let total = 0, server = 0, client = 0, malformed = 0, lines = 0, uploadsUnauthorized = 0;
  let newest = 0, oldest = 0;

  // ⚠ split 은 수십만 개 문자열을 **한꺼번에** 만들어 들고 있는다. 한 줄씩 잘라 쓰면
  //   같은 일을 하면서 순간 메모리가 훨씬 낮다(검증관 C 지적).
  let scanned = 0;
  for (let pos = 0; pos < buf.length; ) {
    const nl = buf.indexOf("\n", pos);
    const line = buf.slice(pos, nl === -1 ? buf.length : nl);
    pos = (nl === -1 ? buf.length : nl) + 1;
    // ⚠ 36MB 를 한 번에 훑으면 **약 1초 동안 다른 요청을 하나도 못 받는다**(운영 실측
    //   1060ms). 감시가 감시 대상을 멈추는 셈이다(2026-09-04 검증관 C). 총 CPU 는 같아도
    //   중간중간 양보하면 그 1초 동안 사용자 요청이 계속 처리된다.
    if (++scanned % 2000 === 0) await new Promise((r) => setImmediate(r));
    if (!line || line[0] !== "{") continue; // 끝에서 잘라 읽어 첫 줄이 깨질 수 있다
    let e: { ts?: number; status?: number; request?: { uri?: string; method?: string } };
    try { e = JSON.parse(line); } catch { continue; }
    lines++;
    const tsMs = (e.ts ?? 0) * 1000;
    if (tsMs > newest) newest = tsMs;
    // 하트비트는 앱이 살아 있을 때만 남는다. 앱이 죽으면 프록시가 502 를 계속 기록해
    // 다른 줄은 신선해 보이므로, 정지 판정의 기준은 반드시 이 줄이어야 한다.
    if ((e.request?.uri || "").startsWith("/api/health-beat") && tsMs > newestBeat) newestBeat = tsMs;
    if (tsMs && (!oldest || tsMs < oldest)) oldest = tsMs;
    if (tsMs < since) continue;
    const status = e.status ?? 0;
    if (status < 400) continue;
    const rawUri = e.request?.uri ?? "";
    if (isMalformedUri(rawUri)) { malformed++; continue; }
    const path = normalizePath(rawUri);
    // 업로드 경로의 401 은 따로 센다 — 9/2 에 앱이 티켓을 못 붙여 첨부가 전부 401 이 됐을 때
    // 401 을 통째로 버리는 바람에 이 감시로는 못 잡았을 것이다.
    if (status === 401 && path.startsWith("/api/uploads/")) uploadsUnauthorized++;
    if (isNoise(status, path)) continue;
    const method = e.request?.method ?? "?";
    total++;
    if (status >= 500) server++; else client++;
    const key = `${status} ${method} ${path}`;
    const row = agg.get(key);
    const uriOnly = rawUri.split("?")[0];
    if (row) {
      row.count++;
      const set = distinctUris.get(key)!;
      if (set.size < 200) set.add(uriOnly); // 가짓수만 알면 되므로 상한을 둔다
    } else {
      agg.set(key, { status, method, path, count: 1, sample: uriOnly, distinct: 1 });
      distinctUris.set(key, new Set([uriOnly]));
    }
  }

  for (const [k, row] of agg) row.distinct = distinctUris.get(k)?.size ?? 1;
  const rows = [...agg.values()].sort((a, b) => b.count - a.count || b.status - a.status);
  // 로그가 회전하면 파일에 남은 것이 24시간보다 짧다. 그걸 "최근 24시간"이라고 말하면 거짓이다.
  const coveredHours = oldest ? Math.min(hours, (Date.now() - Math.max(oldest, since)) / 3600000) : 0;
  return { coveredHours: Math.round(coveredHours * 10) / 10, uploadsUnauthorized, total, server,
           client, malformed, rows, newestAt: newest ? new Date(newest) : null,
           lastBeatAt: newestBeat ? new Date(newestBeat) : null, lines };
}

/**
 * 하루 한 번 알릴 만한 내용을 **유형별로** 돌려준다. 알릴 게 없으면 빈 배열.
 *
 * ⚠ 종전에는 여러 문제를 한 문자열로 이어 붙여 돌려줬다. monitor 가 문장 앞부분으로
 *   "같은 종류"를 판별해 하루 1회로 묶는데, 그러면 **첫 줄만 키가 되어** 뒤에 붙은
 *   다른 문제(업로드 401 급증 등)가 24시간 통째로 묻힌다 — 그게 바로 9/2 사고의
 *   감지 신호였다(2026-09-03 검증에서 지적). 유형마다 따로 돌려준다.
 */
export function describeFailures(f: FailureStats | null): string[] {
  if (!f) return [];

  // ① 감시 자체가 꺼진 경우를 가장 먼저. "조용한 것"과 "고장난 것"은 다르다.
  if (f.unavailable)
    return ["🔴 접근 로그를 읽을 수 없습니다 — 실패 응답 감시가 꺼져 있습니다(로그 경로.마운트 확인)."];

  // ⚠ "아무 줄이나 최신인가" 로 보면 안 된다 — 앱이 죽어도 프록시가 502 를 계속 기록해
  //   로그는 신선해 보인다. 앱이 살아 있을 때만 남는 하트비트로 판정한다 (2026-09-04).
  // ⚠ 종전 조건은 `f.lastBeatAt &&` 를 걸어 **하트비트가 한 건도 없을 때 침묵**했다.
  //   그런데 "0건"이야말로 정지의 가장 강한 신호다(2026-09-04 검증관 C 지적).
  //   다만 로그가 막 회전하면 정상적으로도 0건일 수 있으므로, **프록시는 기록 중인데
  //   (newestAt) 3시간 넘는 구간에 앱 신호가 0건** 일 때만 알린다. 하트비트는 매시 1회다.
  if (!f.newestAt) return []; // 창 안에 한 줄도 없다 — 막 회전했거나 정말 요청이 없었다
  const beatMs = f.lastBeatAt ? Date.now() - f.lastBeatAt.getTime() : Infinity;
  if (f.lastBeatAt && beatMs > 3 * 3600 * 1000)
    return [`🟠 앱 하트비트 중단 — 마지막 신호가 ${Math.round(beatMs / 3600000)}시간 전입니다(앱 또는 감시가 멈췄을 수 있습니다).`];
  if (!f.lastBeatAt && f.coveredHours >= 3)
    return [`🟠 앱 하트비트 없음 — 최근 ${f.coveredHours}시간 로그에 앱 신호가 한 건도 없습니다(앱 또는 감시가 멈췄을 수 있습니다).`];

  // 실제로 들여다본 시간. 회전 직후 0 이 나오면 "최근 0시간"이라는 말이 안 되므로 표기하지 않는다.
  const window = f.coveredHours >= 23 ? "최근 24시간"
    : f.coveredHours >= 0.5 ? `최근 ${f.coveredHours}시간(로그가 그만큼만 남아 있음)`
    : "로그에 남은 구간";
  const top = f.rows.slice(0, 6).map((r) =>
    `  · ${r.status} ${r.method} ${r.path} — ${r.count}회` +
    (r.distinct > 1 ? ` (서로 다른 주소 ${r.distinct}개)` : ` (${r.sample.slice(-46)})`)
  ).join("\n");
  const tail = f.malformed >= 20 ? `\n  (그 밖에 주소가 깨진 요청 ${f.malformed}건 — 우리 잘못은 아닙니다)` : "";

  // ⚠ 중복 방지 키에 **어느 경로가 터졌는지**가 들어가야 한다. 9/3 에 "숫자만 지운다"로
  //   고쳤다가 회전 문구 때문에 하루에 여러 번 갔고, 9/4 에 "유형만" 으로 바꿨더니 이번엔
  //   **다른 사고가 같은 키로 24시간 묻혔다.** 둘 다 틀렸다 — 회전 문구는 빼고 경로는 넣는다.
  //   monitor 가 첫 구분자(—) 앞을 키로 쓰므로, 상위 경로를 그 앞에 적는다.
  // ⚠ rows 는 **건수 내림차순(4xx 포함)** 이다. 상위 3개를 그대로 서명에 쓰면 소음 404 가
  //   자리를 차지해, 정작 알림 사유인 5xx 가 서명에 한 글자도 안 들어간다 → 서로 다른
  //   사고가 같은 키로 묶인다(검증관 C 지적). 사유가 된 줄에서 뽑는다.
  const sigOf = (ok: (s: number) => boolean) =>
    f.rows.filter((r) => ok(r.status)).slice(0, 3).map((r) => `${r.status} ${r.path}`).join(", ") || "경로없음";
  const out: string[] = [];
  if (f.server > 0) out.push(`🔴 서버 오류 [${sigOf((s) => s >= 500)}] — ${window} 5xx ${f.server}건\n${top}${tail}`);
  else if (f.client >= 30) out.push(`🟠 실패 응답 다수 [${sigOf((s) => s >= 400 && s < 500)}] — ${window} ${f.client}건\n${top}${tail}`);
  // 업로드 401 급증은 앱이 파일을 못 여는 신호다(9/2 사고 형태). **별개 알림으로** 낸다.
  if (f.uploadsUnauthorized >= 50)
    out.push(`🟠 업로드 접근 거부 급증 — ${window} ${f.uploadsUnauthorized}건(앱이 첨부를 못 열고 있을 수 있습니다).`);
  return out;
}
