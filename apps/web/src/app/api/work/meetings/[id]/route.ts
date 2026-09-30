import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { trashEndedMeetingChannels } from "@/lib/meeting-channel";

// 회의 종료 (개설자 또는 관리자)
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const meeting = await prisma.workMeeting.findUnique({ where: { id } });
  if (!meeting) return NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });
  if (meeting.createdBy !== session.userId && session.role !== "ADMIN")
    return NextResponse.json({ error: "종료 권한이 없습니다." }, { status: 403 });

  await prisma.workMeeting.update({ where: { id }, data: { endedAt: new Date() } });
  // 회의 전용 채팅방도 휴지통으로 — 종료가 이것 때문에 실패하면 안 된다
  await trashEndedMeetingChannels().catch((e) => console.error("[meeting] 회의방 정리 실패:", e));
  return NextResponse.json({ ok: true });
}
