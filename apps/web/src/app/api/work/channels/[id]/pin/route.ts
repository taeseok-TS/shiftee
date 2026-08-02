import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 채널 상단 고정/해제 (사용자별). 멤버 행이 없으면 생성.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { pinned } = (await request.json()) as { pinned?: boolean };

  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { id: true, isDefault: true } });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });

  // 멤버 행 자동 생성은 전체(isDefault) 채널만 — 비공개 채널에 upsert create를 허용하면
  // 비멤버가 멤버 행을 만들어 대화를 열람하는 통로가 된다
  const member = await prisma.workChannelMember.findUnique({
    where: { channelId_userId: { channelId: id, userId: session.userId } },
    select: { channelId: true },
  });
  if (!member && !channel.isDefault)
    return NextResponse.json({ error: "채널 멤버만 설정할 수 있습니다." }, { status: 403 });

  await prisma.workChannelMember.upsert({
    where: { channelId_userId: { channelId: id, userId: session.userId } },
    update: { pinned: !!pinned },
    create: { channelId: id, userId: session.userId, pinned: !!pinned },
  });

  return NextResponse.json({ success: true, pinned: !!pinned });
}
