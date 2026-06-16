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

  await prisma.workChannelMember.upsert({
    where: { channelId_userId: { channelId: id, userId: session.userId } },
    create: { channelId: id, userId: session.userId, notify },
    update: { notify },
  });

  return NextResponse.json({ ok: true, notify });
}
