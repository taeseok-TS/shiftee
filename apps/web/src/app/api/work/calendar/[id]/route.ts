import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 일정 삭제 (관리자 또는 해당 지점 원장)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const event = await prisma.workCalendarEvent.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "일정을 찾을 수 없습니다." }, { status: 404 });

  const canEdit =
    session.role === "ADMIN" || (session.role === "MANAGER" && event.branch === session.branch);
  if (!canEdit) return NextResponse.json({ error: "삭제 권한이 없습니다." }, { status: 403 });

  await prisma.workCalendarEvent.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
