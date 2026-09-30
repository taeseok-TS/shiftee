import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { channelCanManage } from "@/lib/work-perms";
import { emitWork } from "@/lib/work-events";

// 채널 이름 / 라벨(색+텍스트) 변경
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { name, labelText, labelColor } = body as { name?: string; labelText?: string | null; labelColor?: string | null };

  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { type: true, isDefault: true } });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });
  if (channel.type === "DM") return NextResponse.json({ error: "DM은 변경할 수 없습니다." }, { status: 400 });
  // 전체(기본) 채널은 본부 관리자만 — 원장도 전체 채널의 멤버라 아래 검사를 통과한다
  if (channel.isDefault && session.role !== "ADMIN")
    return NextResponse.json({ error: "전체 채널은 본부 관리자만 변경할 수 있습니다." }, { status: 403 });
  if (!(await channelCanManage(id, session.userId, session.role)))
    return NextResponse.json({ error: "채널을 관리할 권한이 없습니다." }, { status: 403 });

  const data: { name?: string; labelText?: string | null; labelColor?: string | null } = {};
  if (name !== undefined) {
    if (!name.trim()) return NextResponse.json({ error: "채널 이름을 입력해주세요." }, { status: 400 });
    if (channel.isDefault) return NextResponse.json({ error: "기본 채널은 이름을 변경할 수 없습니다." }, { status: 400 });
    data.name = name.trim();
  }
  if (labelText !== undefined) data.labelText = labelText && labelText.trim() ? labelText.trim() : null;
  if (labelColor !== undefined) data.labelColor = labelColor || null;

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "변경할 내용이 없습니다." }, { status: 400 });

  await prisma.workChannel.update({ where: { id }, data });

  // 이름 변경 시 채팅방에 시스템 알림 메시지(누가 바꿨는지) 남기기
  if (data.name) {
    await prisma.workMessage.create({
      data: {
        channelId: id,
        userId: session.userId,
        content: `${session.name}님이 채팅방 이름을 "${data.name}"(으)로 변경했습니다.`,
        system: true,
      },
    });
    emitWork({ type: "message", channelId: id });
  }

  return NextResponse.json({ success: true });
}

// 채널/DM 삭제 (소프트 삭제 → 30일 보관). CHANNEL: 생성자/방장/관리자. DM: 참여자 누구나.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const channel = await prisma.workChannel.findUnique({
    where: { id },
    select: { type: true, isDefault: true, hidden: true, members: { select: { userId: true } } },
  });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });
  if (channel.isDefault) return NextResponse.json({ error: "기본 채널은 삭제할 수 없습니다." }, { status: 400 });
  // 회의 전용 방(숨김)은 회의를 종료하면 자동으로 휴지통에 간다 — 진행 중에 직접 지웠다가 되살리면
  // 숨김이 풀린 방에 입장 신호가 참여자를 다시 넣어 전원에게 보였다(2026-09-30 검증관 C-1)
  if (channel.hidden) return NextResponse.json({ error: "회의 채팅방은 회의를 종료하면 자동으로 정리됩니다." }, { status: 400 });

  if (channel.type === "DM") {
    // DM은 참여자 누구나 삭제 가능
    if (!channel.members.some((m) => m.userId === session.userId))
      return NextResponse.json({ error: "삭제 권한이 없습니다." }, { status: 403 });
  } else {
    if (!(await channelCanManage(id, session.userId, session.role)))
      return NextResponse.json({ error: "채널을 삭제할 권한이 없습니다." }, { status: 403 });
  }

  const permanentlyDeletedAt = new Date();
  permanentlyDeletedAt.setDate(permanentlyDeletedAt.getDate() + 30);
  await prisma.workChannel.update({ where: { id }, data: { deletedAt: new Date(), permanentlyDeletedAt } });
  return NextResponse.json({ success: true });
}
