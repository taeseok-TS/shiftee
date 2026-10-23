// 아이폰 HEIC · HEIF 사진을 올릴 때 JPG 로 바꿔 저장한다(2026-10-23 본부 요청 ■1 「회사 PC 에서 안 열립니다」, 디렉터 승인).
//
//  · 판별은 확장자가 아니라 **파일 첫머리(매직바이트)** — iOS 앱이 여러 장 고르기에서 HEIC 원본을 이름만 .jpg 로 보낸다(2026-08-12).
//  · 변환은 순수 JS(heic-decode = libheif 1.23 wasm, jpeg-js) — 컨테이너에 따로 깔 것이 없다. sharp 의 libvips 는 HEVC(HEIC) 를 못 푼다.
//    패키지는 번들러가 끌어들이지 않게 실행 때 createRequire 로 읽는다(wasm 을 번들에 넣지 않는다). 없으면 변환을 건너뛴다.
//  · 긴 변이 2560px 넘으면 정수 배로 줄인다(4032×3024 → 2016×1512) — 화질 원본이 필요한 곳(마케팅 자료 제출)은 이 함수를 쓰지 않는다.
//  · 한 번에 하나씩만 바꾼다(12MP 한 장에 메모리 300MB 안팎 · 서버 2코어). 실패하면 null — 부르는 쪽은 원본 그대로 저장한다(업로드를 막지 않는다).
//  · 호스트 /opt/heic-sweep(1분 변환)은 안전망으로 그대로 둔다.
//
// 서버를 멈추지 않게(10/23 검증 H1): 해독 · 축소 · 인코딩은 **워커 스레드**에서 한다(메인 이벤트 루프는 다른 요청을 계속 받는다).
//  · Next 번들러가 워커 파일을 따라가지 못하므로 워커 코드는 문자열(eval) — 워커 안에서도 createRequire 로 패키지를 읽는다.
//  · 15초 넘으면 워커를 끊고 null(원본 저장). 오류 · 비정상 종료도 null.
//  · 해독 전에 HEIC 안 ispe(가로 · 세로)를 읽어 6000만 화소를 넘으면 바꾸지 않는다(압축 폭탄 — 작은 파일이 거대한 그림으로 풀리는 것).
import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";
import { Worker } from "worker_threads";

const MAX_SIDE = 2560;
const JPEG_QUALITY = 85;
const MAX_INPUT_BYTES = 40 * 1024 * 1024;   // 이보다 큰 HEIC 는 바꾸지 않는다(메모리)
const MAX_PIXELS = 60_000_000;              // 가로×세로가 이보다 크면 바꾸지 않는다(48MP 아이폰 ProRAW 급까지는 된다)
const TIMEOUT_MS = 15_000;
const WORKER_HEAP_MB = 256;                 // 워커 JS 힙 상한(wasm · 그림 버퍼는 힙 밖이라 시간 제한 · 화소 상한이 함께 막는다)
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);
const GENERIC_BRANDS = new Set(["mif1", "msf1"]);   // AVIF 도 쓰는 일반 브랜드 — 호환 브랜드에 HEIC 계열이 있어야 HEIC
// 이름을 변수로 둔다 — 번들러(Turbopack)가 빌드 때 따라 들어가 wasm 을 묶거나, 설치 전인 곳에서 빌드를 깨지 않게
const MODS = { decode: "heic-decode", jpeg: "jpeg-js" };

/** 파일 첫머리(64바이트 이상 권장)가 HEIC · HEIF(HEVC) 인가 — AVIF 는 아니다(브라우저가 연다) */
export function looksHeic(head: Buffer): boolean {
  if (head.length < 12 || head.subarray(4, 8).toString("latin1") !== "ftyp") return false;
  const major = head.subarray(8, 12).toString("latin1");
  if (HEIC_BRANDS.has(major)) return true;
  if (!GENERIC_BRANDS.has(major)) return false;
  const boxEnd = Math.min(head.readUInt32BE(0), head.length);
  for (let o = 16; o + 4 <= boxEnd; o += 4) if (HEIC_BRANDS.has(head.subarray(o, o + 4).toString("latin1"))) return true;
  return false;
}

/** 파일 이름의 확장자를 .jpg 로(없으면 붙인다) */
export function jpgName(name: string): string {
  const ext = path.extname(name);
  return `${ext ? name.slice(0, -ext.length) : name}.jpg`;
}

/**
 * HEIC(ISO BMFF) 안 ispe 박스(그림 가로 · 세로) 중 가장 큰 가로×세로 — meta › iprp › ipco › ispe.
 * 그리드 사진은 전체 그림 · 타일 · 미리보기마다 ispe 가 있어 가장 큰 것을 본다. 못 찾으면 null.
 */
export function heicMaxPixels(buf: Buffer): number | null {
  type Box = { type: string; body: number; end: number };
  const boxes = (start: number, end: number): Box[] => {
    const out: Box[] = [];
    let o = start;
    while (o + 8 <= end && out.length < 4096) {
      let size = buf.readUInt32BE(o);
      const type = buf.subarray(o + 4, o + 8).toString("latin1");
      let body = o + 8;
      if (size === 1) {
        if (o + 16 > end) break;
        const big = buf.readBigUInt64BE(o + 8);
        if (big > BigInt(end - o)) break;
        size = Number(big);
        body = o + 16;
      } else if (size === 0) {
        size = end - o;
      }
      if (size < body - o || o + size > end) break;
      out.push({ type, body, end: o + size });
      o += size;
    }
    return out;
  };
  const child = (list: Box[], type: string, fullBox: boolean): Box[] => {
    const b = list.find((x) => x.type === type);
    if (!b) return [];
    const s = b.body + (fullBox ? 4 : 0);   // FullBox 는 version(1) + flags(3)
    return s <= b.end ? boxes(s, b.end) : [];
  };
  try {
    const ipco = child(child(child(boxes(0, buf.length), "meta", true), "iprp", false), "ipco", false);
    let max: number | null = null;
    for (const b of ipco) {
      if (b.type !== "ispe" || b.body + 12 > b.end) continue;
      const w = buf.readUInt32BE(b.body + 4), h = buf.readUInt32BE(b.body + 8);
      const px = w * h;
      if (max === null || px > max) max = px;
    }
    return max;
  } catch {
    return null;
  }
}

// 워커에서 도는 코드(문자열 — 번들러가 따라가지 않는다). workerData = { base, mods, input(ArrayBuffer), maxSide, quality }
// 결과는 { ok, w, h, sw, sh, out(ArrayBuffer) } 또는 { ok: false, err }
const WORKER_CODE = `
"use strict";
const { parentPort, workerData } = require("worker_threads");
const { createRequire } = require("module");
function shrink(img, maxSide) {
  const f = Math.ceil(Math.max(img.width, img.height) / maxSide);
  const src = img.data;
  if (f <= 1) return { width: img.width, height: img.height, data: src };
  const w = Math.floor(img.width / f), h = Math.floor(img.height / f);
  const out = new Uint8Array(w * h * 4);
  const n = f * f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < f; dy++) {
        let i = ((y * f + dy) * img.width + x * f) * 4;
        for (let dx = 0; dx < f; dx++, i += 4) { r += src[i]; g += src[i + 1]; b += src[i + 2]; }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}
(async () => {
  try {
    const req = createRequire(workerData.base);
    const decode = req(workerData.mods.decode);
    const jpeg = req(workerData.mods.jpeg);
    const img = await decode({ buffer: Buffer.from(workerData.input) });
    const small = shrink(img, workerData.maxSide);
    const enc = jpeg.encode(small, workerData.quality).data;
    const out = enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength);
    parentPort.postMessage({ ok: true, w: img.width, h: img.height, sw: small.width, sh: small.height, out }, [out]);
  } catch (e) {
    parentPort.postMessage({ ok: false, err: String((e && e.message) || e).slice(0, 200) });
  }
})();
`;

/** 패키지를 읽을 기준(package.json 경로) — 운영은 앱 폴더(process.cwd()) */
const codecBase = () => path.join(process.cwd(), "package.json");

let codecsPresent: boolean | undefined;
/** 변환 패키지가 깔려 있나(경로만 찾는다 — wasm 은 메인 스레드에서 읽지 않는다) */
function hasCodecs(): boolean {
  if (codecsPresent !== undefined) return codecsPresent;
  try {
    const req = createRequire(codecBase());
    req.resolve(MODS.decode);
    req.resolve(MODS.jpeg);
    codecsPresent = true;
  } catch (e) {
    console.error("[heic-jpeg] 변환 패키지를 찾지 못해 HEIC 를 그대로 둡니다:", e instanceof Error ? e.message.slice(0, 200) : e);
    codecsPresent = false;
  }
  return codecsPresent;
}

type WorkerResult = { ok: true; w: number; h: number; sw: number; sh: number; out: ArrayBuffer } | { ok: false; err: string };

/** 워커 하나로 바꾼다 — 시간 제한 · 오류 · 비정상 종료는 모두 null */
function convertInWorker(buf: Buffer, timeoutMs: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const t = Date.now();
    // 부르는 쪽 버퍼는 실패 때 원본으로 저장하므로 넘겨주지 않는다 — 사본을 만들어 그 사본만 워커로 옮긴다(transferList)
    const input = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    let worker: Worker;
    try {
      worker = new Worker(WORKER_CODE, {
        eval: true,
        workerData: { base: codecBase(), mods: MODS, input, maxSide: MAX_SIDE, quality: JPEG_QUALITY },
        transferList: [input],
        resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
        execArgv: [],   // 부모의 실행 옵션(--input-type=module 등)이 문자열 코드(CommonJS)를 깨지 않게
        stdout: false,
        stderr: false,
      });
    } catch (e) {
      console.error("[heic-jpeg] 워커를 띄우지 못해 원본 그대로 저장:", e instanceof Error ? e.message.slice(0, 200) : e);
      resolve(null);
      return;
    }
    let done = false;
    const finish = (v: Buffer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // 워커가 완전히 멈춘 뒤에 다음 차례로 넘긴다(끊긴 해독이 CPU 를 계속 쓰며 다음 변환과 겹치지 않게)
      worker.terminate().catch(() => {}).finally(() => resolve(v));
    };
    const timer = setTimeout(() => {
      console.error(`[heic-jpeg] ${timeoutMs}ms 넘어 변환을 끊음 — 원본 그대로 저장`);
      finish(null);
    }, timeoutMs);
    worker.on("message", (m: WorkerResult | null | undefined) => {
      if (!m) {
        console.error("[heic-jpeg] 변환 실패(빈 응답) — 원본 그대로 저장");
        finish(null);
      } else if (m.ok) {
        const out = Buffer.from(m.out);
        console.log(`[heic-jpeg] ${m.w}x${m.h} → ${m.sw}x${m.sh} JPG ${Math.round(out.length / 1024)}KB · ${Date.now() - t}ms`);
        finish(out);
      } else {
        console.error("[heic-jpeg] 변환 실패 — 원본 그대로 저장:", "err" in m ? m.err : m);
        finish(null);
      }
    });
    worker.on("error", (e) => {
      console.error("[heic-jpeg] 워커 오류 — 원본 그대로 저장:", e instanceof Error ? e.message.slice(0, 200) : e);
      finish(null);
    });
    worker.on("exit", (code) => {
      if (!done) console.error(`[heic-jpeg] 워커가 결과 없이 끝남(종료코드 ${code}) — 원본 그대로 저장`);
      finish(null);
    });
  });
}

let queue: Promise<unknown> = Promise.resolve();
/** 한 번에 하나씩 */
function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

/**
 * HEIC 이면 JPG 바이트, 아니거나 못 바꾸면 null(로그만 남긴다).
 * opts 는 시험용(시간 제한 줄이기) — 운영 호출처는 넘기지 않는다.
 */
export async function heicToJpeg(buf: Buffer, opts?: { timeoutMs?: number }): Promise<Buffer | null> {
  if (!looksHeic(buf.subarray(0, 64)) || buf.length > MAX_INPUT_BYTES) return null;
  const px = heicMaxPixels(buf);
  // ispe 는 HEIF 그림마다 필수라 아이폰 실물에는 늘 있다 — 못 읽으면 조작된 파일로 보고 바꾸지 않는다(10/23 재검증 4)
  if (px === null || px > MAX_PIXELS) {
    console.error(`[heic-jpeg] 그림 크기를 못 읽었거나 너무 큼(${px ?? "?"} 화소, 상한 ${MAX_PIXELS}) — 원본 그대로 저장`);
    return null;
  }
  if (!hasCodecs()) return null;
  const timeoutMs = opts?.timeoutMs ?? TIMEOUT_MS;
  return oneAtATime(() => convertInWorker(buf, timeoutMs));
}

/**
 * 이미 디스크에 저장한 파일이 HEIC 면 같은 폴더에 「이름.jpg」로 바꿔 쓰고 원본을 지운다(스트리밍 업로드용).
 * 바꾼 파일 이름(폴더 빼고)을 돌려준다. HEIC 가 아니거나 못 바꾸면 null(원본은 그대로).
 */
export async function convertSavedHeic(dir: string, name: string): Promise<string | null> {
  const full = path.join(dir, name);
  let head: Buffer;
  try {
    const fh = await fs.open(full, "r");
    try { const b = Buffer.alloc(64); const { bytesRead } = await fh.read(b, 0, 64, 0); head = b.subarray(0, bytesRead); }
    finally { await fh.close(); }
  } catch { return null; }
  if (!looksHeic(head)) return null;
  const st = await fs.stat(full).catch(() => null);
  if (!st || st.size > MAX_INPUT_BYTES) return null;
  const jpg = await heicToJpeg(await fs.readFile(full));
  if (!jpg) return null;
  const next = jpgName(name);
  try {
    if (next === name) {
      // 이름이 이미 .jpg(내용만 HEIC) — 임시 파일에 쓰고 바꿔 끼운다(주소는 그대로)
      await fs.writeFile(`${full}.tmp`, jpg);
      await fs.rename(`${full}.tmp`, full);
    } else {
      await fs.writeFile(path.join(dir, next), jpg);
      await fs.unlink(full).catch(() => {});
    }
    return next;
  } catch (e) {
    console.error("[heic-jpeg] JPG 저장 실패 — 원본 그대로:", e instanceof Error ? e.message.slice(0, 200) : e);
    return null;
  }
}
