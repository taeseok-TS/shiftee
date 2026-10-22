// 연봉 화면 접근(2026-10-22 디렉터) — 「연봉 보기」 권한 + 들어갈 때 로그인 비밀번호 재확인.
//  · 볼 수 있는 사람: 관리자 중 메인 관리자(늘) + 메인 관리자가 「연봉 보기」를 켠 관리자(User.canViewSalary)
//  · 비밀번호를 맞히면 30분짜리 열쇠(httpOnly 쿠키, 이 사람·이 로그인 세션에 묶임)를 준다. 세션이 바뀌면(다른 기기·재로그인) 다시 묻는다
//  · 틀린 횟수 제한은 전자계약 본인 확인과 같은 표(lib/contract-pw — 5번 틀리면 15분 잠금)
//  · 연봉 API 는 모두 assertSalaryAccess 를 거친다. 응답은 캐시하지 않는다(no-store)
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import type { JWTPayload } from "@/lib/auth";

export const SALARY_COOKIE = "salary_unlock";
export const SALARY_UNLOCK_MIN = 30;
const secret = new TextEncoder().encode(`${process.env.JWT_SECRET || "fallback-secret-change-in-production"}:salary`);

type Session = JWTPayload & { iat?: number };
const sidOf = (s: Session) => (typeof s.iat === "number" ? s.iat : 0);

/** 연봉 화면을 볼 수 있는 관리자인가(비밀번호 재확인 전 단계) */
export async function canViewSalary(session: Session | null): Promise<boolean> {
  if (!session || session.role !== "ADMIN") return false;
  const u = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true, isSuperAdmin: true, canViewSalary: true, isActive: true, deletedAt: true } });
  // 토큰의 역할만 믿지 않는다 — 관리자에서 원장으로 바뀌면 남은 「연봉 보기」로 열리지 않게(검증)
  return !!u && u.isActive && !u.deletedAt && u.role === "ADMIN" && (u.isSuperAdmin || u.canViewSalary);
}

/** 비밀번호를 맞힌 뒤 주는 열쇠(쿠키 값) */
export async function issueSalaryKey(session: Session): Promise<string> {
  return new SignJWT({ uid: session.userId, sid: sidOf(session) })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${SALARY_UNLOCK_MIN}m`).sign(secret);
}

export const salaryCookie = (value: string, maxAgeSec: number) => ({
  name: SALARY_COOKIE, value, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge: maxAgeSec,
});

/** 권한 + 열쇠까지 확인. 실패면 { status, code, error } */
// 이 저장소는 strict 가 꺼져 있어 합집합으로 좁혀지지 않는다 — 한 모양으로(lib/contract-pw 와 같게)
export type SalaryGate = { ok: boolean; status?: number; code?: string; error?: string; expiresAt?: number };
export async function assertSalaryAccess(request: NextRequest, session: Session | null): Promise<SalaryGate> {
  if (!session) return { ok: false, status: 401, code: "AUTH", error: "인증이 필요합니다." };
  if (!(await canViewSalary(session))) return { ok: false, status: 403, code: "FORBIDDEN", error: "연봉 화면을 볼 권한이 없습니다." };
  const key = request.cookies.get(SALARY_COOKIE)?.value;
  if (!key) return { ok: false, status: 403, code: "LOCKED", error: "비밀번호를 다시 입력해 주세요." };
  try {
    const { payload } = await jwtVerify(key, secret);
    if (payload.uid !== session.userId || payload.sid !== sidOf(session)) return { ok: false, status: 403, code: "LOCKED", error: "비밀번호를 다시 입력해 주세요." };
    return { ok: true, expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : undefined };   // 화면이 이 시각에 스스로 잠근다
  } catch {
    return { ok: false, status: 403, code: "LOCKED", error: "비밀번호를 다시 입력해 주세요." };
  }
}

export const NO_STORE = { "Cache-Control": "no-store, private" };
