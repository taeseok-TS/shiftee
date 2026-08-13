import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAppUrl } from "@/lib/app-url";
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

  const meeting = await prisma.workMeeting.findUnique({
    where: { id },
    select: { title: true, endedAt: true, createdBy: true, invites: { select: { userId: true } } },
  });
  if (!meeting) return NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });
  if (meeting.endedAt) return NextResponse.json({ error: "이미 종료된 회의입니다." }, { status: 400 });

  // 회의 참여자(개설자·초대받은 사람)와 관리자만 초대 가능
  const canInvite =
    meeting.createdBy === session.userId ||
    session.role === "ADMIN" ||
    meeting.invites.some((i) => i.userId === session.userId);
  if (!canInvite)
    return NextResponse.json({ error: "회의 참여자만 초대할 수 있습니다." }, { status: 403 });

  // 초대 명단 기록 → 초대받은 사람만 진행 중 회의를 보고 참여할 수 있다
  await prisma.workMeetingInvite.createMany({
    data: inviteIds.filter((uid) => uid !== session.userId).map((uid) => ({ meetingId: id, userId: uid })),
    skipDuplicates: true,
  });

  const base = getAppUrl();
  // ?join=회의ID → 링크 클릭 시 해당 회의로 즉시 자동 입장
  const text = `📹 화상회의 초대: "${meeting.title}"\n지금 참여하기 → ${base}/work/meeting?join=${id}`;

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
      select: { id: true, deletedAt: true },
    });
    if (!dm) {
      dm = await prisma.workChannel.create({
        data: {
          name: "DM",
          type: "DM",
          createdBy: session.userId,
          members: { create: [{ userId: session.userId }, { userId: otherId }] },
        },
        select: { id: true, deletedAt: true },
      });
    } else if (dm.deletedAt) {
      // 소프트 삭제됐던 DM이면 되살림(안 그러면 초대 메시지가 숨겨진 채널로 들어감)
      await prisma.workChannel.update({
        where: { id: dm.id },
        data: { deletedAt: null, permanentlyDeletedAt: null },
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
