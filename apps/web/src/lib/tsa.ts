import crypto from "crypto";
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
const TSA_URLS = (process.env.TSA_URLS || "http://timestamp.digicert.com,https://timestamp.sectigo.com")
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
  const status = resp[code.end - 1];
  if (code.end - code.start !== 1 || (status !== 0 && status !== 1)) throw new Error(`TSA 거절(상태 ${status})`);
  if (st.end >= top.end) throw new Error("TSA 응답에 도장이 없음");
  const at = resp.indexOf(hash, st.end);
  if (at < 0) throw new Error("TSA 도장에 우리 해시가 없음");
  if (resp.indexOf(nonce, st.end) < 0) throw new Error("TSA 도장에 요청 번호가 없음");
  for (let i = at + hash.length; i < Math.min(resp.length - 2, at + hash.length + 200); i++) {
    if (resp[i] !== 0x18) continue;
    const L = resp[i + 1];
    if (L < 15 || L > 24 || i + 2 + L > resp.length) continue;
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/.exec(resp.subarray(i + 2, i + 2 + L).toString("latin1"));
    if (!m) continue;
    const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    if (Math.abs(t.getTime() - now) > 24 * 3600 * 1000) throw new Error("TSA 시각이 지금과 하루 넘게 다름");
    return t;
  }
  throw new Error("TSA 도장에서 시각을 찾지 못함");
}

/** SHA-256(hex)에 시각 도장을 받는다 — 주소를 차례로 시도. 성공하면 응답(base64)·시각·주소. */
export async function requestTimestamp(sha256Hex: string): Promise<{ token: string; at: Date; url: string }> {
  const hash = Buffer.from(sha256Hex, "hex");
  if (hash.length !== 32) throw new Error("SHA-256 값이 아님");
  const nonce = crypto.randomBytes(8);
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
      return { token: resp.toString("base64"), at, url };
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`시각 인증 실패 — ${last instanceof Error ? last.message : String(last)}`);
}

/**
 * 고정본에 도장을 받아 저장 — **그 해시 그대로이고 아직 도장이 없을 때만**(그 사이 회수·재고정되면 쓰지 않는다).
 * 성공하면 true. 던지지 않는다(실패는 로그만 — 매시 점검이 다시 받는다).
 */
export async function stampFrozen(contractId: string, sha256: string): Promise<boolean> {
  try {
    const t = await requestTimestamp(sha256);
    const r = await prisma.contract.updateMany({
      where: { id: contractId, signedSha256: sha256, tsaToken: null },
      data: { tsaToken: t.token, tsaAt: t.at, tsaUrl: t.url },
    });
    if (r.count === 0) return false;
    await recordContractEvent({ contractId, type: "TSA", actorName: "시스템", meta: { url: t.url, at: t.at.toISOString(), sha256 } });
    return true;
  } catch (e) {
    console.error("[tsa] 시각 도장 실패(다음 점검에 다시):", contractId, e instanceof Error ? e.message : e);
    return false;
  }
}
