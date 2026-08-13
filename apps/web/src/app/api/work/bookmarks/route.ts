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

  return NextResponse.json({
    bookmarks: bookmarks
      .filter((b) => !b.message.deletedAt)
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
