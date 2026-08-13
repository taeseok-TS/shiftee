import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 메시지 리마인더 등록 — remindAt 도래 시 봇 DM으로 다시 알려줌
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const message = await prisma.workMessage.findUnique({
    where: { id },
    select: { deletedAt: true, channel: { select: { isDefault: true, members: { select: { userId: true } } } } },
  });
  if (!message || message.deletedAt) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  const isMember = message.channel.members.some((m) => m.userId === session.userId);
  if (!message.channel.isDefault && !isMember)
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

  const { remindAt } = (await request.json()) as { remindAt?: string };
  const at = remindAt ? new Date(remindAt) : null;
  if (!at || isNaN(at.getTime())) return NextResponse.json({ error: "알림 시간이 올바르지 않습니다." }, { status: 400 });
  if (at.getTime() < Date.now() + 60 * 1000)
    return NextResponse.json({ error: "알림 시간은 1분 이후여야 합니다." }, { status: 400 });
  if (at.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1000)
    return NextResponse.json({ error: "알림은 최대 90일 이내여야 합니다." }, { status: 400 });

  await prisma.workReminder.create({ data: { userId: session.userId, messageId: id, remindAt: at } });
  return NextResponse.json({ success: true });
}
