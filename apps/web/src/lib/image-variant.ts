// 사진 축소본(2026-11-18 디렉터 「A·B 진행」 · 「마케팅 자료 사진도 채팅처럼」) — 11/17 월례회의 날 [ALL] 방(115명)에 사진 54장이 올라와
// 원본(0.5~2.6MB)을 사람마다 통째로 받아 가 10분에 수 GB 가 나갔고, 서버(2코어)가 막혀 채팅이 버벅였다.
//
//  · 목록은 **긴 변 640px**(THUMB), 크게 보기는 **긴 변 1600px**(VIEW) 축소본을 쓴다. 저장(다운로드) · 연동 키(API)는 원본 그대로.
//  · 대상 경로군: 채팅 첨부(work) · 자료제출 · 마케팅 자료 · 합격 사례 첨부(submissions).
//  · 형식은 WebP — 투명 PNG 도 배경이 생기지 않는다. EXIF 회전을 먼저 적용하고 메타데이터(위치 등)는 버린다.
//  · 축소본은 업로드 볼륨 안 uploads/.variants/<경로군>/<파일명>.w<폭>.webp 에 한 번 만들어 두고 다시 쓴다.
//    파일 응답 라우트가 점(.)으로 시작하는 경로군을 404 로 막는다 — 축소본을 원본 권한 검사 없이 받을 수 없다.
//  · 업로드 직후 미리 만든다(warmImageVariants) — 사진을 보는 순간 수십 명이 한꺼번에 만들게 하지 않는다.
//  · 서버 2코어: 한 번에 하나씩(대기열), 같은 축소본을 동시에 두 번 만들지 않는다. 요청은 최대 3초만 기다리고 원본으로 넘어간다
//    (만들기는 뒤에서 계속 — 다음 요청부터 축소본). 대기열이 넘치거나 실패하면 null — 부르는 쪽은 원본을 준다.
//  · 실패(깨진 그림 · 지원 안 되는 형식 · 움직이는 그림)는 10분 기억한다 — 같은 파일을 요청마다 다시 풀지 않는다(검증관 3).
//  · sharp 는 next 가 함께 설치한 것을 쓴다(직접 의존성 아님). 번들러가 따라가지 않게 실행 때 createRequire 로 읽는다. 없으면 축소본 없이 원본.
//  · HEIC · GIF · SVG · BMP, 움직이는 WebP · APNG 는 축소하지 않는다(원본 — 움직임이 멈추지 않게, 검증관 4).
import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";

export const VARIANT_THUMB = 640;
export const VARIANT_VIEW = 1600;
const WIDTHS = new Set([VARIANT_THUMB, VARIANT_VIEW]);
export const VARIANT_GROUPS = new Set(["work", "submissions"]);
const SRC_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
export const VARIANT_MIN_BYTES = 150 * 1024;   // 원본이 이보다 작으면 축소본을 만들지 않는다(줄여도 얼마 안 준다)
const SMALL_BYTES = VARIANT_MIN_BYTES;
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_PIXELS = 60_000_000;
const MAX_QUEUE = 300;                   // 기다리는 작업이 이보다 많으면 새 요청은 원본으로
const TIMEOUT_SEC = 20;
const WAIT_MS = 3000;                    // 요청이 축소본을 기다리는 최대 시간
const FAIL_TTL_MS = 10 * 60 * 1000;
const VARIANT_DIR = ".variants";
const MOD = "sharp";                     // 이름을 변수로 — 번들러가 빌드 때 따라 들어가지 않게

/** ?w= 값 → 허용된 폭(640 · 1600)만, 나머지는 null(원본) */
export function parseVariantWidth(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return WIDTHS.has(n) ? n : null;
}

/** 이 파일을 축소할 수 있는 형식인가(확장자 기준 — 내용은 sharp 가 판별, 실패하면 원본) */
export function isVariantSource(fileName: string): boolean {
  return SRC_EXT.has(path.extname(fileName).toLowerCase());
}

function variantPath(baseDir: string, group: string, fileName: string, width: number): string {
  return path.join(baseDir, VARIANT_DIR, group, `${fileName}.w${width}.webp`);
}

// ─── sharp 읽기(한 번) ───
type SharpPipe = {
  metadata(): Promise<{ pages?: number }>;
  rotate(): SharpPipe;
  resize(o: Record<string, unknown>): SharpPipe;
  webp(o: Record<string, unknown>): SharpPipe;
  timeout(o: { seconds: number }): SharpPipe;
  toFile(p: string): Promise<unknown>;
};
type SharpFn = ((input: string, opts?: Record<string, unknown>) => SharpPipe) & { concurrency(n: number): number; cache(o: boolean): void };
let sharpMod: SharpFn | null | undefined;
function loadSharp(): SharpFn | null {
  if (sharpMod !== undefined) return sharpMod;
  try {
    const req = createRequire(path.join(process.cwd(), "package.json"));
    let s: SharpFn;
    try { s = createRequire(req.resolve("next/package.json"))(MOD) as SharpFn; } catch { s = req(MOD) as SharpFn; }
    s.concurrency(1);   // libvips 스레드 1개 — 2코어 서버에서 채팅 요청 몫을 남긴다
    s.cache(false);     // 처리한 그림을 메모리에 붙잡아 두지 않는다
    sharpMod = s;
  } catch (e) {
    console.error("[image-variant] sharp 를 읽지 못해 사진 축소본 없이 원본을 씁니다:", (e as Error)?.message);
    sharpMod = null;
  }
  return sharpMod;
}

/** 이 서버에서 축소본을 만들 수 있는가(배포 확인용) */
export function variantsAvailable(): boolean {
  return loadSharp() !== null;
}

// ─── 대기열(한 번에 하나) · 같은 작업 합치기 · 실패 기억 ───
type State = { inflight: Map<string, Promise<string | null>>; chain: Promise<unknown>; waiting: number; failed: Map<string, number> };
const g = globalThis as unknown as { __imgVariant?: State };
const st: State = g.__imgVariant ?? (g.__imgVariant = { inflight: new Map(), chain: Promise.resolve(), waiting: 0, failed: new Map() });
st.failed ??= new Map();

async function exists(p: string): Promise<boolean> {
  try { return (await fs.stat(p)).isFile(); } catch { return false; }
}

function markFailed(key: string) {
  if (st.failed.size > 5000) st.failed.clear();
  st.failed.set(key, Date.now());
}

async function build(srcPath: string, outPath: string, width: number): Promise<string | null> {
  const sharp = loadSharp();
  if (!sharp) return null;
  if (await exists(outPath)) return outPath;   // 기다리는 사이 다른 요청이 만들었으면 그대로
  const tmp = `${outPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    const md = await sharp(srcPath, { limitInputPixels: MAX_PIXELS }).metadata();
    if ((md.pages ?? 1) > 1) { markFailed(outPath); return null; }   // 움직이는 그림은 원본
    await sharp(srcPath, { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .rotate()
      .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
      .webp({ quality: width <= VARIANT_THUMB ? 72 : 80, effort: 3 })
      .timeout({ seconds: TIMEOUT_SEC })
      .toFile(tmp);
    await fs.rename(tmp, outPath);
    return outPath;
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    markFailed(outPath);
    console.warn("[image-variant] 축소 실패 — 원본을 씁니다:", path.basename(srcPath), (e as Error)?.message?.slice(0, 160));
    return null;
  }
}

/**
 * 축소본 경로를 돌려준다(없으면 만든다 — 최대 waitMs 기다림). 만들 수 없거나 만들 필요가 없으면 null — 부르는 쪽은 원본을 준다.
 * srcPath 는 **권한 검사를 마친 원본의 실제 경로**여야 한다. 던지지 않는다.
 */
export async function getImageVariant(baseDir: string, group: string, srcPath: string, fileName: string, width: number, waitMs: number = WAIT_MS): Promise<string | null> {
  try {
    if (!WIDTHS.has(width) || !VARIANT_GROUPS.has(group) || !isVariantSource(fileName)) return null;
    if (/[\\/]/.test(fileName) || fileName.includes("..") || fileName.startsWith(".")) return null;
    const out = variantPath(baseDir, group, fileName, width);
    if (await exists(out)) return out;
    const f = st.failed.get(out);
    if (f && Date.now() - f < FAIL_TTL_MS) return null;
    const s = await fs.stat(srcPath).catch(() => null);
    if (!s || !s.isFile() || s.size < SMALL_BYTES || s.size > MAX_INPUT_BYTES) return null;
    let p = st.inflight.get(out);
    if (!p) {
      if (st.waiting >= MAX_QUEUE) return null;
      st.waiting++;
      p = (st.chain = st.chain.then(
        () => build(srcPath, out, width),
        () => build(srcPath, out, width),
      )) as Promise<string | null>;
      st.inflight.set(out, p);
      const done = p;
      done.finally(() => { st.waiting--; if (st.inflight.get(out) === done) st.inflight.delete(out); }).catch(() => {});
    }
    if (!Number.isFinite(waitMs)) return await p;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), Math.max(0, waitMs)); });
    try { return await Promise.race([p, timeout]); } finally { if (timer) clearTimeout(timer); }
  } catch {
    return null;
  }
}

/** 업로드 직후 목록용 · 크게 보기용 축소본을 미리 만든다 — 기다리지 않는다(응답을 늦추지 않음) */
export function warmImageVariants(baseDir: string, group: string, fileName: string): void {
  if (!isVariantSource(fileName) || !VARIANT_GROUPS.has(group)) return;
  const src = path.join(baseDir, group, fileName);
  void getImageVariant(baseDir, group, src, fileName, VARIANT_THUMB, Infinity)
    .then(() => getImageVariant(baseDir, group, src, fileName, VARIANT_VIEW, Infinity))
    .catch(() => {});
}

/** 원본을 지울 때 축소본도 함께 지운다(없어도 조용히) */
export async function removeImageVariants(baseDir: string, group: string, fileName: string): Promise<void> {
  if (!VARIANT_GROUPS.has(group) || /[\\/]/.test(fileName) || fileName.includes("..")) return;
  for (const w of WIDTHS) await fs.unlink(variantPath(baseDir, group, fileName, w)).catch(() => {});
}
