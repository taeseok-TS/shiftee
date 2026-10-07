import { prisma } from "@/lib/db";

// 근로자 본인 확인 비밀번호 — 틀린 횟수 제한(5번 → 15분 잠금). 서명 라우트와 문서 열기 관문(#20)이 같은 표를 쓴다.
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
  if ((meta?.sid ?? null) !== sid) return false;
  if (ok.deviceId || req.deviceId) return ok.deviceId === req.deviceId;
  return !!ok.userAgent && ok.userAgent === req.userAgent;
}
