import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const URL_RE = /https?:\/\/[^\s]+/g;

// 채널 내 공유된 링크 모아보기 (메시지 본문에서 URL 추출, 최신순)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const channel = await prisma.workChannel.findUnique({
    where: { id },
    select: { isDefault: true, members: { select: { userId: true } } },
  });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });
  const isMember = channel.members.some((m) => m.userId === session.userId);
  if (!channel.isDefault && !isMember)
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

  // 과거기록 열람 제한(historyFrom) 준수 — 메시지 GET과 동일 규칙 ("기록 없이 추가"된 멤버에게 과거 링크 유출 방지)
  const myMember = await prisma.workChannelMember.findUnique({
    where: { channelId_userId: { channelId: id, userId: session.userId } },
    select: { historyFrom: true },
  });

  const messages = await prisma.workMessage.findMany({
    where: {
      channelId: id,
      deletedAt: null,
      content: { contains: "http" },
      ...(myMember?.historyFrom ? { createdAt: { gte: myMember.historyFrom } } : {}),
    },
    select: { content: true, createdAt: true, user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const links: { url: string; userName: string; createdAt: Date }[] = [];
  for (const m of messages) {
    const found = m.content.match(URL_RE) || [];
    for (const raw of found) {
      const url = raw.replace(/[.,)\]]+$/, "");
      links.push({ url, userName: m.user.name, createdAt: m.createdAt });
      if (links.length >= 100) break;
    }
    if (links.length >= 100) break;
  }

  return NextResponse.json({ links });
}
