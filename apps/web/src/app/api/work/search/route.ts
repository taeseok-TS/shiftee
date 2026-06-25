import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 메시지 검색 (접근 가능한 채널 내)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ results: [] });

  // 접근 가능한 채널: '전체' 기본 채널 + 내가 멤버인 그룹채널/DM
  const channels = await prisma.workChannel.findMany({
    where: {
      OR: [
        { isDefault: true },
        { type: "CHANNEL", members: { some: { userId: session.userId } } },
        { type: "DM", members: { some: { userId: session.userId } } },
      ],
    },
    select: { id: true, name: true, type: true, members: { include: { user: { select: { id: true, name: true } } } } },
  });
  const channelMap = new Map(channels.map((c) => [c.id, c]));

  const messages = await prisma.workMessage.findMany({
    where: {
      channelId: { in: channels.map((c) => c.id) },
      content: { contains: q, mode: "insensitive" },
    },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const results = messages.map((m) => {
    const ch = channelMap.get(m.channelId)!;
    let channelName = ch.name;
    if (ch.type === "DM") {
      const other = ch.members.find((mm) => mm.userId !== session.userId);
      channelName = other?.user.name ?? "대화";
    }
    return {
      id: m.id,
      channelId: m.channelId,
      channelName,
      userName: m.user.name,
      content: m.content,
      createdAt: m.createdAt,
    };
  });

  return NextResponse.json({ results });
}
