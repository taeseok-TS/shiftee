import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addMeetingChatMembers } from "@/lib/meeting-channel";

// 회의 입장/유지 신호 — lastJoinedAt 갱신 (자동 종료 판단용)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  await prisma.workMeeting.updateMany({
    where: { id, endedAt: null },
    data: { lastJoinedAt: new Date() },
  });
  // 회의 채팅 참여 — 이 회의에 들어올 수 있는 사람(개설자·초대받은 사람·본부 관리자)만 방 멤버로 넣는다.
  // 초대 없이 들어온 본부 관리자와, 멤버 등록이 생기기 전에 열린 회의를 여기서 메운다. 실패해도 입장 신호는 성공.
  const meeting = await prisma.workMeeting.findFirst({
    where: { id, endedAt: null },
    select: { channelId: true, createdBy: true, invites: { where: { userId: session.userId }, select: { userId: true } } },
  });
  const chatOk = !!meeting && (session.role === "ADMIN" || meeting.createdBy === session.userId || meeting.invites.length > 0);
  if (chatOk) await addMeetingChatMembers(meeting.channelId, [session.userId]).catch((e) => console.error("[meeting] 채팅 참여 등록 실패:", e));
  return NextResponse.json({ ok: true, chat: chatOk });
}
