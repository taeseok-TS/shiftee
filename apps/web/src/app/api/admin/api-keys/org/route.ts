import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { ORG_SCOPES, MAX_TTL_DAYS, generateApiKey, publicKey, type ApiScope } from "@/lib/api-key";

export const dynamic = "force-dynamic";

// 회사 연동 키 발급 (본부만) — 큐브마케팅 같은 외부 프로그램용. 범위는 marketing:* 만, 발급자(관리자)에게 매인다.
// 원문은 이 응답에 한 번만 나간다.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부 관리자만 연동 키를 발급할 수 있습니다." }, { status: 403 });
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
