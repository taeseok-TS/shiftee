import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { prisma } from "./db";

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
const g = globalThis as unknown as { __tvCache?: Map<string, { v: number; at: number }> };
const tvCache = g.__tvCache ?? (g.__tvCache = new Map());
const TV_TTL_MS = 30_000;

/** 그 사람의 현재 tokenVersion. 조회 실패면 null(= 판정을 건너뛴다 — 감시가 앱을 멈추면 안 된다). */
async function currentTokenVersion(userId: string): Promise<number | null> {
  const hit = tvCache.get(userId);
  if (hit && Date.now() - hit.at < TV_TTL_MS) return hit.v;
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
    if (!u) return null;
    tvCache.set(userId, { v: u.tokenVersion, at: Date.now() });
    return u.tokenVersion;
  } catch {
    return null;
  }
}

/**
 * 그 사람의 기존 토큰을 **전부 무효화**한다. 퇴사.비활성.권한변경.기기초기화 때 부른다.
 * 캐시를 함께 비워 다음 요청부터 곧바로 막힌다.
 */
export async function bumpTokenVersion(userId: string): Promise<void> {
  try {
    await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  } finally {
    tvCache.delete(userId);
  }
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
