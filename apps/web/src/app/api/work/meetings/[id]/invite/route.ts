import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitWork } from "@/lib/work-events";

// 화상회의 초대: 선택한 직원들에게 DM으로 참여 링크 발송
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { inviteIds } = (await request.json()) as { inviteIds?: string[] };
  if (!Array.isArray(inviteIds) || inviteIds.length === 0)
    return NextResponse.json({ error: "초대할 직원을 선택해주세요." }, { status: 400 });

  const meeting = await prisma.workMeeting.findUnique({ where: { id }, select: { title: true, endedAt: true } });
  if (!meeting) return NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });
  if (meeting.endedAt) return NextResponse.json({ error: "이미 종료된 회의입니다." }, { status: 400 });

  const base = process.env.NEXT_PUBLIC_APP_URL || "";
  const text = `📹 화상회의 초대: "${meeting.title}"\n지금 참여하기 → ${base}/work/meeting`;

  let invited = 0;
  for (const otherId of inviteIds) {
    if (otherId === session.userId) continue;

    // 초대자-피초대자 간 DM 채널 찾기/생성
    let dm = await prisma.workChannel.findFirst({
      where: {
        type: "DM",
        AND: [
          { members: { some: { userId: session.userId } } },
          { members: { some: { userId: otherId } } },
        ],
      },
      select: { id: true },
    });
    if (!dm) {
      dm = await prisma.workChannel.create({
        data: {
          name: "DM",
          type: "DM",
          createdBy: session.userId,
          members: { create: [{ userId: session.userId }, { userId: otherId }] },
        },
        select: { id: true },
      });
    }

    await prisma.workMessage.create({
      data: { channelId: dm.id, userId: session.userId, content: text },
    });
    emitWork({ type: "message", channelId: dm.id });
    invited++;
  }

  return NextResponse.json({ success: true, invited });
}
