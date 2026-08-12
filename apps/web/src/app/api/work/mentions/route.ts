import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isMentioned } from "@/lib/mention";

// 나를 @멘션한 메시지 모아보기 (내가 속한 채널 + 전체 채널, 최신순)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // '@내이름' 포함 후보를 넉넉히 가져와 정확 매칭으로 걸러낸다 (부분일치 동명 방지)
  const candidates = await prisma.workMessage.findMany({
    where: {
      deletedAt: null,
      system: false,
      userId: { not: session.userId },
      // "@내이름" 또는 방 전체 멘션("@전체"/"@all") 후보 — 정확 매칭은 isMentioned가 담당
      OR: [
        { content: { contains: `@${session.name}` } },
        { content: { contains: "@전체" } },
        { content: { contains: "@all" } },
      ],
      channel: {
        deletedAt: null,
        OR: [{ isDefault: true }, { members: { some: { userId: session.userId } } }],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 150,
    select: {
      id: true,
      content: true,
      createdAt: true,
      channelId: true,
      user: { select: { name: true } },
      channel: { select: { name: true, type: true } },
    },
  });

  const mentions = candidates
    .filter((m) => isMentioned(m.content, session.name))
    .slice(0, 50)
    .map((m) => ({
      messageId: m.id,
      channelId: m.channelId,
      channelName: m.channel.type === "DM" ? "1:1 대화" : m.channel.name,
      userName: m.user.name,
      content: m.content,
      createdAt: m.createdAt,
    }));

  return NextResponse.json({ mentions });
}
