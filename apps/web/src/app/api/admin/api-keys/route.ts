import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicKey } from "@/lib/api-key";
import { hiddenIdsFor } from "@/lib/hidden-accounts";

export const dynamic = "force-dynamic";

// 본부 — 발급 허용된 사람과 전체 키 현황(원문·해시 없음)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 볼 수 있습니다." }, { status: 403 });
  // 개발자 영역(메인 관리자)의 허용 행·키는 보는 사람에게만(2026-10-17 디렉터) — 키가 통하는지는 그대로다
  const hidden = await hiddenIdsFor(session);
  const [allowed, keys] = await Promise.all([
    prisma.user.findMany({ where: { apiKeysAllowed: true, deletedAt: null, ...(hidden.length ? { id: { notIn: hidden } } : {}) }, select: { id: true, name: true, branch: true, jobGroup: true, role: true, isActive: true }, orderBy: { name: "asc" } }),
    // 개인 키만 거른다 — 회사 연동(ORG) 키는 발급자가 누구든 본부가 관리해야 한다
    prisma.apiKey.findMany({ where: hidden.length ? { NOT: { kind: "PERSONAL", userId: { in: hidden } } } : {}, orderBy: { createdAt: "desc" }, take: 500 }),
  ]);
  const owners = await prisma.user.findMany({ where: { id: { in: [...new Set(keys.map((k) => k.userId))] } }, select: { id: true, name: true, branch: true } });
  const byId = new Map(owners.map((o) => [o.id, o]));
  return NextResponse.json({
    allowed,
    keys: keys.map((k) => ({ ...publicKey(k), userId: k.userId, userName: byId.get(k.userId)?.name ?? "(알 수 없음)", userBranch: byId.get(k.userId)?.branch ?? null })),
  });
}
