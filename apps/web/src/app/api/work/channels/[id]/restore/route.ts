import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 휴지통에서 채널 복구. 생성자/관리자만.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { createdBy: true } });
  if (!channel) return NextResponse.json({ error: "채널을 찾을 수 없습니다." }, { status: 404 });

  const canManage = session.role === "ADMIN" || session.role === "MANAGER" || channel.createdBy === session.userId;
  if (!canManage) return NextResponse.json({ error: "복구할 권한이 없습니다." }, { status: 403 });

  await prisma.workChannel.update({ where: { id }, data: { deletedAt: null, permanentlyDeletedAt: null } });
  return NextResponse.json({ success: true });
}
