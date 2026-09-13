import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, v1Error } from "@/lib/api-key";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { channelAccessible, postChannelMessage } from "@/lib/work-post";

export const dynamic = "force-dynamic";

// 방의 메시지 읽기 — 본인이 속한 방만. after=<id> 뒤의 것만(폴링), 최대 200, 삭제·댓글 제외, 과거기록 범위(historyFrom) 준수
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authenticateApiKey(request, "chat:read");
  if (a.ok === false) return a.res; // strictNullChecks 없이는 !a.ok 로 좁혀지지 않는다
  const { id } = await params;
  const ch = await channelAccessible(id, a.p.user.id);
  if (!ch) return v1Error(403, "속해 있지 않은 방입니다.", "NOT_MEMBER");
  const sp = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
  const after = sp.get("after");
  const my = await prisma.workChannelMember.findUnique({ where: { channelId_userId: { channelId: id, userId: a.p.user.id } }, select: { historyFrom: true } });
  let afterAt: Date | null = null;
  if (after) {
    const m = await prisma.workMessage.findFirst({ where: { id: after, channelId: id }, select: { createdAt: true } });
    if (!m) return v1Error(400, "after 메시지를 찾을 수 없습니다.", "BAD_AFTER");
    afterAt = m.createdAt;
  }
  // 시작점 = after 메시지 시각과 과거기록 열람 범위(historyFrom) 중 늦은 쪽
  const from = [afterAt, my?.historyFrom ?? null].filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
  const rows = await prisma.workMessage.findMany({
    where: { channelId: id, parentId: null, deletedAt: null, ...(from ? { createdAt: { gt: from } } : {}) },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: afterAt ? "asc" : "desc" },
    take: limit,
  });
  if (!afterAt) rows.reverse();
  return NextResponse.json({
    channel: { id: ch.id, name: ch.name, type: ch.type },
    messages: rows.map((m) => ({ id: m.id, userId: m.userId, userName: m.user.name, content: m.content, fileUrl: m.fileUrl, fileName: m.fileName, system: m.system, createdAt: m.createdAt })),
    nextAfter: rows.length ? rows[rows.length - 1].id : after ?? null,
  });
}

// 방에 메시지 올리기 — 키 생성 때 고른 방 + 지금도 속해 있는 방. 본문 앞에 🤖 가 붙는다.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authenticateApiKey(request, "chat:write", "write");
  if (a.ok === false) return a.res; // strictNullChecks 없이는 !a.ok 로 좁혀지지 않는다
  const { id } = await params;
  if (!a.p.key.channelIds.includes(id)) return v1Error(403, "이 키로 메시지를 올릴 수 있는 방이 아닙니다. 키를 만들 때 고른 방만 됩니다.", "CHANNEL_NOT_ALLOWED");
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return v1Error(400, "content 를 넣어주세요.", "NO_CONTENT");
  if (content.length > 2000) return v1Error(400, "메시지는 2,000자까지입니다.", "TOO_LONG");
  const r = await postChannelMessage({ channelId: id, userId: a.p.user.id, content, apiKeyId: a.p.key.id });
  if ("error" in r) return v1Error(r.status, r.error, "NOT_MEMBER");
  await logAudit({ actorId: a.p.user.id, actorName: a.p.user.name, action: "API_CHAT_POST", targetType: "WORK_CHANNEL", targetId: id, targetName: null, detail: `API 키 「${a.p.key.name}」 · ${content.length}자` });
  return NextResponse.json({ message: r.message });
}
