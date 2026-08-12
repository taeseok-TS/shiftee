import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitWork } from "@/lib/work-events";

// 이모지 반응 토글 (있으면 제거, 없으면 추가)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { emoji } = await request.json();
  if (!emoji) return NextResponse.json({ error: "이모지가 필요합니다." }, { status: 400 });

  const message = await prisma.workMessage.findUnique({ where: { id }, select: { channelId: true } });
  if (!message) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });

  const existing = await prisma.workMessageReaction.findUnique({
    where: { messageId_userId_emoji: { messageId: id, userId: session.userId, emoji } },
  });

  // 더블탭 등 동시 요청 레이스: 삭제는 이미 지워졌으면(P2025), 추가는 이미 있으면(P2002) 그대로 성공 처리
  if (existing) {
    await prisma.workMessageReaction
      .delete({ where: { id: existing.id } })
      .catch((e: { code?: string }) => { if (e.code !== "P2025") throw e; });
  } else {
    await prisma.workMessageReaction
      .create({ data: { messageId: id, userId: session.userId, emoji } })
      .catch((e: { code?: string }) => { if (e.code !== "P2002") throw e; });
  }

  emitWork({ type: "reaction", channelId: message.channelId });
  return NextResponse.json({ ok: true, added: !existing });
}
