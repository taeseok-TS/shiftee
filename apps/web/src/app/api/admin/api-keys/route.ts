import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicKey } from "@/lib/api-key";

export const dynamic = "force-dynamic";

// 본부 — 발급 허용된 사람과 전체 키 현황(원문·해시 없음)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 볼 수 있습니다." }, { status: 403 });
  const [allowed, keys] = await Promise.all([
    prisma.user.findMany({ where: { apiKeysAllowed: true, deletedAt: null }, select: { id: true, name: true, branch: true, jobGroup: true, role: true, isActive: true }, orderBy: { name: "asc" } }),
    prisma.apiKey.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
  ]);
  const owners = await prisma.user.findMany({ where: { id: { in: [...new Set(keys.map((k) => k.userId))] } }, select: { id: true, name: true, branch: true } });
  const byId = new Map(owners.map((o) => [o.id, o]));
  return NextResponse.json({
    allowed,
    keys: keys.map((k) => ({ ...publicKey(k), userId: k.userId, userName: byId.get(k.userId)?.name ?? "(알 수 없음)", userBranch: byId.get(k.userId)?.branch ?? null })),
  });
}
