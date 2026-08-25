// 업로드 파일 접근 티켓 — URL 이 유출돼도 수명이 지나면 무효가 되는 서명 토큰.
// 앱(RN Image·WebView)과 외부 게스트 서명, MS 오피스 온라인 뷰어처럼
// 세션 쿠키·Authorization 헤더를 실을 수 없는 접근 경로에 ?t= 로 부착한다.
// 사용자별 권한 판정이 아니라 "인증을 거친 접근"임을 증명하는 용도 — 파일명 자체가
// 타임스탬프+랜덤이라 추측 불가이므로, 목표는 유출 URL 의 영구 접근 차단이다.
import crypto from "crypto";

const secret = () => process.env.JWT_SECRET || "";

export function issueUploadTicket(ttlMs = 12 * 3600 * 1000): string {
  if (!secret()) throw new Error("JWT_SECRET 미설정 — 업로드 티켓을 발급할 수 없습니다.");
  const exp = Date.now() + ttlMs;
  const sig = crypto.createHmac("sha256", secret()).update("uploads:" + exp).digest("hex").slice(0, 32);
  return `${exp}.${sig}`;
}

export function verifyUploadTicket(t: string | null | undefined): boolean {
  if (!t || !secret()) return false; // 시크릿이 비면 어떤 티켓도 인정하지 않는다 (빈 키 HMAC 위조 방지)
  const dot = t.indexOf(".");
  if (dot <= 0) return false;
  const exp = Number(t.slice(0, dot));
  const sig = t.slice(dot + 1);
  if (!exp || exp < Date.now() || sig.length !== 32) return false;
  const good = crypto.createHmac("sha256", secret()).update("uploads:" + exp).digest("hex").slice(0, 32);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
  } catch {
    return false;
  }
}

// 완료본 열람 티켓 — 특정 계약 1건에만 유효한 단기 서명(기본 30분).
// 앱이 외부 브라우저로 PDF 완료본을 열 때 사용: 권한(당사자·관리자)은 발급 API에서
// 세션으로 검증하고, 이 티켓은 "그 검증을 통과한 요청"임을 계약 단위로 증명한다.
export function issueSignedDocTicket(contractId: string, ttlMs = 30 * 60 * 1000): string {
  if (!secret()) throw new Error("JWT_SECRET 미설정");
  const exp = Date.now() + ttlMs;
  const sig = crypto.createHmac("sha256", secret()).update(`signeddoc:${contractId}:${exp}`).digest("hex").slice(0, 32);
  return `${exp}.${sig}`;
}

export function verifySignedDocTicket(contractId: string, t: string | null | undefined): boolean {
  if (!t || !secret()) return false;
  const dot = t.indexOf(".");
  if (dot <= 0) return false;
  const exp = Number(t.slice(0, dot));
  const sig = t.slice(dot + 1);
  if (!exp || exp < Date.now() || sig.length !== 32) return false;
  const good = crypto.createHmac("sha256", secret()).update(`signeddoc:${contractId}:${exp}`).digest("hex").slice(0, 32);
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)); } catch { return false; }
}
