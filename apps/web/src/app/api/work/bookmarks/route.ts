import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 내 보관함 (북마크한 메시지 목록, 최신순)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const bookmarks = await prisma.workBookmark.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      message: {
        select: {
          id: true,
          content: true,
          fileUrl: true,
          fileName: true,
          fileType: true,
          deletedAt: true,
          createdAt: true,
          channelId: true,
          user: { select: { name: true } },
          channel: { select: { name: true, type: true } },
        },
      },
    },
  });

  // 지금 볼 수 있는 것만 — 방에서 나간 뒤에도 보관해 둔 메시지의 현재 원문(이후 수정분 포함)이 계속 나왔다.
  // 보관 기록은 지우지 않는다(방에 다시 들어오면 다시 보인다). 2026-10-01 검증관 P3
  const chIds = [...new Set(bookmarks.map((b) => b.message.channelId))];
  const visible = new Map(
    (await prisma.workChannel.findMany({
      where: { id: { in: chIds } },
      select: { id: true, isDefault: true, members: { where: { userId: session.userId }, select: { historyFrom: true } } },
    })).map((c) => [c.id, c]),
  );
  const canSee = (channelId: string, createdAt: Date) => {
    const c = visible.get(channelId);
    if (!c) return false;
    const me = c.members[0];
    if (!c.isDefault && !me) return false;
    return !(me?.historyFrom && createdAt < me.historyFrom);
  };
  return NextResponse.json({
    bookmarks: bookmarks
      .filter((b) => !b.message.deletedAt)
      .filter((b) => canSee(b.message.channelId, b.message.createdAt))
      .map((b) => ({
        messageId: b.message.id,
        channelId: b.message.channelId,
        channelName: b.message.channel.type === "DM" ? "1:1 대화" : b.message.channel.name,
        userName: b.message.user.name,
        content: b.message.content,
        fileUrl: b.message.fileUrl,
        fileName: b.message.fileName,
        fileType: b.message.fileType,
        createdAt: b.message.createdAt,
        bookmarkedAt: b.createdAt,
      })),
  });
}
