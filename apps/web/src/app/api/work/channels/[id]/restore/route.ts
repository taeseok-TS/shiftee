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
  const channel = await prisma.workChannel.findUnique({
    where: { id },
    select: { createdBy: true, hidden: true, _count: { select: { members: true } }, members: { where: { userId: session.userId }, select: { userId: true } } },
  });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });

  const canManage = session.role === "ADMIN" || session.role === "MANAGER" || channel.createdBy === session.userId;
  if (!canManage) return NextResponse.json({ error: "복구할 권한이 없습니다." }, { status: 403 });

  // 멤버가 한 명도 없는 방(끝난 회의의 채팅방 등)은 되살려도 아무 목록에도 안 뜬다 — 되살린 사람을 넣고 숨김을 풀어
  // 그 사람 채널 목록에 보이게 한다(관리자가 지난 회의 대화를 볼 수 있는 길, 2026-09-30).
  // 남의 방 대화를 원장이 임의로 열어 보지 않게, 자동 참여는 **본부 관리자와 그 방을 만든 사람**만.
  // 회의 전용 방(숨김)도 같다 — 되살리면 숨김을 풀어 일반 방처럼 보이게 한다(이제 회의 참여자가 멤버로 들어 있다).
  const privileged = session.role === "ADMIN" || channel.createdBy === session.userId;
  const special = channel.hidden || channel._count.members === 0;
  // 멤버 없는 방을 원장이 되살리면 "복구됐다"고만 뜨고 어느 목록에도 안 나타났다(숨김 회의방은 곧 다시 휴지통으로) — 거절한다(검증관 C-1)
  if (special && !privileged)
    return NextResponse.json({ error: "회의 채팅방과 참여자가 없는 방은 본부 관리자나 방을 만든 사람만 복구할 수 있습니다." }, { status: 403 });
  const joinAsViewer = special && channel.members.length === 0;
  await prisma.$transaction([
    prisma.workChannel.update({ where: { id }, data: { deletedAt: null, permanentlyDeletedAt: null, ...(channel.hidden ? { hidden: false } : {}) } }),
    // 동시에 두 번 눌러도 중복 키로 실패하지 않게 createMany + skipDuplicates
    ...(joinAsViewer ? [prisma.workChannelMember.createMany({ data: [{ channelId: id, userId: session.userId, lastReadAt: new Date() }], skipDuplicates: true })] : []),
  ]);
  return NextResponse.json({ success: true });
}
