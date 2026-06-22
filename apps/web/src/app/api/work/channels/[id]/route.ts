import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { channelCanManage } from "@/lib/work-perms";

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
    select: { type: true, isDefault: true, members: { select: { userId: true } } },
  });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });
  if (channel.isDefault) return NextResponse.json({ error: "기본 채널은 삭제할 수 없습니다." }, { status: 400 });

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
