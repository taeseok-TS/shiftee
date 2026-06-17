import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret-change-in-production"
);

export type JWTPayload = {
  userId: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "EMPLOYEE";
  name: string;
  branch: string | null; // 소속 지점 (MANAGER: 관리 지점, EMPLOYEE: 소속 지점)
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
  return verifyToken(token);
}

export async function setSession(payload: JWTPayload): Promise<string> {
  const token = await signToken(payload);
  const cookieStore = await cookies();
  cookieStore.set("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
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
