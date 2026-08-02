import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitWork } from "@/lib/work-events";
import { sendPushToUsers } from "@/lib/push";

// 채널 멤버 확인 (기본 채널은 모두 허용)
async function assertMember(channelId: string, userId: string) {
  const channel = await prisma.workChannel.findUnique({
    where: { id: channelId },
    select: { isDefault: true, type: true, members: { select: { userId: true } } },
  });
  if (!channel) return { error: "채널을 찾을 수 없습니다.", status: 404 as const };
  const isMember = channel.members.some((m) => m.userId === userId);
  if (!channel.isDefault && !isMember) return { error: "접근 권한이 없습니다.", status: 403 as const };
  return { channel };
}

// 채널 공지 등록/변경 (구성원 누구나)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const acc = await assertMember(id, session.userId);
  if ("error" in acc) return NextResponse.json({ error: acc.error }, { status: acc.status });

  // 전체(기본) 채널의 전사 공지는 관리자만 등록할 수 있다
  if (acc.channel.isDefault && session.role !== "ADMIN")
    return NextResponse.json({ error: "전체 채널 공지는 관리자만 등록할 수 있습니다." }, { status: 403 });

  const { content, imageUrl, important } = (await request.json()) as { content?: string; imageUrl?: string; important?: boolean };
  if (!content?.trim() && !imageUrl)
    return NextResponse.json({ error: "공지 내용을 입력해주세요." }, { status: 400 });
  // 이미지 공지는 내부 업로드 경로만 허용 (외부 URL 주입 방지)
  if (imageUrl && !imageUrl.startsWith("/api/uploads/"))
    return NextResponse.json({ error: "잘못된 이미지 경로입니다." }, { status: 400 });

  await prisma.workChannel.update({
    where: { id },
    data: { noticeContent: content?.trim() || null, noticeImageUrl: imageUrl || null, noticeBy: session.name, noticeAt: new Date(), noticeImportant: !!important },
  });
  await prisma.workMessage.create({
    data: { channelId: id, userId: session.userId, content: `${session.name}님이 ${important ? "중요 " : ""}공지를 등록했습니다.`, system: true },
  });
  emitWork({ type: "message", channelId: id });

  // 중요 공지: 채널 멤버에게 즉시 푸시 (등록자 제외)
  if (important) {
    const members = await prisma.workChannelMember.findMany({
      where: { channelId: id, userId: { not: session.userId } },
      select: { userId: true },
    });
    const preview = content?.trim() ? content.trim().slice(0, 80) : "이미지 공지";
    sendPushToUsers(members.map((m) => m.userId), {
      title: "📌 중요 공지",
      body: preview,
      data: { channelId: id, type: "work-message" },
    }, { respectWorkMute: true }).catch((e) => console.error("[push] notice 오류:", e));
  }

  return NextResponse.json({ success: true });
}

// 채널 공지 내리기 (구성원 누구나)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const acc = await assertMember(id, session.userId);
  if ("error" in acc) return NextResponse.json({ error: acc.error }, { status: acc.status });

  // 전체(기본) 채널의 전사 공지는 관리자만 내릴 수 있다
  if (acc.channel.isDefault && session.role !== "ADMIN")
    return NextResponse.json({ error: "전체 채널 공지는 관리자만 내릴 수 있습니다." }, { status: 403 });

  await prisma.workChannel.update({
    where: { id },
    data: { noticeContent: null, noticeImageUrl: null, noticeBy: null, noticeAt: null, noticeImportant: false },
  });
  // 누가 내렸는지 기록 (시스템 메시지)
  await prisma.workMessage.create({
    data: { channelId: id, userId: session.userId, content: `${session.name}님이 공지를 내렸습니다.`, system: true },
  });
  emitWork({ type: "message", channelId: id });
  return NextResponse.json({ success: true });
}
