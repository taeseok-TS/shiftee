import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 채널 메시지 조회 (폴링)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;

  const channel = await prisma.workChannel.findUnique({
    where: { id },
    include: { members: { select: { userId: true } } },
  });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });

  // DM은 멤버만 접근 가능
  if (channel.type === "DM" && !channel.members.some((m) => m.userId === session.userId)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const messages = await prisma.workMessage.findMany({
    where: { channelId: id },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      userId: m.userId,
      userName: m.user.name,
      content: m.content,
      createdAt: m.createdAt,
      mine: m.userId === session.userId,
    })),
  });
}

// 메시지 전송
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { content } = await request.json();
  if (!content?.trim()) return NextResponse.json({ error: "메시지를 입력해주세요." }, { status: 400 });

  const channel = await prisma.workChannel.findUnique({
    where: { id },
    include: { members: { select: { userId: true } } },
  });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });
  if (channel.type === "DM" && !channel.members.some((m) => m.userId === session.userId)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const message = await prisma.workMessage.create({
    data: { channelId: id, userId: session.userId, content: content.trim() },
    include: { user: { select: { id: true, name: true } } },
  });

  return NextResponse.json({
    message: {
      id: message.id,
      userId: message.userId,
      userName: message.user.name,
      content: message.content,
      createdAt: message.createdAt,
      mine: true,
    },
  });
}
