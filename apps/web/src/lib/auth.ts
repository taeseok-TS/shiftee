import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { prisma } from "./db";
import { isResigned } from "./resign";

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret-change-in-production"
);

export type JWTPayload = {
  userId: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "EMPLOYEE";
  name: string;
  branch: string | null; // 소속 지점 (MANAGER: 관리 지점, EMPLOYEE: 소속 지점)
  /** 세션 무효화용. 발급 시점의 User.tokenVersion — DB 값과 다르면 그 토큰은 죽은 것이다. */
  tv?: number;
};

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

// 토큰 무효화 판정용 캐시 (2026-09-07)
//
// getSession 은 **모든 요청**에서 불린다. 매번 DB 를 보면 비용이 붙으므로 짧게 캐시하되,
// 무효화(bumpTokenVersion)가 일어나면 그 사람 항목을 바로 지운다 — 그래서 "즉시" 가 된다.
// 캐시는 이 프로세스 안에만 있고 컨테이너는 하나다.
const g = globalThis as unknown as { __tvCache?: Map<string, { v: number; at: number }>; __tvEpoch?: number };
const tvCache = g.__tvCache ?? (g.__tvCache = new Map());
// 무효화가 일어난 횟수. 진행 중이던 DB 읽기가 **낡은 값으로 캐시를 되채우는** 것을 막는다 —
// 읽기 시작 시점의 값을 들고 있다가, 캐시에 쓰기 직전 달라졌으면 그 결과를 버린다.
// (이게 없으면 "퇴사 처리 완료" 화면을 본 뒤에도 옛 토큰이 최대 30초 통과했다 — 2026-09-07 검증)
const ep = () => (g.__tvEpoch ??= 0);
const TV_TTL_MS = 30_000;

/**
 * 그 사람의 현재 tokenVersion.
 *
 * 반환값 세 가지를 **구분해서** 쓴다 — 셋을 같은 값으로 뭉개면 사고가 난다.
 *   숫자  : 정상. 토큰의 tv 와 대조한다.
 *   null  : DB 조회가 실패했다 → 판정을 건너뛴다(fail-open). DB 가 한 번 흔들렸다고
 *           전원 로그아웃되면 안 되기 때문이다.
 *   NO_USER: 그런 사용자가 없다 → **무조건 막는다**(fail-closed). 하드 삭제된 계정의
 *           토큰이 남은 유효기간 동안 살아 있으면 안 된다(2026-09-07 검증에서 적발).
 */
export const NO_USER = Symbol("no-user");
async function currentTokenVersion(userId: string): Promise<number | null | typeof NO_USER> {
  const hit = tvCache.get(userId);
  if (hit && Date.now() - hit.at < TV_TTL_MS) return hit.v;
  const epoch = ep(); // DB 를 읽기 **전에** 찍어둔다
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
    if (!u) return NO_USER;
    // 읽는 사이에 무효화가 일어났으면 이 값은 이미 낡았다 — 캐시에 넣지 않는다.
    if (epoch === ep()) tvCache.set(userId, { v: u.tokenVersion, at: Date.now() });
    return u.tokenVersion;
  } catch {
    return null;
  }
}

/**
 * 그 사람의 기존 토큰을 **전부 무효화**한다. 퇴사.비활성.권한변경.기기초기화 때 부른다.
 * 캐시를 함께 비워 다음 요청부터 곧바로 막힌다.
 */
export async function bumpTokenVersion(userId: string): Promise<number> {
  try {
    const u = await prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    // 지우지 않고 **새 값으로 덮어쓴다**. 지우기만 하면 진행 중이던 읽기가
    // 옛 값으로 다시 채울 수 있다(위 epoch 검사와 한 쌍).
    tvCache.set(userId, { v: u.tokenVersion, at: Date.now() });
    return u.tokenVersion;
  } catch (e) {
    // 조용히 삼키면 안 된다 — 여기가 실패하면 퇴사자 토큰이 그대로 살아남는데
    // 화면에도 감사기록에도 아무 흔적이 없다. 오류 감시에 걸리도록 남긴다.
    console.error("[auth] 세션 무효화 실패:", userId, e);
    await prisma.systemErrorLog.create({
      data: {
        path: "/lib/auth (세션 무효화)", method: "INTERNAL",
        message: `세션 무효화 실패 — userId=${userId}. 이 사람의 기존 토큰이 아직 살아 있습니다.`,
      },
    }).catch(() => {});
    tvCache.delete(userId); // 실패했으면 캐시를 비워 다음 요청이 DB 를 다시 읽게 한다
    throw e;
  } finally {
    g.__tvEpoch = ep() + 1;
  }
}

/**
 * 여러 명의 토큰을 한 번에 무효화한다. 지점명 변경처럼 한 번에 수십 명의
 * `User.branch` 가 바뀌는 경우에 쓴다 — 토큰에 branch 가 박혀 있어서, 안 끊으면
 * 원장의 근태.직원 조회가 옛 지점명으로 조회돼 **조용히 빈 결과**가 된다
 * (2026-09-07 검증에서 적발).
 */
export async function bumpTokenVersionMany(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  try {
    const r = await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { tokenVersion: { increment: 1 } },
    });
    return r.count;
  } finally {
    for (const id of userIds) tvCache.delete(id);
    g.__tvEpoch = ep() + 1;
  }
}

/**
 * 이 세션이 아직 살아 있는가. 한 번 인증하고 **오래 유지되는 연결**(SSE 등)이
 * 주기적으로 스스로 확인할 때 쓴다 — 접속할 때 한 번만 보면, 무효화한 뒤에도
 * 이미 열린 연결로 이벤트가 계속 흘러간다(2026-09-07 검증에서 적발).
 * DB 조회 실패는 살아 있는 것으로 본다(getSession 과 같은 기준).
 */
export async function isSessionStillValid(payload: { userId: string; tv?: number }): Promise<boolean> {
  const cur = await currentTokenVersion(payload.userId);
  return cur === null || cur === (payload.tv ?? 0);
}

/**
 * 이 사람에게 **새 세션을 발급한다** — 로그인 이후의 모든 재발급은 반드시 이 문을 지난다.
 *
 * 왜 함수로 묶었나: 발급처가 늘 때마다 재직 검사를 베껴 쓰다 보니 같은 실수를 네 번 했다.
 * 마지막 것이 특히 나빴다 — 프로필에서 이름만 바꿔도 **재직 검사 없이 새 7일 세션**이
 * 나가서, 퇴사자가 7일마다 이름을 고치며 무기한 버틸 수 있었다(2026-09-08 검증에서 적발).
 * 이제 검사는 여기 한 곳에만 있고, 여기를 지나지 않으면 토큰이 나갈 수 없다.
 *
 * 반환 null = 발급 불가(계정 없음.비활성.퇴사). 부르는 쪽은 세션을 끝내야 한다.
 *
 * `setCookie` 는 헤더(Bearer)로 인증한 요청이면 false 로 넘긴다 — 앱에까지 쿠키를 심으면
 * getSession 이 쿠키를 Bearer 보다 먼저 보기 때문에, 뒤에 남은 쿠키가 헷갈릴 수 있다.
 *
 * ⚠ 로그인(`/api/auth/login`)만 예외다 — 거기는 비밀번호.기기 잠금까지 따로 본다.
 */
export async function issueSessionFor(
  userId: string,
  opts: { setCookie?: boolean } = {}
): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, name: true, branch: true,
              isActive: true, resignDate: true, tokenVersion: true },
  });
  if (!u || !u.isActive || isResigned(u.resignDate)) return null;
  // 옛 토큰의 값을 복사하지 않는다 — 그 사이 바뀐 이름.지점.권한이 낡은 채로 7일 더 연장된다.
  const payload = {
    userId: u.id, email: u.email, role: u.role, name: u.name,
    branch: u.branch ?? null, tv: u.tokenVersion,
  };
  return opts.setCookie === false ? signToken(payload) : setSession(payload);
}

export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  let token = cookieStore.get("token")?.value;

  // 웹은 httpOnly 쿠키 사용. 모바일 등 쿠키를 못 쓰는 클라이언트는
  // Authorization: Bearer <token> 헤더로 동일한 JWT를 전달한다.
  if (!token) {
    const authz = (await headers()).get("authorization");
    if (authz?.startsWith("Bearer ")) token = authz.slice(7);
  }

  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;

  // ⚠ 서명이 맞아도 **무효화된 토큰이면 거부**한다. 종전에는 퇴사 처리를 해도 이미 발급된
  //   7일짜리 토큰을 끊을 수단이 없어, 퇴사자가 앱을 켜둔 채면 계속 출퇴근을 찍을 수 있었다.
  //   tv 가 없는 옛 토큰은 0 으로 본다 — 무효화가 한 번이라도 있었으면 자연히 걸린다.
  // null(DB 장애)만 통과시킨다. NO_USER(계정 없음)는 숫자와도 다르므로 여기서 막힌다.
  const cur = await currentTokenVersion(payload.userId);
  if (cur !== null && cur !== (payload.tv ?? 0)) return null;
  return payload;
}

export async function setSession(payload: JWTPayload): Promise<string> {
  const token = await signToken(payload);
  const cookieStore = await cookies();
  cookieStore.set("token", token, {
    httpOnly: true,
    // HTTPS 환경에서만 Secure 권장. HTTP(임시) 배포에서는 COOKIE_SECURE=false로 끔.
    // COOKIE_SECURE 미설정 시 NODE_ENV 기준(운영=Secure).
    secure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7일
    path: "/",
  });
  return token;
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("token");
}

// 메인(최고) 관리자 여부 확인 — 시스템 설정/관리자 계정 관리 전용 권한
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperAdmin: true },
  });
  return !!u?.isSuperAdmin;
}
