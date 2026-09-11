// 외부(미가입) 계약자 본인 확인 — 등록된 연락처 뒷자리 4자리 (#205-1, 2026-09-11 디렉터 결정).
// 서명 링크만 있으면 누구나 계약서를 열람·서명할 수 있었다(이예지대리 #206-3). 문자 발송 서버가 아직 없어
// (알림톡 보류) 인증번호 대신 **관리자가 발송 때 입력한 연락처 뒷자리**를 확인한다.
//
// - 확인에 성공하면 그 단계에만 통하는 짧은 증표(2시간)를 준다. 업로드 티켓(uploads:)·완료본 티켓(signeddoc:)과
//   **다른 서명 도메인(extsign:)** 이라 서로 바꿔 쓸 수 없다 — 섞이면 업로드 경로의 우회로가 된다.
// - 4자리는 1만 가지뿐이라 **틀린 시도를 막는다**: 한 링크당 5번 틀리면 잠그고, 잠금이 거듭될수록 길게
//   (30분 → 1시간 → 2시간 … 최대 24시간, #205 검증 A5 — 고정 30분이면 링크 유효 14일 동안 약 34% 확률로 맞혔다).
//   프로세스 메모리라 재배포 때 풀린다(서버 1대, 재배포는 드물다).
import crypto from "crypto";

const secret = () => process.env.JWT_SECRET || "";
const TTL_MS = 2 * 3600 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 30 * 60 * 1000;

/** 연락처에서 숫자만 — 4자리 미만이면 확인할 수 없다(null) */
export function phoneLast4(phone: string | null | undefined): string | null {
  const d = (phone || "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : null;
}

/**
 * 외부 계약자 휴대폰 번호인가 — 01로 시작하는 10~11자리(하이픈·공백 무시). 외부 계약은 **작성·발송 때 필수**
 * (2026-09-11 디렉터: "외부 계약 발송 때 연락처를 필수로"). 본인 확인(뒷자리 4자리)과 서명 링크 전달에 쓴다.
 */
export function isValidMobile(phone: string | null | undefined): boolean {
  return /^01\d{8,9}$/.test((phone || "").replace(/\D/g, ""));
}

/** 화면 안내용 — 앞 3자리만 보이고 나머지는 가린다(뒷자리를 보여주면 확인이 무의미하다) */
export function phoneHint(phone: string | null | undefined): string | null {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length < 4) return null;
  return `${d.slice(0, 3)}-****-****`;
}

function mac(stepId: string, exp: number): string {
  return crypto.createHmac("sha256", secret()).update(`extsign:${stepId}:${exp}`).digest("hex").slice(0, 32);
}

export function issueExternalVerify(stepId: string): string {
  if (!secret()) throw new Error("JWT_SECRET 미설정");
  const exp = Date.now() + TTL_MS;
  return `${exp}.${mac(stepId, exp)}`;
}

export function checkExternalVerify(stepId: string, t: string | null | undefined): boolean {
  if (!t || !secret()) return false;
  const dot = t.indexOf(".");
  if (dot <= 0) return false;
  const exp = Number(t.slice(0, dot));
  const sig = t.slice(dot + 1);
  if (!exp || exp < Date.now() || sig.length !== 32) return false;
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac(stepId, exp))); } catch { return false; }
}

// 링크(단계)별 틀린 횟수 — globalThis 싱글턴(개발 모드 핫리로드에도 한 벌)
type Fail = { count: number; lockedUntil: number; locks: number };
const g = globalThis as unknown as { __extVerifyFails?: Map<string, Fail> };
const fails = (g.__extVerifyFails ??= new Map<string, Fail>());

/** 잠겨 있으면 풀리는 시각(ms), 아니면 0 */
export function lockedUntil(stepId: string): number {
  const f = fails.get(stepId);
  return f && f.lockedUntil > Date.now() ? f.lockedUntil : 0;
}

/** 뒷자리 확인 — 맞으면 기록을 지우고 true, 틀리면 횟수를 올리고 false */
export function tryLast4(stepId: string, phone: string | null | undefined, input: string): boolean {
  const want = phoneLast4(phone);
  const got = (input || "").replace(/\D/g, "");
  const ok = !!want && got.length === 4 &&
    crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (ok) { fails.delete(stepId); return true; }
  const f = fails.get(stepId) ?? { count: 0, lockedUntil: 0, locks: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) {
    f.locks += 1;
    f.lockedUntil = Date.now() + Math.min(LOCK_MS * 2 ** (f.locks - 1), 24 * 3600 * 1000);
    f.count = 0;
  }
  fails.set(stepId, f);
  return false;
}

// ── 문자 중계 링크 표식 (#205 검증 A1) ──
// 중계 페이지(/sms-relay)는 **번호 전체**로 문자 앱을 여는 곳이다. 서명 링크와 같은 토큰을 쓰면, 서명 링크를 받은 사람이
// 경로만 /sms-relay/ 로 바꿔 번호를 보고 그 뒷자리로 본인 확인을 통과할 수 있었다. 중계 링크는 사내 결재자에게만 가므로
// 서명 링크로는 **만들 수 없는** 별도 표식을 쓴다: "단계 id + HMAC(단계 id·현재 서명 토큰)". 서명 토큰이 바뀌면
// (재발송·결재 초기화) 중계 링크도 함께 무효가 된다. 로그인을 요구하지 않는 이유 — 앱 채팅에서 탭하면 폰 브라우저로
// 열리는데 거기엔 웹 로그인이 없다(문자 전달이 현장 관리자의 폰에서 이뤄지는 게 이 페이지의 존재 이유).
function relayMac(stepId: string, signToken: string): string {
  return crypto.createHmac("sha256", secret()).update(`smsrelay:${stepId}:${signToken}`).digest("hex").slice(0, 32);
}

export function relayToken(stepId: string, signToken: string): string {
  if (!secret()) throw new Error("JWT_SECRET 미설정");
  return `${stepId}.${relayMac(stepId, signToken)}`;
}

export function parseRelayToken(t: string): { stepId: string; sig: string } | null {
  const i = (t || "").lastIndexOf(".");
  if (i <= 0) return null;
  const sig = t.slice(i + 1);
  return sig.length === 32 ? { stepId: t.slice(0, i), sig } : null;
}

export function checkRelayToken(sig: string, stepId: string, signToken: string | null | undefined): boolean {
  if (!signToken || !secret()) return false;
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(relayMac(stepId, signToken))); } catch { return false; }
}
