import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 예약 메시지 취소 (본인 것만)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const scheduled = await prisma.workScheduledMessage.findUnique({
    where: { id },
    select: { userId: true, sentAt: true, canceledAt: true },
  });
  if (!scheduled) return NextResponse.json({ error: "예약을 찾을 수 없습니다." }, { status: 404 });
  if (scheduled.userId !== session.userId)
    return NextResponse.json({ error: "본인의 예약만 취소할 수 있습니다." }, { status: 403 });
  if (scheduled.sentAt) return NextResponse.json({ error: "이미 발송된 예약입니다." }, { status: 400 });
  if (scheduled.canceledAt) return NextResponse.json({ error: "이미 취소된 예약입니다." }, { status: 400 });

  await prisma.workScheduledMessage.update({ where: { id }, data: { canceledAt: new Date() } });
  return NextResponse.json({ success: true });
}
