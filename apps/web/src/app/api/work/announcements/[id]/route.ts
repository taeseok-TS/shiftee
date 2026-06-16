import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 공지 삭제 (작성자 또는 관리자)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const a = await prisma.workAnnouncement.findUnique({ where: { id } });
  if (!a) return NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 });
  if (a.authorId !== session.userId && session.role !== "ADMIN")
    return NextResponse.json({ error: "삭제 권한이 없습니다." }, { status: 403 });

  await prisma.workAnnouncement.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
