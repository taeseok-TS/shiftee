import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteWorkAttachmentFiles } from "@/lib/work-attachments";

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
    select: { userId: true, sentAt: true, canceledAt: true, attachments: true },
  });
  if (!scheduled) return NextResponse.json({ error: "예약을 찾을 수 없습니다." }, { status: 404 });
  if (scheduled.userId !== session.userId)
    return NextResponse.json({ error: "본인의 예약만 취소할 수 있습니다." }, { status: 403 });
  if (scheduled.sentAt) return NextResponse.json({ error: "이미 발송된 예약입니다." }, { status: 400 });
  if (scheduled.canceledAt) return NextResponse.json({ error: "이미 취소된 예약입니다." }, { status: 400 });

  // 취소 표시를 먼저 — 여기서 밀리면 발송기가 그 사이에 보내버린다.
  // updateMany + 조건으로, 이미 발송·취소된 건은 건드리지 않는다(첨부 파일을 지우면 안 되므로).
  const claim = await prisma.workScheduledMessage.updateMany({
    where: { id, sentAt: null, canceledAt: null },
    data: { canceledAt: new Date() },
  });
  if (claim.count === 0)
    return NextResponse.json({ error: "이미 발송되었거나 취소된 예약입니다." }, { status: 400 });

  // 예약과 함께 올려둔 첨부 파일도 지운다 (디렉터 지시 2026-09-16)
  await deleteWorkAttachmentFiles(scheduled.attachments).catch((e) =>
    console.error("[예약취소] 첨부 삭제 오류:", e)
  );
  return NextResponse.json({ success: true });
}
