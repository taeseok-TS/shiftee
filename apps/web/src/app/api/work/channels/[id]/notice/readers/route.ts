import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 채널 공지 확인/미확인 멤버 명단 (기준: 공지 등록 시각 이후 채널을 열었는지 = lastReadAt >= noticeAt)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const channel = await prisma.workChannel.findUnique({
    where: { id },
    select: {
      isDefault: true,
      noticeAt: true,
      members: { select: { userId: true, lastReadAt: true, user: { select: { name: true, branch: true, avatarUrl: true } } } },
    },
  });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });
  const isMember = channel.members.some((m) => m.userId === session.userId);
  if (!channel.isDefault && !isMember)
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  if (!channel.noticeAt)
    return NextResponse.json({ error: "등록된 공지가 없습니다." }, { status: 400 });

  const read: { userId: string; name: string; branch: string | null; avatarUrl: string | null }[] = [];
  const unread: typeof read = [];
  for (const m of channel.members) {
    const entry = { userId: m.userId, name: m.user.name, branch: m.user.branch, avatarUrl: m.user.avatarUrl };
    if (m.lastReadAt && m.lastReadAt >= channel.noticeAt) read.push(entry);
    else unread.push(entry);
  }
  read.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  unread.sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return NextResponse.json({ read, unread });
}
