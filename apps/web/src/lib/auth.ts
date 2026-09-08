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
    // ⚠ 서명이 맞다고 **모양까지 맞는 건 아니다.** 종전에는 검사 없이 캐스팅해서,
    //   userId 가 없는 토큰이 그대로 세션이 됐다. 그런 세션으로 조회하면 Prisma 가
    //   필터를 통째로 버려 **전 직원 명부와 남의 DM 목록이 통째로 나왔다**
    //   (2026-09-08 7차 검증에서 실증). 여기서 모양을 먼저 본다.
    const p = payload as unknown as JWTPayload;
    if (typeof p.userId !== "string" || p.userId === "") return null;
    if (p.role !== "ADMIN" && p.role !== "MANAGER" && p.role !== "EMPLOYEE") return null;
    if (typeof p.email !== "string" || typeof p.name !== "string") return null;
    // branch 도 반드시 본다. 여기만 비워두면 위조 토큰이 branch 에 객체를 넣어
    // 지점 필터를 통째로 무력화할 수 있다 — `where:{branch:{}}` 는 전 지점을 반환한다
    // (2026-09-08 8차 검증에서 운영 DB 로 실측). 좌표 없는 본부 소속은 null 이다.
    if (p.branch !== null && typeof p.branch !== "string") return null;
    if (p.tv !== undefined && typeof p.tv !== "number") return null;
    return p;
  } catch {
    return null;
  }
}

// 토큰 무효화 판정용 캐시 (2026-09-07)
//
// getSession 은 **모든 요청**에서 불린다. 매번 DB 를 보면 비용이 붙으므로 짧게 캐시하되,
// 무효화(bumpTokenVersion)가 일어나면 그 사람 항목을 바로 지운다 — 그래서 "즉시" 가 된다.
// 캐시는 이 프로세스 안에만 있고 컨테이너는 하나다.
type TvEntry = { v: number; at: number; blocked: boolean };
const g = globalThis as unknown as { __tvCache?: Map<string, TvEntry>; __tvEpoch?: number };
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
async function currentUserState(userId: string): Promise<TvEntry | null | typeof NO_USER> {
  const hit = tvCache.get(userId);
  if (hit && Date.now() - hit.at < TV_TTL_MS) return hit;
  const epoch = ep(); // DB 를 읽기 **전에** 찍어둔다
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true, isActive: true, resignDate: true },
    });
    if (!u) return NO_USER;
    // 퇴사.비활성이면 토큰이 뭐든 통과시키지 않는다. 무효화(bump)를 거치지 않는 경로가
    // 있기 때문이다 — 미래 퇴사일이 지나는 순간은 아무도 bump 하지 않는다(배치 없음).
    const entry: TvEntry = {
      v: u.tokenVersion,
      at: Date.now(),
      blocked: !u.isActive || isResigned(u.resignDate),
    };
    // 읽는 사이에 무효화가 일어났으면 이 값은 이미 낡았다 — 캐시에 넣지 않는다.
    if (epoch === ep()) tvCache.set(userId, entry);
    return entry;
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
    // 지우기만 하면 진행 중이던 읽기가 옛 값으로 다시 채울 수 있다(위 epoch 검사와 한 쌍).
    // 재직 여부는 여기서 알 수 없으므로 캐시를 비워 다음 조회가 DB 를 다시 읽게 한다.
    tvCache.delete(userId);
    // 푸시 등록도 함께 끊는다. 안 끊으면 세션이 죽은 기기로 **채팅 본문 미리보기**가
    // 계속 간다 — 앱은 로그아웃할 때 스스로 해제하는데, 강제 무효화 경로에서는 그 시점
    // 토큰이 이미 죽어 해제 요청이 401 로 튕긴다(2026-09-08 9차 검증에서 운영 실측).
    // 계속 쓰는 기기는 앱이 포그라운드로 돌아올 때 다시 등록한다.
    await prisma.pushToken.deleteMany({ where: { userId } }).catch(() => {});
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
/**
 * 그 사람의 세션 캐시만 비운다(DB 쓰기 없음).
 * 하드 삭제처럼 **행 자체가 사라지는** 경우에 쓴다 — bump 는 update 라 쓸 수 없는데,
 * 캐시가 남아 있으면 삭제된 사람의 토큰이 최대 30초 더 통과한다(2026-09-08 적발).
 */
export function clearSessionCache(userId: string): void {
  tvCache.delete(userId);
  g.__tvEpoch = ep() + 1;
}

export async function bumpTokenVersionMany(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  try {
    const r = await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { tokenVersion: { increment: 1 } },
    });
    // 단건 무효화와 같은 이유로 푸시 등록도 함께 끊는다(위 주석 참고).
    await prisma.pushToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    return r.count;
  } catch (e) {
    // 단건 무효화와 같은 기준으로 흔적을 남긴다. 여기가 조용히 실패하면 지점명을 바꿔도
    // 수십 명의 옛 지점 토큰이 살아남는데 화면.감사.오류감시 어디에도 안 남는다.
    console.error("[auth] 세션 일괄 무효화 실패:", userIds.length, e);
    await prisma.systemErrorLog.create({
      data: {
        path: "/lib/auth (세션 일괄 무효화)", method: "INTERNAL",
        message: `세션 일괄 무효화 실패 — 대상 ${userIds.length}명. 이들의 기존 토큰이 아직 살아 있습니다.`,
      },
    }).catch(() => {});
    throw e;
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
  const cur = await currentUserState(payload.userId);
  if (cur === null) return true;      // DB 장애는 살아 있는 것으로 본다
  if (cur === NO_USER) return false;
  return !cur.blocked && cur.v === (payload.tv ?? 0);
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
 * 쿠키를 갱신할지는 **이미 쿠키를 들고 다니는가**로 정한다. 헤더 유무로 정하면 안 된다 —
 * 로그인은 앱에도 Set-Cookie 를 내려보내고 getSession 은 쿠키를 Bearer 보다 먼저 보므로,
 * 앱이라고 쿠키를 안 갱신하면 **낡은 쿠키가 새 토큰을 이겨** 그 자리에서 401 이 된다
 * (2026-09-08 6차 검증에서 실측). 쿠키가 없던 클라이언트에만 새로 심지 않는다.
 *
 * ⚠ 로그인(`/api/auth/login`)만 예외다 — 거기는 비밀번호.기기 잠금까지 따로 본다.
 */
export async function issueSessionFor(
  userId: string,
  opts: { setCookie?: boolean } = {}
): Promise<string | null> {
  // 부르는 쪽이 정하지 않으면: 쿠키가 이미 있으면 갱신, 없으면 심지 않는다.
  let setCookie = opts.setCookie;
  if (setCookie === undefined) {
    const c = await cookies();
    // 쿠키로 다니고 있으면 반드시 갱신한다(안 하면 낡은 쿠키가 새 토큰을 이긴다).
    // 쿠키가 없으면 심지 않는다 — 헤더로만 다니는 클라이언트에 자격증명을 하나 더
    // 만들어 주면, 그게 나중에 낡아서 사고를 낸다.
    setCookie = !!c.get("token");
  }
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
  return setCookie ? setSession(payload) : signToken(payload);
}

export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();

  // 웹은 httpOnly 쿠키, 모바일은 Authorization: Bearer 로 같은 JWT 를 보낸다.
  //
  // ⚠ 둘 다 온 경우 **쿠키만 보고 끝내면 안 된다.** 로그인은 앱에도 쿠키를 내려보내므로
  //   앱에는 쿠키가 남아 있고, 그 쿠키가 어떤 이유로든 낡으면 **멀쩡한 Bearer 를 들고도
  //   401** 이 난다(2026-09-08 6차 검증에서 실측). 그래서 온 것을 순서대로 다 본다.
  //   후보마다 서명.무효화.재직을 똑같이 검사하므로 이것이 통과 기준을 낮추지는 않는다.
  const candidates: string[] = [];
  const cookieToken = cookieStore.get("token")?.value;
  if (cookieToken) candidates.push(cookieToken);
  const authz = (await headers()).get("authorization");
  if (authz?.startsWith("Bearer ")) {
    const bearer = authz.slice(7);
    if (bearer && bearer !== cookieToken) candidates.push(bearer);
  }
  if (candidates.length === 0) return null;

  // 1차: **DB 로 확인까지 끝난** 후보를 먼저 찾는다.
  // 2차: 아무도 확인되지 않았을 때만 "DB 장애로 판정을 못 한" 후보를 받아들인다.
  //      이 순서가 없으면, DB 가 흔들리는 동안 첫 후보(낡은 쿠키)가 통과로 처리돼
  //      멀쩡한 두 번째 후보를 아예 보지 않는다(2026-09-08 7차 검증에서 적발).
  let degraded: JWTPayload | null = null;
  const rejected = new Set<string>(); // 확정으로 거부된 사람
  for (const token of candidates) {
    const r = await verifySessionToken(token);
    if (r.ok) return r.payload;
    if (r.degraded) { if (!degraded) degraded = r.payload; }
    else if (r.payload) rejected.add(r.payload.userId);
  }
  // 같은 사람에 대해 **확정 거부**가 한 번이라도 나왔으면, 다른 후보가 DB 장애로
  // 판정을 못 했다는 이유로 통과시키지 않는다. 안 그러면 차단된 사람이 DB 가
  // 순간 흔들리는 틈에 옛 자격증명으로 들어온다(2026-09-08 8차 검증에서 적발).
  if (degraded && rejected.has(degraded.userId)) return null;
  return degraded;
}

type SessionCheck =
  | { ok: true; payload: JWTPayload; degraded?: false }
  | { ok: false; degraded: true; payload: JWTPayload }
  // 확정 거부 — payload 는 "누가 거부됐는지"를 알리기 위해 들고 나온다(형태가
  // 깨져 누구인지조차 모르면 null).
  | { ok: false; degraded: false; payload: JWTPayload | null };

/** 토큰 하나를 끝까지 검사한다 — 모양.서명.무효화.재직. */
async function verifySessionToken(token: string): Promise<SessionCheck> {
  const payload = await verifyToken(token);
  if (!payload) return { ok: false, degraded: false, payload: null };

  // ⚠ 서명이 맞아도 **무효화된 토큰이면 거부**한다. 종전에는 퇴사 처리를 해도 이미 발급된
  //   7일짜리 토큰을 끊을 수단이 없어, 퇴사자가 앱을 켜둔 채면 계속 출퇴근을 찍을 수 있었다.
  //   tv 가 없는 옛 토큰은 0 으로 본다 — 무효화가 한 번이라도 있었으면 자연히 걸린다.
  // null(DB 장애)만 통과시킨다 — DB 가 한 번 흔들렸다고 전원 로그아웃되면 안 된다.
  // NO_USER(계정 없음)와 blocked(퇴사.비활성)는 막는다.
  const cur = await currentUserState(payload.userId);
  if (cur === null) return { ok: false, degraded: true, payload }; // DB 장애 — 판정 보류
  if (cur === NO_USER) return { ok: false, degraded: false, payload };
  if (cur.blocked) return { ok: false, degraded: false, payload };
  if (cur.v !== (payload.tv ?? 0)) return { ok: false, degraded: false, payload };
  return { ok: true, payload };
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
