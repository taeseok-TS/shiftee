import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 메시지 북마크 토글 (개인 보관함)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const message = await prisma.workMessage.findUnique({
    where: { id },
    select: { deletedAt: true, channel: { select: { isDefault: true, members: { select: { userId: true } } } } },
  });
  if (!message || message.deletedAt) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  const isMember = message.channel.members.some((m) => m.userId === session.userId);
  if (!message.channel.isDefault && !isMember)
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

  const existing = await prisma.workBookmark.findUnique({
    where: { userId_messageId: { userId: session.userId, messageId: id } },
  });
  if (existing) {
    await prisma.workBookmark.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true, bookmarked: false });
  }
  await prisma.workBookmark.create({ data: { userId: session.userId, messageId: id } });
  return NextResponse.json({ success: true, bookmarked: true });
}
