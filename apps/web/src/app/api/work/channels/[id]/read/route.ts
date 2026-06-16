import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitWork } from "@/lib/work-events";

// 채널 읽음 처리 (멤버 lastReadAt 갱신, 공개 채널은 멤버 행 자동 생성)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { id: true } });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });

  await prisma.workChannelMember.upsert({
    where: { channelId_userId: { channelId: id, userId: session.userId } },
    create: { channelId: id, userId: session.userId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });

  emitWork({ type: "read", channelId: id });
  return NextResponse.json({ ok: true });
}
