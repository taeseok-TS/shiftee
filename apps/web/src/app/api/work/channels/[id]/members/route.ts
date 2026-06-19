import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function canManage(channelId: string, userId: string, role: string) {
  if (role === "ADMIN" || role === "MANAGER") return true;
  const ch = await prisma.workChannel.findUnique({ where: { id: channelId }, select: { createdBy: true } });
  return ch?.createdBy === userId;
}

// 채널 멤버 목록
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { createdBy: true } });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });

  const members = await prisma.workChannelMember.findMany({
    where: { channelId: id },
    include: { user: { select: { id: true, name: true, branch: true, position: true } } },
    orderBy: { joinedAt: "asc" },
  });

  return NextResponse.json({
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      branch: m.user.branch,
      position: m.user.position,
      isCreator: m.userId === channel.createdBy,
    })),
  });
}

// 멤버 추가
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { userIds, historyOption } = (await request.json()) as {
    userIds?: string[];
    historyOption?: "all" | "90days" | "none";
  };
  if (!Array.isArray(userIds) || userIds.length === 0)
    return NextResponse.json({ error: "추가할 멤버를 선택해주세요." }, { status: 400 });

  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { type: true } });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });
  if (channel.type === "DM") return NextResponse.json({ error: "DM에는 멤버를 추가할 수 없습니다." }, { status: 400 });
  if (!(await canManage(id, session.userId, session.role)))
    return NextResponse.json({ error: "채널을 관리할 권한이 없습니다." }, { status: 403 });

  // 과거 채팅기록 열람 범위 결정
  let historyFrom: Date | null = null; // all(기본): 전체 열람
  if (historyOption === "90days") historyFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  else if (historyOption === "none") historyFrom = new Date(); // 가입 이후만

  // 이미 멤버인 사람은 건너뜀
  await prisma.workChannelMember.createMany({
    data: userIds.map((userId) => ({ channelId: id, userId, historyFrom })),
    skipDuplicates: true,
  });

  return NextResponse.json({ success: true });
}

// 멤버 내보내기
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { userId } = (await request.json()) as { userId?: string };
  if (!userId) return NextResponse.json({ error: "대상이 없습니다." }, { status: 400 });

  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { type: true, isDefault: true, createdBy: true } });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });
  if (channel.isDefault) return NextResponse.json({ error: "기본 채널에서는 멤버를 내보낼 수 없습니다." }, { status: 400 });
  if (!(await canManage(id, session.userId, session.role)))
    return NextResponse.json({ error: "채널을 관리할 권한이 없습니다." }, { status: 403 });
  if (userId === channel.createdBy)
    return NextResponse.json({ error: "채널 생성자는 내보낼 수 없습니다." }, { status: 400 });

  await prisma.workChannelMember.deleteMany({ where: { channelId: id, userId } });
  return NextResponse.json({ success: true });
}
