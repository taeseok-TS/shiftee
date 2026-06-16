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

  if (existing) {
    await prisma.workMessageReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.workMessageReaction.create({
      data: { messageId: id, userId: session.userId, emoji },
    });
  }

  emitWork({ type: "reaction", channelId: message.channelId });
  return NextResponse.json({ ok: true, added: !existing });
}
