import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { API_SCOPES, DEFAULT_TTL_DAYS, MAX_KEYS_PER_USER, MAX_TTL_DAYS, generateApiKey, publicKey, type ApiScope } from "@/lib/api-key";
import { channelAccessible } from "@/lib/work-post";

export const dynamic = "force-dynamic";

// 내 API 키 — 목록(원문 없음) / 발급(원문은 이 응답에 한 번만)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { apiKeysAllowed: true } });
  const keys = await prisma.apiKey.findMany({ where: { userId: session.userId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ allowed: !!me?.apiKeysAllowed, keys: keys.map(publicKey) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { apiKeysAllowed: true, name: true } });
  if (!me?.apiKeysAllowed) return NextResponse.json({ error: "API 키 발급이 허용되지 않은 계정입니다. 본부에 문의해주세요." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return NextResponse.json({ error: "용도를 적어주세요. (예: 과제 자동 제출)" }, { status: 400 });
  const scopes: ApiScope[] = Array.isArray(body.scopes)
    ? [...new Set((body.scopes as unknown[]).filter((s): s is ApiScope => typeof s === "string" && (API_SCOPES as readonly string[]).includes(s)))]
    : [];
  if (!scopes.length) return NextResponse.json({ error: "권한을 하나 이상 골라주세요." }, { status: 400 });
  const ttlRaw = Number(body.ttlDays);
  const ttlDays = Number.isFinite(ttlRaw) && ttlRaw >= 1 ? Math.min(Math.floor(ttlRaw), MAX_TTL_DAYS) : DEFAULT_TTL_DAYS;
  if (typeof body.consent !== "boolean" || !body.consent)
    return NextResponse.json({ error: "안내 문구에 동의해주세요." }, { status: 400 });

  // chat:write 는 본인이 속한 방만 고를 수 있다
  let channelIds: string[] = [];
  if (scopes.includes("chat:write")) {
    const wanted: string[] = Array.isArray(body.channelIds) ? [...new Set((body.channelIds as unknown[]).filter((c): c is string => typeof c === "string"))] : [];
    if (!wanted.length) return NextResponse.json({ error: "채팅 쓰기는 메시지를 올릴 방을 하나 이상 골라주세요." }, { status: 400 });
    for (const cid of wanted) {
      if (!(await channelAccessible(cid, session.userId))) return NextResponse.json({ error: "속해 있지 않은 방이 있습니다." }, { status: 400 });
    }
    channelIds = wanted;
  }
  const liveCount = await prisma.apiKey.count({ where: { userId: session.userId, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (liveCount >= MAX_KEYS_PER_USER) return NextResponse.json({ error: `키는 ${MAX_KEYS_PER_USER}개까지 둘 수 있습니다. 안 쓰는 키를 끄고 만들어주세요.` }, { status: 400 });

  const { raw, prefix, hash } = generateApiKey();
  const row = await prisma.apiKey.create({
    data: { userId: session.userId, name, prefix, keyHash: hash, scopes, channelIds, expiresAt: new Date(Date.now() + ttlDays * 86400_000) },
  });
  await logAudit({ actorId: session.userId, actorName: me.name, action: "API_KEY_CREATE", targetType: "API_KEY", targetId: row.id, targetName: name, detail: `${scopes.join(",")} · 방 ${channelIds.length}개 · ${ttlDays}일` });
  // 원문은 여기서 한 번만 — DM·메일로 절대 보내지 않는다
  return NextResponse.json({ key: publicKey(row), secret: raw });
}
