import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseAttachments } from "@/lib/work-attachments";

async function assertMember(channelId: string, userId: string) {
  const channel = await prisma.workChannel.findUnique({
    where: { id: channelId },
    select: { isDefault: true, members: { select: { userId: true } } },
  });
  if (!channel) return { error: "채널을 찾을 수 없습니다.", status: 404 as const };
  const isMember = channel.members.some((m) => m.userId === userId);
  if (!channel.isDefault && !isMember) return { error: "접근 권한이 없습니다.", status: 403 as const };
  return {};
}

// 예약 메시지 등록 (글 + 첨부)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const acc = await assertMember(id, session.userId);
  if ("error" in acc) return NextResponse.json({ error: acc.error }, { status: acc.status });

  const { content, sendAt, attachments, attachFirst } = (await request.json()) as {
    content?: string;
    sendAt?: string;
    attachments?: unknown;
    attachFirst?: unknown;
  };
  // 첨부는 예약 시점에 이미 업로드된 것만 받는다 (경로 검증은 즉시 전송과 동일 규칙)
  const files = parseAttachments(attachments);
  if (!content?.trim() && files.length === 0)
    return NextResponse.json({ error: "메시지를 입력해주세요." }, { status: 400 });
  const at = sendAt ? new Date(sendAt) : null;
  if (!at || isNaN(at.getTime())) return NextResponse.json({ error: "예약 시간이 올바르지 않습니다." }, { status: 400 });
  if (at.getTime() < Date.now() + 60 * 1000)
    return NextResponse.json({ error: "예약 시간은 1분 이후여야 합니다." }, { status: 400 });
  if (at.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1000)
    return NextResponse.json({ error: "예약은 최대 90일 이내여야 합니다." }, { status: 400 });

  const scheduled = await prisma.workScheduledMessage.create({
    data: {
      channelId: id,
      userId: session.userId,
      content: content?.trim() ?? "",
      attachments: files.length > 0 ? files : undefined,
      attachFirst: files.length > 0 && !!attachFirst,
      sendAt: at,
    },
  });
  return NextResponse.json({ success: true, id: scheduled.id });
}

// 이 채널의 내 예약 목록 (대기 중)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const rows = await prisma.workScheduledMessage.findMany({
    where: { channelId: id, userId: session.userId, sentAt: null, canceledAt: null },
    orderBy: { sendAt: "asc" },
    select: { id: true, content: true, sendAt: true, attachments: true },
  });
  const scheduled = rows.map((s) => ({
    id: s.id,
    content: s.content,
    sendAt: s.sendAt,
    attachments: parseAttachments(s.attachments),
  }));
  return NextResponse.json({ scheduled });
}
