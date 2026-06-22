import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 진행 중인 회의 목록
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // 자동 종료: 마지막 입장(없으면 개설) 후 1시간 동안 아무도 안 들어온 회의는 종료
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  await prisma.workMeeting.updateMany({
    where: { endedAt: null, lastJoinedAt: { not: null, lt: cutoff } },
    data: { endedAt: new Date() },
  });
  await prisma.workMeeting.updateMany({
    where: { endedAt: null, lastJoinedAt: null, createdAt: { lt: cutoff } },
    data: { endedAt: new Date() },
  });

  const meetings = await prisma.workMeeting.findMany({
    where: { endedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ meetings });
}

// 회의 생성 (방 개설)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { title } = await request.json();
  const meetingTitle = title?.trim() || "화상회의";
  // 고유 방 이름 (Jitsi 공개 서버에서 충돌 방지 위해 prefix + 랜덤)
  const room = `cubetee-${Math.random().toString(36).slice(2, 10)}`;

  // 회의 전용 사이드 채팅 채널 (메인 채널 목록에서는 숨김)
  const channel = await prisma.workChannel.create({
    data: { name: `회의: ${meetingTitle}`, type: "CHANNEL", hidden: true, createdBy: session.userId },
  });

  const meeting = await prisma.workMeeting.create({
    data: { room, title: meetingTitle, channelId: channel.id, createdBy: session.userId },
  });
  return NextResponse.json({ meeting });
}
