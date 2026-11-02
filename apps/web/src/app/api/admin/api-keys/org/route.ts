import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { ORG_SCOPES, MAX_TTL_DAYS, generateApiKey, publicKey, type ApiScope } from "@/lib/api-key";

export const dynamic = "force-dynamic";

// 회사 연동 키 — 큐브마케팅 같은 외부 프로그램용. 범위는 ORG_SCOPES 만, 발급자(관리자)에게 매인다.
// 2026-11-02 디렉터 회의 3번 「연동 키 발급은 모든 관리자가, 관리자 설정으로」 — 최고 관리자 전용(개발자 › API 키)에서
// 모든 관리자(설정 › 연동 키)로 열었다. 직원 개인 키 허용·현황은 그대로 최고 관리자 전용(/api/admin/api-keys).

// 회사 연동 키 목록(원문·해시 없음)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 볼 수 있습니다." }, { status: 403 });
  const keys = await prisma.apiKey.findMany({ where: { kind: "ORG" }, orderBy: { createdAt: "desc" }, take: 200 });
  const owners = await prisma.user.findMany({ where: { id: { in: [...new Set(keys.map((k) => k.userId))] } }, select: { id: true, name: true } });
  const byId = new Map(owners.map((o) => [o.id, o.name]));
  // 개발자 영역(숨김) 계정이 발급한 키는 발급자 이름을 「본부」로 — 키 자체는 본부가 관리해야 하니 행은 보인다(lib/hidden-accounts, 검증 9)
  const { hiddenIdsFor } = await import("@/lib/hidden-accounts");
  const hidden = new Set(await hiddenIdsFor(session));
  return NextResponse.json({ keys: keys.map((k) => ({ ...publicKey(k), userName: hidden.has(k.userId) ? "본부" : byId.get(k.userId) ?? "(알 수 없음)" })) });
}

// 회사 연동 키 발급 (관리자) — 원문은 이 응답에 한 번만 나간다.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 연동 키를 발급할 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return NextResponse.json({ error: "용도를 적어주세요. (예: 큐브마케팅 블로그 발행)" }, { status: 400 });
  const scopes: ApiScope[] = Array.isArray(body.scopes)
    ? [...new Set((body.scopes as unknown[]).filter((s): s is ApiScope => typeof s === "string" && (ORG_SCOPES as readonly string[]).includes(s)))]
    : [];
  if (!scopes.length) return NextResponse.json({ error: "범위를 하나 이상 골라주세요." }, { status: 400 });
  const ttlRaw = Number(body.ttlDays);
  const ttlDays = Number.isFinite(ttlRaw) && ttlRaw >= 1 ? Math.min(Math.floor(ttlRaw), MAX_TTL_DAYS) : MAX_TTL_DAYS;
  const { raw, prefix, hash } = generateApiKey();
  const row = await prisma.apiKey.create({
    data: { userId: session.userId, kind: "ORG", name, prefix, keyHash: hash, scopes, channelIds: [], expiresAt: new Date(Date.now() + ttlDays * 86400_000) },
  });
  await logAudit({ actorId: session.userId, actorName: session.name, action: "API_KEY_CREATE", targetType: "API_KEY", targetId: row.id, targetName: name, detail: `회사 연동 키 · ${scopes.join(",")} · ${ttlDays}일` });
  return NextResponse.json({ key: publicKey(row), secret: raw });
}
