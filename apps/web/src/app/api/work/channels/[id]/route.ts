import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 채널 관리 권한: 관리자/원장 또는 채널 생성자
async function canManage(channelId: string, userId: string, role: string) {
  if (role === "ADMIN" || role === "MANAGER") return true;
  const ch = await prisma.workChannel.findUnique({ where: { id: channelId }, select: { createdBy: true } });
  return ch?.createdBy === userId;
}

// 채널 이름 변경
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { name } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: "채널 이름을 입력해주세요." }, { status: 400 });

  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { type: true, isDefault: true } });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });
  if (channel.type === "DM") return NextResponse.json({ error: "DM은 이름을 변경할 수 없습니다." }, { status: 400 });
  if (channel.isDefault) return NextResponse.json({ error: "기본 채널은 이름을 변경할 수 없습니다." }, { status: 400 });
  if (!(await canManage(id, session.userId, session.role)))
    return NextResponse.json({ error: "채널을 관리할 권한이 없습니다." }, { status: 403 });

  await prisma.workChannel.update({ where: { id }, data: { name: name.trim() } });
  return NextResponse.json({ success: true });
}
