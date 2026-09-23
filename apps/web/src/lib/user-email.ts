import { prisma } from "@/lib/db";

/**
 * 이미 있는 계정인지 — **대소문자를 무시하고** 본다 (2026-09-23).
 *
 * PostgreSQL 의 unique 는 대소문자를 구분해서, `Kim@x.net` 이 저장돼 있어도 `kim@x.net` 로는
 * 중복 검사가 통과해 버린다. 계정 생성 때 주소를 소문자로 맞추기 시작했기 때문에(로그인 실패의
 * 실제 원인), 이 검사를 같이 넣지 않으면 **같은 사람 계정이 하나 더 생긴다** — 그리고 새 계정에는
 * 연차도 기록도 없다(검증 loginhint4 ⓧ). 운영에 대문자가 섞인 주소가 실제로 1건 있다.
 *
 * ⚠ Prisma 의 `mode: "insensitive"` 는 ILIKE 라 `%`·`_` 가 와일드카드가 된다(운영 주소 137개 중
 *   127개가 `_` 를 포함한다). 그래서 LIKE 를 쓰지 않고, 값은 반드시 바인딩으로 넘긴다.
 */
export async function findUserIdByEmailCI(email: string): Promise<string | null> {
  const lower = String(email).trim().toLowerCase();
  if (!lower) return null;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "User" WHERE lower("email") = ${lower} LIMIT 1
  `;
  return rows[0]?.id ?? null;
}
