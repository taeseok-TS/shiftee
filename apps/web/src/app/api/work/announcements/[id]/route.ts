import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 공지 수정 — 핀 고정/해제 + 제목·내용·첨부 수정 (관리자 전용)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "공지 관리는 관리자만 가능합니다." }, { status: 403 });

  const { id } = await params;
  const { pinned, title, content, attachments } = (await request.json()) as {
    pinned?: boolean; title?: string; content?: string; attachments?: unknown[];
  };

  const data: Record<string, unknown> = {};
  if (typeof pinned === "boolean") data.pinned = pinned;
  if (typeof title === "string" && title.trim()) data.title = title.trim();
  if (typeof content === "string" && content.trim()) data.content = content.trim();
  if (Array.isArray(attachments)) data.attachments = JSON.stringify(attachments);
  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "수정할 내용이 없습니다." }, { status: 400 });

  const a = await prisma.workAnnouncement.findUnique({ where: { id } });
  if (!a) return NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 });

  await prisma.workAnnouncement.update({ where: { id }, data });
  return NextResponse.json({ success: true });
}

// 공지 삭제 (관리자 전용)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "공지 삭제는 관리자만 가능합니다." }, { status: 403 });

  const { id } = await params;
  const a = await prisma.workAnnouncement.findUnique({ where: { id } });
  if (!a) return NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 });

  await prisma.workAnnouncement.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
