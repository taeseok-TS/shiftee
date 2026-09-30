import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 휴지통에서 채널 복구. 생성자/관리자만.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { createdBy: true, hidden: true, _count: { select: { members: true } } } });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });

  const canManage = session.role === "ADMIN" || session.role === "MANAGER" || channel.createdBy === session.userId;
  if (!canManage) return NextResponse.json({ error: "복구할 권한이 없습니다." }, { status: 403 });

  // 멤버가 한 명도 없는 방(끝난 회의의 채팅방 등)은 되살려도 아무 목록에도 안 뜬다 — 되살린 사람을 넣고 숨김을 풀어
  // 그 사람 채널 목록에 보이게 한다(관리자가 지난 회의 대화를 볼 수 있는 길, 2026-09-30).
  // 남의 방 대화를 원장이 임의로 열어 보지 않게, 자동 참여는 **본부 관리자와 그 방을 만든 사람**만.
  const joinAsViewer = channel._count.members === 0 && (session.role === "ADMIN" || channel.createdBy === session.userId);
  await prisma.$transaction([
    prisma.workChannel.update({ where: { id }, data: { deletedAt: null, permanentlyDeletedAt: null, ...(joinAsViewer ? { hidden: false } : {}) } }),
    ...(joinAsViewer ? [prisma.workChannelMember.create({ data: { channelId: id, userId: session.userId, lastReadAt: new Date() } })] : []),
  ]);
  return NextResponse.json({ success: true });
}
