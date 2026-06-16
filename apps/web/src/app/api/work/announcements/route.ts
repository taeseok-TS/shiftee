import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 공지 목록
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const announcements = await prisma.workAnnouncement.findMany({
    include: { author: { select: { id: true, name: true } } },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  return NextResponse.json({
    announcements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      pinned: a.pinned,
      attachments: (() => { try { return JSON.parse(a.attachments); } catch { return []; } })(),
      authorName: a.author.name,
      createdAt: a.createdAt,
      canEdit: a.authorId === session.userId || session.role === "ADMIN",
    })),
  });
}

// 공지 작성 (관리자/원장만)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE")
    return NextResponse.json({ error: "공지 작성 권한이 없습니다." }, { status: 403 });

  const { title, content, pinned, attachments } = await request.json();
  if (!title?.trim() || !content?.trim())
    return NextResponse.json({ error: "제목과 내용을 입력해주세요." }, { status: 400 });

  const announcement = await prisma.workAnnouncement.create({
    data: {
      title: title.trim(),
      content: content.trim(),
      pinned: !!pinned,
      attachments: JSON.stringify(Array.isArray(attachments) ? attachments : []),
      authorId: session.userId,
    },
  });
  return NextResponse.json({ success: true, announcement });
}
