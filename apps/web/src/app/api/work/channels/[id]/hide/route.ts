import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// DM '나만 숨기기' — 내 멤버 행에만 hiddenAt 기록(상대에겐 영향 없음).
// 채널 자체는 삭제하지 않으며, 숨긴 뒤 새 메시지가 오면 목록에 다시 표시된다.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const updated = await prisma.workChannelMember.updateMany({
    where: { channelId: id, userId: session.userId },
    data: { hiddenAt: new Date() },
  });
  if (updated.count === 0)
    return NextResponse.json({ error: "참여 중인 채널이 아닙니다." }, { status: 404 });

  return NextResponse.json({ success: true });
}
