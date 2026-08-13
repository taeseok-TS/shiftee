import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 메시지 읽음/안읽음 멤버 명단 (unreadBy 숫자 탭 → 상세)
// 기준은 unreadBy 계산과 동일: 발신자 제외, lastReadAt >= 메시지 시각이면 읽음
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const message = await prisma.workMessage.findUnique({
    where: { id },
    select: { channelId: true, createdAt: true, userId: true },
  });
  if (!message) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });

  // 요청자가 채널 멤버인지 확인 (기본 채널은 전체 공개)
  const channel = await prisma.workChannel.findUnique({
    where: { id: message.channelId },
    select: { isDefault: true, members: { select: { userId: true, lastReadAt: true, user: { select: { id: true, name: true, branch: true, avatarUrl: true } } } } },
  });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });
  const isMember = channel.members.some((m) => m.userId === session.userId);
  if (!channel.isDefault && !isMember)
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

  const read: { userId: string; name: string; branch: string | null; avatarUrl: string | null }[] = [];
  const unread: typeof read = [];
  for (const m of channel.members) {
    if (m.userId === message.userId) continue; // 발신자 제외
    const entry = { userId: m.userId, name: m.user.name, branch: m.user.branch, avatarUrl: m.user.avatarUrl };
    if (m.lastReadAt && m.lastReadAt >= message.createdAt) read.push(entry);
    else unread.push(entry);
  }
  read.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  unread.sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return NextResponse.json({ read, unread });
}
