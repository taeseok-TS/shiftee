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

  const replies = await prisma.workMessage.findMany({
    where: { parentId: id },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const shape = (m: typeof replies[number]) => ({
    id: m.id,
    userId: m.userId,
    userName: m.user.name,
    content: m.content,
    fileUrl: m.fileUrl,
    fileName: m.fileName,
    fileType: m.fileType,
    createdAt: m.createdAt,
    mine: m.userId === session.userId,
  });

  return NextResponse.json({
    parent: {
      id: parent.id,
      userId: parent.userId,
      userName: parent.user.name,
      content: parent.content,
      fileUrl: parent.fileUrl,
      fileName: parent.fileName,
      fileType: parent.fileType,
      createdAt: parent.createdAt,
      mine: parent.userId === session.userId,
    },
    replies: replies.map(shape),
  });
}
