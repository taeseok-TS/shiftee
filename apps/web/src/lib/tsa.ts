import crypto from "crypto";
import { execFile } from "child_process";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { recordContractEvent } from "@/lib/contract-events";

/**
 * 제3자 시각 인증(TSA, RFC 3161) — 9/12 디렉터 "해외 무료 먼저". 완료본 고정(#205-5)의 SHA-256 에 시각 도장을 받아
 * "이 문서가 그 시각에 존재했고 이후 바뀌지 않았다"를 우리 서버 밖(발급 기관 서명)으로 증명한다.
 *
 * - 무료 공개 TSA: DigiCert → 실패 시 Sectigo. 법적 인정 지위는 없는 **기술적 증거**. 국내 유료로 바꿀 땐 TSA_URLS 만 바꾼다.
 * - 응답(TimeStampResp DER)을 **통째로** 보관한다 — 누구나 `openssl ts -verify -in 응답.tsr -data 받은.pdf -CAfile …` 로 검증.
 * - 외부 라이브러리 없이 요청 DER 을 직접 만들고, 응답은 상태·우리 해시·요청 번호(nonce)·시각만 확인한다(서명 검증은 openssl 로 사후에).
 * - 실패해도 고정·서명은 그대로다(도장만 나중에 매시 점검이 다시 받는다). 던지지 않는다.
 */
// 보안 연결(https) 먼저 — 서명 검증을 하지 않으므로 전송 구간 위조를 https 로 막는다(2cdaf5c 검증 3). http 는 예비.
const TSA_URLS = (process.env.TSA_URLS || "https://timestamp.sectigo.com,http://timestamp.digicert.com")
  .split(",").map((u) => u.trim()).filter(Boolean);

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const b: number[] = [];
  while (n > 0) { b.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
}
const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);

// TimeStampReq ::= SEQUENCE { version 1, messageImprint { sha256, hash }, nonce INTEGER, certReq TRUE }
export function buildTimeStampReq(hash: Buffer, nonce: Buffer): Buffer {
  const sha256Oid = Buffer.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]); // 2.16.840.1.101.3.4.2.1
  const algId = tlv(0x30, Buffer.concat([tlv(0x06, sha256Oid), Buffer.from([0x05, 0x00])]));
  const imprint = tlv(0x30, Buffer.concat([algId, tlv(0x04, hash)]));
  const n = nonce[0] & 0x80 ? Buffer.concat([Buffer.from([0]), nonce]) : nonce; // 양수 INTEGER
  return tlv(0x30, Buffer.concat([tlv(0x02, Buffer.from([1])), imprint, tlv(0x02, n), Buffer.from([0x01, 0x01, 0xff])]));
}

function readTlv(b: Buffer, off: number) {
  if (off + 2 > b.length) throw new Error("DER 잘림");
  let len = b[off + 1];
  let hdr = 2;
  if (len & 0x80) {
    const k = len & 0x7f;
    if (k < 1 || k > 4) throw new Error("DER 길이 이상");
    len = 0;
    for (let i = 0; i < k; i++) len = len * 256 + b[off + 2 + i];
    hdr = 2 + k;
  }
  if (off + hdr + len > b.length) throw new Error("DER 잘림");
  return { tag: b[off], start: off + hdr, end: off + hdr + len };
}

/** 응답 확인 — 발급(0·1) 상태, 우리 해시·요청 번호 포함, 해시 뒤의 GeneralizedTime(TSTInfo.genTime)이 지금과 하루 안. 시각을 돌려준다. */
export function parseTimeStampResp(resp: Buffer, hash: Buffer, nonce: Buffer, now = Date.now()): Date {
  const top = readTlv(resp, 0);
  if (resp[0] !== 0x30) throw new Error("TSA 응답 형식 아님");
  const st = readTlv(resp, top.start);
  const code = readTlv(resp, st.start);
  if (resp[top.start] !== 0x30 || resp[st.start] !== 0x02) throw new Error("TSA 응답 상태 형식 아님");
  // 하위 요소가 상위 경계를 넘거나, 최상위 뒤에 꼬리 바이트가 붙은 응답은 받지 않는다 — 찾기는 최상위 안에서만(2cdaf5c 검증 3)
  if (st.end > top.end || code.end > st.end || top.end !== resp.length) throw new Error("TSA 응답 경계 이상");
  const status = resp[code.end - 1];
  if (code.end - code.start !== 1 || (status !== 0 && status !== 1)) throw new Error(`TSA 거절(상태 ${status})`);
  if (st.end >= top.end) throw new Error("TSA 응답에 도장이 없음");
  const at = resp.indexOf(hash, st.end);
  if (at < 0) throw new Error("TSA 도장에 우리 해시가 없음");
  if (resp.indexOf(nonce, st.end) < 0) throw new Error("TSA 도장에 요청 번호가 없음");
  for (let i = at + hash.length; i < Math.min(resp.length - 2, at + hash.length + 200); i++) {
    if (resp[i] !== 0x18) continue;
    const L = resp[i + 1];
    if (L < 15 || L > 30 || i + 2 + L > resp.length) continue; // 소수점 초 자릿수가 긴 표기도(2cdaf5c 검증 5)
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/.exec(resp.subarray(i + 2, i + 2 + L).toString("latin1"));
    if (!m) continue;
    const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    if (Math.abs(t.getTime() - now) > 24 * 3600 * 1000) throw new Error("TSA 시각이 지금과 하루 넘게 다름");
    return t;
  }
  throw new Error("TSA 도장에서 시각을 찾지 못함");
}

// 도장 서명 검증에 쓰는 신뢰 루트 — 컨테이너(Debian)의 시스템 인증서 묶음. 로컬 시험은 TSA_CAFILE 로 바꾼다.
const CA_FILE = process.env.TSA_CAFILE || "/etc/ssl/certs/ca-certificates.crt";

/**
 * 도장의 **발급 기관 서명·인증서 사슬**을 openssl 로 확인한다 — 우리 해시에 대해 신뢰 루트까지 이어지는 서명인가.
 * 종전엔 형식(해시·요청 번호·시각)만 봐서, 전송 구간에서 서명 없는 가짜 도장을 넣으면 그대로 저장됐다(8bedf07 검증 3).
 * 실패하면 던진다 → 다음 발급처로 넘어가고, 모두 실패하면 저장하지 않는다(다음 점검에 다시).
 */
export async function verifyTsaSignature(resp: Buffer, sha256Hex: string): Promise<void> {
  if (!/^[0-9a-f]{64}$/i.test(sha256Hex)) throw new Error("SHA-256 값이 아님");
  const f = path.join(os.tmpdir(), `tsa-${crypto.randomBytes(6).toString("hex")}.tsr`);
  await fs.writeFile(f, resp);
  try {
    await new Promise<void>((resolve, reject) => {
      execFile("openssl", ["ts", "-verify", "-digest", sha256Hex, "-in", f, "-CAfile", CA_FILE], { timeout: 15_000 },
        (err, stdout, stderr) => {
          if (!err && /Verification: OK/.test(stdout)) resolve();
          else reject(new Error(`도장 서명 검증 실패 — ${String(stderr || stdout || err).trim().replace(/\s+/g, " ").slice(0, 200)}`));
        });
    });
  } finally {
    await fs.unlink(f).catch(() => {});
  }
}

// 요청 간격 — Sectigo 공개 TSA 는 요청 사이 15초 이상을 권한다. 매시 점검·패키지 완료(여러 문서 동시 고정)의 요청을
// 한 줄로 세워 간격을 둔다(8bedf07 검증 권고). 프로세스 전역(개발 핫리로드에도 한 줄).
const TSA_GAP_MS = 15_000;
const gq = globalThis as unknown as { __tsaQueue?: Promise<unknown>; __tsaLast?: number };
function spaced<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = (gq.__tsaLast ?? 0) + TSA_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await fn(); } finally { gq.__tsaLast = Date.now(); }
  };
  const p = (gq.__tsaQueue ?? Promise.resolve()).then(run, run);
  gq.__tsaQueue = p.catch(() => {});
  return p;
}

/** SHA-256(hex)에 시각 도장을 받는다 — 요청 간격을 지키며, 주소를 차례로 시도. 성공하면 응답(base64)·시각·주소. */
export function requestTimestamp(sha256Hex: string): Promise<{ token: string; at: Date; url: string }> {
  return spaced(() => requestTimestampOnce(sha256Hex));
}

async function requestTimestampOnce(sha256Hex: string): Promise<{ token: string; at: Date; url: string }> {
  const hash = Buffer.from(sha256Hex, "hex");
  if (hash.length !== 32) throw new Error("SHA-256 값이 아님");
  const nonce = crypto.randomBytes(8);
  // 첫 바이트를 1~127 로 — 0 으로 시작하면 INTEGER 앞자리 0 이 규격 위반(openssl "illegal padding")이 되고,
  // 128 이상이면 앞에 0 을 붙여야 해 응답 대조가 어긋날 수 있다(2cdaf5c 검증 2)
  nonce[0] = (nonce[0] & 0x7f) | 0x01;
  const req = buildTimeStampReq(hash, nonce);
  let last: unknown = null;
  for (const url of TSA_URLS) {
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/timestamp-query" },
        body: new Uint8Array(req), signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const resp = Buffer.from(await r.arrayBuffer());
      const at = parseTimeStampResp(resp, hash, nonce);
      await verifyTsaSignature(resp, sha256Hex); // 발급 기관 서명까지 확인된 도장만 저장
      return { token: resp.toString("base64"), at, url };
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`시각 인증 실패 — ${last instanceof Error ? last.message : String(last)}`);
}

/** 저장된 도장이 **지금 고정본 해시**에 대한 것인가 — 공개 경로는 이 확인을 거친 도장만 보인다(2cdaf5c 검증 1 방어). */
export function tsaMatches(tsaToken: string | null | undefined, sha256: string | null | undefined): boolean {
  if (!tsaToken || !sha256 || !/^[0-9a-f]{64}$/i.test(sha256)) return false;
  return Buffer.from(tsaToken, "base64").indexOf(Buffer.from(sha256, "hex")) >= 0;
}

/**
 * 고정본에 도장을 받아 저장 — **그 해시 그대로이고 아직 도장이 없을 때만**(그 사이 회수·재고정되면 쓰지 않는다).
 * true = 받음, null = 건너뜀(그 사이 바뀌었거나 이미 받음 — 실패 아님), false = 실패. 던지지 않는다(실패는 로그만).
 */
export async function stampFrozen(contractId: string, sha256: string): Promise<boolean | null> {
  try {
    const t = await requestTimestamp(sha256);
    const r = await prisma.contract.updateMany({
      where: { id: contractId, signedSha256: sha256, tsaToken: null },
      data: { tsaToken: t.token, tsaAt: t.at, tsaUrl: t.url },
    });
    if (r.count === 0) return null;
    await recordContractEvent({ contractId, type: "TSA", actorName: "시스템", meta: { url: t.url, at: t.at.toISOString(), sha256 } });
    return true;
  } catch (e) {
    console.error("[tsa] 시각 도장 실패(다음 점검에 다시):", contractId, e instanceof Error ? e.message : e);
    return false;
  }
}
