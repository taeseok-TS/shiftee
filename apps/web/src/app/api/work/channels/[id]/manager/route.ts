import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 방장 지정/해제 — 채널 생성자 또는 관리자(ADMIN/MANAGER)만 가능
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { userId, isManager } = (await request.json()) as { userId?: string; isManager?: boolean };
  if (!userId) return NextResponse.json({ error: "대상이 없습니다." }, { status: 400 });

  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { createdBy: true } });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });

  const isOwnerOrAdmin =
    session.role === "ADMIN" || session.role === "MANAGER" || channel.createdBy === session.userId;
  if (!isOwnerOrAdmin)
    return NextResponse.json({ error: "방장은 채널 생성자 또는 관리자만 지정할 수 있습니다." }, { status: 403 });

  await prisma.workChannelMember.update({
    where: { channelId_userId: { channelId: id, userId } },
    data: { isManager: !!isManager },
  });
  return NextResponse.json({ success: true });
}
