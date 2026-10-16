import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

// 전자계약 본인 확인 비밀번호 — 틀린 횟수 제한(5번 → 15분 잠금). 서명 라우트와 문서 열기 관문(#20)이 같은 표를 쓴다.
// 2026-10-16 본부 결정(#220-3): 근로자뿐 아니라 본부·원장 등 **모든 사내 결재자**도 승인·서명 때 이 표·이 함수로 확인한다.
// (로그인 시도 제한 lib/login-throttle 과는 별개 표 — 로그인 잠금에 영향을 주지 않는다)
// globalThis 싱글턴(개발 핫리로드에도 한 벌). 서버 1대라 프로세스 메모리로 충분하다.
const gpw = globalThis as unknown as { __signPwFails?: Map<string, { count: number; until: number }> };
export const pwFails = (gpw.__signPwFails ??= new Map<string, { count: number; until: number }>());
// 시도를 **비교 전에** 센다(#205 검증 A4) — 확인과 기록 사이에 DB 조회·bcrypt(비동기)가 끼면 동시 요청 N개가 모두
// 비교됐다. 여기는 동기 코드라 확인과 계수가 한 번에 일어난다. 잠겨 있으면 풀리는 시각(ms), 아니면 0. 성공하면 기록을 지운다.
export const pwTakeAttempt = (u: string): number => {
  const f = pwFails.get(u) ?? { count: 0, until: 0 };
  if (f.until > Date.now()) return f.until;
  f.count += 1;
  if (f.count >= 5) { f.until = Date.now() + 15 * 60 * 1000; f.count = 0; }
  pwFails.set(u, f);
  return 0;
};

/** 문서 열기 전 비밀번호 확인(#20)이 유효한가 — 이 계약·이 단계·이 사람이 30분 안에, 이번 발송 회차에서 확인했는가 */
export const UNLOCK_MS = 30 * 60 * 1000;
export const UNLOCK_VIA = "문서 열기 전 비밀번호";
// 같은 기기에서만 — 폰에서 확인하고 지점 공용 PC(같은 계정 로그인)에서 비밀번호 없이 서명되지 않게(#20 검증 D4).
// 기기 번호(앱 x-device-id)가 있으면 그것으로, 없으면(웹) 브라우저 정보(user-agent)로 맞춘다.
// 발송·재발송·결재 초기화·회수, 그리고 이 사람의 서명 뒤에는 앞선 확인을 쓰지 않는다(회수 뒤 다시 서명할 때 다시 확인).
// 같은 브라우저 종류를 쓰는 다른 PC(같은 계정 로그인)는 user-agent 가 같을 수 있어(#20 재검증 R1) **로그인 세션**(토큰 발급 시각)도 맞춘다.
// 세션이 갱신되면(슬라이딩 재발급) 다시 확인을 받는 안전한 쪽으로 실패한다.
export const sessionMark = (session: unknown): number | null => {
  const iat = (session as { iat?: unknown } | null)?.iat;
  return typeof iat === "number" ? iat : null;
};
export async function recentUnlock(contractId: string, userId: string, stepOrder: number, req: { userAgent: string | null; deviceId: string | null }, sid: number | null): Promise<boolean> {
  const since = new Date(Date.now() - UNLOCK_MS);
  const round = await prisma.contractEvent.findFirst({
    where: { contractId, OR: [{ type: { in: ["SENT", "RESEND", "RESET", "REVOKED"] } }, { type: "SIGNED", actorId: userId }] },
    orderBy: { createdAt: "desc" }, select: { createdAt: true },
  });
  const after = round && round.createdAt > since ? round.createdAt : since;
  const ok = await prisma.contractEvent.findFirst({
    where: { contractId, type: "VERIFY_OK", actorId: userId, stepOrder, createdAt: { gt: after } },
    select: { id: true, meta: true, userAgent: true, deviceId: true },
    orderBy: { createdAt: "desc" },
  });
  const meta = ok?.meta as { via?: string; sid?: number | null } | null;
  if (!ok || meta?.via !== UNLOCK_VIA) return false;
  // 로그인 세션 맞춤은 **웹(기기 번호 없음)만** — 앱은 기기 번호로 이미 묶여 있고, 앱으로 돌아올 때마다 토큰이 갱신돼
  // (AuthContext) 세션까지 보면 문서를 보고 돌아올 때마다 다시 확인을 받게 된다(#20 재검증 R1)
  if (!ok?.deviceId && !req.deviceId && (meta?.sid ?? null) !== sid) return false;
  if (ok.deviceId || req.deviceId) return ok.deviceId === req.deviceId;
  return !!ok.userAgent && ok.userAgent === req.userAgent;
}

// 결과 — 실패면 status·code·error 를 그대로 응답에 싣는다(이 저장소는 strict 가 꺼져 있어 ok 로 좁히는 합집합 대신 한 모양으로)
export type ContractPwResult = { ok: boolean; checked?: boolean; status?: 400 | 429; code?: string; error?: string };

/** 로그인 비밀번호 대조 — 틀린 횟수 제한 포함. 문서 열기 관문(unlock)과 서명·승인(verifySignPassword)이 이 한 함수를 쓴다.
 *  ⚠ 시도 계수(pwTakeAttempt)는 비교(DB·bcrypt, 비동기)보다 **먼저**, 사이에 await 없이 — 동시 요청 우회 방지(#205 검증 A4) */
export async function checkContractPassword(userId: string, password: string): Promise<ContractPwResult> {
  const lock = pwTakeAttempt(userId);
  if (lock) return { ok: false, status: 429, code: "PASSWORD_LOCKED", error: `비밀번호를 여러 번 틀렸습니다. ${Math.ceil((lock - Date.now()) / 60000)}분 뒤에 다시 시도해 주세요.` };
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
  if (!me?.password || !(await bcrypt.compare(password, me.password)))
    return { ok: false, status: 400, code: "PASSWORD_MISMATCH", error: "비밀번호가 맞지 않습니다." };
  pwFails.delete(userId);
  return { ok: true };
}

/**
 * 서명·승인 때 본인 확인 — 근로자 본인 서명(#205-1)과 사내 결재자 승인(#220-3, 2026-10-16 본부 결정)이 같은 함수를 쓴다.
 * 비밀번호를 보냈으면 그것으로 확인하고(checked=true → 호출부가 서명 확정 뒤 VERIFY_OK 「서명 때 비밀번호」를 남긴다),
 * 안 보냈으면 문서 열기 전 확인(#20, 30분·같은 기기·이번 회차)이 있는지 본다 — 그 기록은 근로자 본인 단계에만 생긴다.
 * 응답은 401 이 아니라 400/429 — 앱은 401 을 「로그인 만료」로 보고 로그아웃시킨다.
 */
export async function verifySignPassword(input: {
  contractId: string; userId: string; stepOrder: number; password: unknown;
  req: { userAgent: string | null; deviceId: string | null }; sid: number | null;
  requiredMessage: string;
}): Promise<ContractPwResult> {
  const pw = typeof input.password === "string" && input.password ? input.password : null;
  if (!pw && (await recentUnlock(input.contractId, input.userId, input.stepOrder, input.req, input.sid))) return { ok: true, checked: false };
  if (!pw) return { ok: false, status: 400, code: "PASSWORD_REQUIRED", error: input.requiredMessage };
  const r = await checkContractPassword(input.userId, pw);
  return r.ok ? { ok: true, checked: true } : r;
}
