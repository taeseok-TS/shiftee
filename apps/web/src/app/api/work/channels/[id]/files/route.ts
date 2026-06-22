import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { channelCanManage } from "@/lib/work-perms";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

function diskPath(fileUrl: string): string | null {
  if (!fileUrl.startsWith("/api/uploads/")) return null;
  const rel = fileUrl.replace(/^\/api\/uploads\//, "");
  return path.join(process.cwd(), "uploads", ...rel.split("/").map((s) => decodeURIComponent(s)));
}

// 채널 첨부파일 목록 (참여자 누구나 조회)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;

  const msgs = await prisma.workMessage.findMany({
    where: { channelId: id, fileUrl: { not: null } },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    files: msgs.map((m) => ({
      messageId: m.id,
      fileUrl: m.fileUrl,
      fileName: m.fileName,
      fileType: m.fileType,
      userName: m.user.name,
      createdAt: m.createdAt,
    })),
  });
}

// 채널 첨부파일 정리(삭제) — 생성자/방장/관리자만. 채팅방은 유지, 파일만 제거.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;

  if (!(await channelCanManage(id, session.userId, session.role)))
    return NextResponse.json({ error: "파일을 정리할 권한이 없습니다." }, { status: 403 });

  const msgs = await prisma.workMessage.findMany({
    where: { channelId: id, fileUrl: { not: null } },
    select: { id: true, fileUrl: true, content: true },
  });

  let removed = 0;
  for (const m of msgs) {
    // 디스크 파일 삭제
    const p = m.fileUrl ? diskPath(m.fileUrl) : null;
    if (p) { try { await fs.unlink(p); } catch { /* 이미 없으면 무시 */ } }
    // 첨부만 있던 메시지는 삭제, 텍스트가 있으면 첨부만 제거
    if (!m.content || !m.content.trim()) {
      await prisma.workMessage.delete({ where: { id: m.id } }).catch(() => {});
    } else {
      await prisma.workMessage.update({ where: { id: m.id }, data: { fileUrl: null, fileName: null, fileType: null } });
    }
    removed++;
  }

  return NextResponse.json({ success: true, removed });
}
