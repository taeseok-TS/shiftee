import { PrismaClient } from "@prisma/client";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// DB 연결 수(2026-11-18) — 따로 정하지 않으면 Prisma 는 (CPU 수×2+1) = 운영 2코어에서 **5개**뿐이라,
// 11/17 월례회의 날 사진 · 결재가 몰리자 「Timed out fetching a new connection from the connection pool」로 채팅 · 읽음 · 토큰 갱신이 실패했다.
// 주소에 connection_limit 이 이미 있으면 그 값을 따른다(운영 .env 로 조정 가능). Postgres max_connections=100, 평소 사용 13개 안팎.
// pool_timeout 은 기본 10초 그대로 — 늘리면 연결이 바닥날 때 요청이 더 오래 매달린다(검증관).
function withPool(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", "15");
    return u.toString();
  } catch {
    return url; // 해석이 안 되는 주소는 손대지 않는다
  }
}
const dbUrl = withPool(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(dbUrl ? { datasources: { db: { url: dbUrl } } } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
