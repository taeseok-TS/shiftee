import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 채널 관리 권한: 관리자/원장 또는 채널 생성자
async function canManage(channelId: string, userId: string, role: string) {
  if (role === "ADMIN" || role === "MANAGER") return true;
  const ch = await prisma.workChannel.findUnique({ where: { id: channelId }, select: { createdBy: true } });
  return ch?.createdBy === userId;
}

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
  if (!(await canManage(id, session.userId, session.role)))
    return NextResponse.json({ error: "채널을 관리할 권한이 없습니다." }, { status: 403 });

  const data: { name?: string; labelText?: string | null; labelColor?: string | null } = {};

  if (name !== undefined) {
    if (!name.trim()) return NextResponse.json({ error: "채널 이름을 입력해주세요." }, { status: 400 });
    if (channel.isDefault) return NextResponse.json({ error: "기본 채널은 이름을 변경할 수 없습니다." }, { status: 400 });
    data.name = name.trim();
  }
  // 라벨: 빈 값이면 해제(null), 있으면 설정
  if (labelText !== undefined) data.labelText = labelText && labelText.trim() ? labelText.trim() : null;
  if (labelColor !== undefined) data.labelColor = labelColor || null;

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "변경할 내용이 없습니다." }, { status: 400 });

  await prisma.workChannel.update({ where: { id }, data });
  return NextResponse.json({ success: true });
}

// 채널 삭제 (소프트 삭제 → 30일 보관 후 영구 삭제). 생성자/관리자만, 기본 채널 제외
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { type: true, isDefault: true } });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });
  if (channel.isDefault) return NextResponse.json({ error: "기본 채널은 삭제할 수 없습니다." }, { status: 400 });
  if (channel.type === "DM") return NextResponse.json({ error: "DM은 삭제할 수 없습니다." }, { status: 400 });
  if (!(await canManage(id, session.userId, session.role)))
    return NextResponse.json({ error: "채널을 삭제할 권한이 없습니다." }, { status: 403 });

  const permanentlyDeletedAt = new Date();
  permanentlyDeletedAt.setDate(permanentlyDeletedAt.getDate() + 30);
  await prisma.workChannel.update({ where: { id }, data: { deletedAt: new Date(), permanentlyDeletedAt } });
  return NextResponse.json({ success: true });
}
