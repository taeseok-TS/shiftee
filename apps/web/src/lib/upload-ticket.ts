// 업로드 파일 접근 티켓 — URL 이 유출돼도 수명이 지나면 무효가 되는 서명 토큰.
// 앱(RN Image·WebView)과 외부 게스트 서명, MS 오피스 온라인 뷰어처럼
// 세션 쿠키·Authorization 헤더를 실을 수 없는 접근 경로에 ?t= 로 부착한다.
//
// ⚠ 2026-09-02 이전에는 만료 시각만 서명해서 "누가 받았는지"가 없었다. 그래서 로그인만 하면
//   누구나 받는 티켓 하나가 업로드 폴더 전체의 12시간 마스터키였고, 계약서 접근 정책이
//   티켓 경로에서 통째로 우회됐다(앱은 항상 이 경로라 정책이 0% 적용). 이제 티켓에
//   **주체(subject)** 를 새겨 넣고, 받는 쪽이 그 주체로 권한을 다시 판정한다.
//     u:<userId>      로그인 사용자가 받은 티켓 — 그 사람 권한으로 판정
//     c:<contractId>  게스트(외부 계약자) 티켓 — 그 계약의 파일에만 통한다
import crypto from "crypto";

const secret = () => process.env.JWT_SECRET || "";

function sign(subject: string, exp: number): string {
  return crypto.createHmac("sha256", secret()).update(`uploads:${subject}:${exp}`).digest("hex").slice(0, 32);
}

export function issueUploadTicket(subject: string, ttlMs = 12 * 3600 * 1000): string {
  if (!secret()) throw new Error("JWT_SECRET 미설정 — 업로드 티켓을 발급할 수 없습니다.");
  if (!subject || subject.includes(".")) throw new Error("티켓 주체가 올바르지 않습니다.");
  const exp = Date.now() + ttlMs;
  return `${exp}.${subject}.${sign(subject, exp)}`;
}

/** 유효하면 주체를 돌려준다. 무효면 null. */
export function verifyUploadTicket(t: string | null | undefined): { subject: string } | null {
  if (!t || !secret()) return null; // 시크릿이 비면 어떤 티켓도 인정하지 않는다 (빈 키 HMAC 위조 방지)
  const parts = t.split(".");
  if (parts.length !== 3) return null;
  const [expRaw, subject, sig] = parts;
  const exp = Number(expRaw);
  if (!exp || exp < Date.now() || !subject || sig.length !== 32) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(subject, exp)))) return null;
  } catch {
    return null;
  }
  return { subject };
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
