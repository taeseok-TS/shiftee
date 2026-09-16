import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 특정 메시지의 댓글(스레드) 목록 + 원본
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;

  const parent = await prisma.workMessage.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true } },
      reactions: { select: { emoji: true, userId: true } },
    },
  });
  if (!parent) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });

  // 그 채널 사람인지 확인 — 종전에는 검사가 없어 메시지 id 만 알면 남의 DM 원문이 나왔다
  const { assertChannelAccess } = await import("@/lib/work-access");
  const acc = await assertChannelAccess(parent.channelId, session.userId);
  if (!acc.ok) return NextResponse.json({ error: acc.error }, { status: acc.status });

  const replies = await prisma.workMessage.findMany({
    where: { parentId: id },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  // ⚠ 목록 API(work/channels/[id]/messages)와 **같은 모양**으로 내보낸다.
  //   예전에는 albumUrls 가 빠져 본문에선 보이던 사진 앱범이 스레드 창에서만 통째로 사라졌고,
  //   deletedAt 도 안 보내 **삭제한 댓글이 원문 그대로** 남아 있었다(2026-09-16).
  const shape = (m: typeof replies[number]) => ({
    id: m.id,
    userId: m.userId,
    userName: m.user.name,
    content: m.deletedAt ? "" : m.content,
    fileUrl: m.deletedAt ? null : m.fileUrl,
    albumUrls: m.deletedAt ? null : (m.albumUrls as string[] | null),
    fileName: m.deletedAt ? null : m.fileName,
    fileType: m.deletedAt ? null : m.fileType,
    createdAt: m.createdAt,
    deleted: !!m.deletedAt,
    mine: m.userId === session.userId,
  });

  return NextResponse.json({
    parent: {
      id: parent.id,
      userId: parent.userId,
      userName: parent.user.name,
      content: parent.deletedAt ? "" : parent.content,
      fileUrl: parent.deletedAt ? null : parent.fileUrl,
      albumUrls: parent.deletedAt ? null : (parent.albumUrls as string[] | null),
      fileName: parent.deletedAt ? null : parent.fileName,
      fileType: parent.deletedAt ? null : parent.fileType,
      createdAt: parent.createdAt,
      deleted: !!parent.deletedAt,
      mine: parent.userId === session.userId,
    },
    replies: replies.map(shape),
  });
}
