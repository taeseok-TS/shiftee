import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitWork } from "@/lib/work-events";
import { sendPushToUsers } from "@/lib/push";
import { isMentioned } from "@/lib/mention";

// 투표 생성 (구성원 누구나) — 생성과 동시에 투표 카드 메시지가 채팅에 올라간다
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const channel = await prisma.workChannel.findUnique({
    where: { id },
    select: { name: true, isDefault: true, members: { select: { userId: true } } },
  });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });
  const isMember = channel.members.some((m) => m.userId === session.userId);
  if (!channel.isDefault && !isMember)
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

  const { question, options, multiple, closesAt: closesAtRaw } = (await request.json()) as {
    question?: string;
    options?: string[];
    multiple?: boolean;
    closesAt?: string;
  };
  const opts = (options || []).map((o) => (o || "").trim()).filter(Boolean);
  if (!question?.trim()) return NextResponse.json({ error: "투표 질문을 입력해주세요." }, { status: 400 });
  if (opts.length < 2) return NextResponse.json({ error: "선택지를 2개 이상 입력해주세요." }, { status: 400 });
  if (opts.length > 10) return NextResponse.json({ error: "선택지는 최대 10개까지 가능합니다." }, { status: 400 });

  // 종료 일시 (선택) — 도래 시 자동 마감
  let closesAt: Date | null = null;
  if (closesAtRaw) {
    closesAt = new Date(closesAtRaw);
    if (isNaN(closesAt.getTime()))
      return NextResponse.json({ error: "종료 일시가 올바르지 않습니다." }, { status: 400 });
    if (closesAt.getTime() <= Date.now())
      return NextResponse.json({ error: "종료 일시는 현재 이후여야 합니다." }, { status: 400 });
  }

  const poll = await prisma.workPoll.create({
    data: {
      channelId: id,
      creatorId: session.userId,
      creatorName: session.name,
      question: question.trim(),
      options: opts,
      multiple: !!multiple,
      closesAt,
    },
  });
  const content = `📊 투표: ${question.trim()}`;
  await prisma.workMessage.create({
    data: { channelId: id, userId: session.userId, content, pollId: poll.id },
  });
  emitWork({ type: "message", channelId: id });

  // 푸시 알림 (일반 메시지와 동일 규칙: 생성자 제외, MUTE 제외, MENTION은 멘션 시만). 응답을 막지 않게 비동기.
  (async () => {
    const members = await prisma.workChannelMember.findMany({
      where: { channelId: id, userId: { not: session.userId } },
      select: { userId: true, notify: true, user: { select: { name: true } } },
    });
    const recipients = members
      .filter((m) => m.notify !== "MUTE")
      .filter((m) => (m.notify === "MENTION" ? isMentioned(content, m.user.name) : true))
      .map((m) => m.userId);
    await sendPushToUsers(recipients, {
      title: channel.name,
      body: `${session.name}: ${content}`,
      data: { channelId: id, type: "work-message" },
    }, { respectWorkMute: true });
  })().catch((e) => console.error("[push] poll notify 오류:", e));

  return NextResponse.json({ success: true, pollId: poll.id });
}
