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
export async function recentUnlock(contractId: string, userId: string, stepOrder: number): Promise<boolean> {
  const since = new Date(Date.now() - UNLOCK_MS);
  const round = await prisma.contractEvent.findFirst({
    where: { contractId, type: { in: ["SENT", "RESEND", "RESET"] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true },
  });
  const after = round && round.createdAt > since ? round.createdAt : since;
  const ok = await prisma.contractEvent.findFirst({
    where: { contractId, type: "VERIFY_OK", actorId: userId, stepOrder, createdAt: { gt: after } },
    select: { id: true, meta: true },
    orderBy: { createdAt: "desc" },
  });
  return !!ok && (ok.meta as { via?: string } | null)?.via === UNLOCK_VIA;
}
