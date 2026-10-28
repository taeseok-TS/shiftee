import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { portalEmploymentTypes } from "@/lib/portal-hr-contact";

export const dynamic = "force-dynamic";

// 계약서 보내기 「재계약」 — 코디의 고용형태(정규직 | 계약직)를 포털 인사카드에서 읽어 양식 기본값을 고른다(2026-10-28 이예지 코디 재계약).
//  · 관리자만. 큐브티에 저장하지 않고 돌려주기만 한다(no-store). 금액 · 주소 같은 민감값은 없다
//  · 창구가 없거나 못 맞춘 사람은 빠진다 → 화면은 정규직 양식을 기본으로 둔다
// POST { userIds: string[] } → { types: { [userId]: "정규직" | "계약직" } }
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 조회할 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => null) as { userIds?: unknown } | null;
  const ids = [...new Set((Array.isArray(body?.userIds) ? body!.userIds : []).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 64))];
  if (!ids.length) return NextResponse.json({ error: "직원을 골라 주세요." }, { status: 400 });
  if (ids.length > 200) return NextResponse.json({ error: "한 번에 200명까지 볼 수 있습니다." }, { status: 400 });
  const users = await prisma.user.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, name: true, branch: true } });
  const map = await portalEmploymentTypes(users).catch(() => new Map<string, string>());
  const types: Record<string, string> = {};
  for (const [id, t] of map) if (t === "정규직" || t === "계약직") types[id] = t;
  return NextResponse.json({ types }, { headers: { "Cache-Control": "no-store" } });
}
