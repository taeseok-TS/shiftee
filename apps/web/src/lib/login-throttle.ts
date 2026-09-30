// 로그인 시도 제한 (2026-09-30 디렉터 지시) — 비밀번호를 무한정 대입해 볼 수 없게.
//
// 두 겹으로 막는다.
//  ① 계정별: 15분 안에 비밀번호를 10번 틀리면 그 계정은 15분 잠긴다(맞는 비밀번호도 안 받는다).
//     실패 기록(LoginFailLog, 이미 있음)을 세므로 컨테이너가 재시작돼도 유지된다.
//     비밀번호를 재설정(셀프·관리자 초기화)하면 그 전 실패는 세지 않는다 → 재설정하면 바로 풀린다.
//     기준 근거: 8/24~9/29 실제 기록에서 헷갈린 직원이 15분에 10~29번 틀린 사례가 있었다.
//     더 빡빡하게 잡으면 멀쩡한 직원이 막히므로, 잠기면 재설정으로 즉시 풀 수 있게 안내한다.
//  ② 접속 주소(IP)별: 15분 안에 실패 50번이면 그 주소에서 오는 로그인을 15분 막는다.
//     여러 계정을 돌아가며 찔러보는 것(①로는 안 잡힌다)을 막는 몫. 지점 사무실은 한 주소를 같이
//     쓰므로 넉넉히 잡았다. 메모리에만 두므로 재시작하면 비워진다(단일 컨테이너라 충분).
import { prisma } from "@/lib/db";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_MAX_FAILS = 10;
export const IP_MAX_FAILS = 50;

export const ACCOUNT_LOCKED_MSG =
  "비밀번호를 여러 번 틀려 이 계정의 로그인이 잠시 잠겼습니다. 15분 뒤에 다시 시도하시거나, 「비밀번호를 잊으셨나요?」로 재설정하면 바로 로그인할 수 있습니다.";
export const IP_BLOCKED_MSG = "로그인 실패가 너무 많습니다. 15분 뒤에 다시 시도해주세요.";

/**
 * 접속 주소 — Caddy 가 x-forwarded-for 에 실제 접속 주소를 넣는다.
 * 사용자가 이 헤더를 직접 보내 와도 Caddy 가 붙이는 값은 **맨 뒤**라, 맨 뒤 값을 쓴다
 * (맨 앞 값은 사용자가 마음대로 바꿔 차단을 피할 수 있다).
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  const last = xff ? xff.split(",").map((s) => s.trim()).filter(Boolean).pop() : null;
  return (last || headers.get("x-real-ip") || "unknown").slice(0, 64);
}

// ─── ② IP 별 (메모리) ─────────────────────────────
const ipFails = new Map<string, number[]>();

function recent(list: number[] | undefined, now: number): number[] {
  return (list ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
}

export function ipBlocked(ip: string, now: number = Date.now()): boolean {
  const list = recent(ipFails.get(ip), now);
  if (list.length) ipFails.set(ip, list); else ipFails.delete(ip);
  return list.length >= IP_MAX_FAILS;
}

export function recordIpFail(ip: string, now: number = Date.now()): void {
  const list = recent(ipFails.get(ip), now);
  list.push(now);
  ipFails.set(ip, list);
  // 오래 쌓이지 않게 가끔 통째로 청소(주소가 많아져도 메모리가 늘지 않게)
  if (ipFails.size > 5000) for (const [k, v] of ipFails) if (!recent(v, now).length) ipFails.delete(k);
}

// ─── ① 계정별 (DB) ─────────────────────────────
/** 이 계정이 지금 잠겨 있는가 — 최근 15분(마지막 비밀번호 재설정 이후)의 비밀번호 틀림 횟수로 판정 */
export async function accountLocked(userId: string, now: Date = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const lastReset = await prisma.auditLog.findFirst({
    where: { targetId: userId, action: { in: ["PASSWORD_RESET", "PASSWORD_RESET_SELF"] }, createdAt: { gt: since } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const fails = await prisma.loginFailLog.count({
    where: { userId, reason: "BAD_PASSWORD", createdAt: { gt: lastReset?.createdAt ?? since } },
  });
  return fails >= ACCOUNT_MAX_FAILS;
}
