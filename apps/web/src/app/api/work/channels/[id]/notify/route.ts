import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const VALID = ["ALL", "MENTION", "MUTE"] as const;

// 채널 알림 설정 변경
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { notify } = await request.json();
  if (!VALID.includes(notify)) return NextResponse.json({ error: "잘못된 값입니다." }, { status: 400 });

  // 멤버 행 자동 생성은 전체(isDefault) 채널만 — 비멤버의 멤버 행 생성(대화 열람 통로) 차단
  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { isDefault: true } });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });
  const member = await prisma.workChannelMember.findUnique({
    where: { channelId_userId: { channelId: id, userId: session.userId } },
    select: { channelId: true },
  });
  if (!member && !channel.isDefault)
    return NextResponse.json({ error: "채널 멤버만 설정할 수 있습니다." }, { status: 403 });

  await prisma.workChannelMember.upsert({
    where: { channelId_userId: { channelId: id, userId: session.userId } },
    create: { channelId: id, userId: session.userId, notify },
    update: { notify },
  });

  return NextResponse.json({ ok: true, notify });
}
