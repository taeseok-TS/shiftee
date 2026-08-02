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
  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { id: true, isDefault: true } });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });

  // 멤버 행 자동 생성은 전체(isDefault) 채널만("한 번 연 사람만 멤버행" 메커니즘) —
  // 비공개 채널은 멤버만 읽음 처리(비멤버의 멤버 행 생성 = 대화 열람 통로 차단)
  const member = await prisma.workChannelMember.findUnique({
    where: { channelId_userId: { channelId: id, userId: session.userId } },
    select: { channelId: true },
  });
  if (!member && !channel.isDefault)
    return NextResponse.json({ error: "채널 멤버만 읽음 처리할 수 있습니다." }, { status: 403 });

  await prisma.workChannelMember.upsert({
    where: { channelId_userId: { channelId: id, userId: session.userId } },
    create: { channelId: id, userId: session.userId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });

  emitWork({ type: "read", channelId: id });
  return NextResponse.json({ ok: true });
}
