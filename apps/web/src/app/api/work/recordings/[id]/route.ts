import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

// 녹화본 삭제 (작성자 또는 관리자)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const rec = await prisma.workMeetingRecording.findUnique({ where: { id } });
  if (!rec) return NextResponse.json({ error: "녹화본을 찾을 수 없습니다." }, { status: 404 });
  if (rec.createdBy !== session.userId && session.role !== "ADMIN")
    return NextResponse.json({ error: "삭제 권한이 없습니다." }, { status: 403 });

  // 디스크 파일도 정리 (실패해도 레코드는 삭제)
  try {
    const fname = rec.fileUrl.split("/").pop()!;
    await fs.unlink(path.join(process.cwd(), "uploads", "work", "recordings", fname));
  } catch {
    /* noop */
  }
  await prisma.workMeetingRecording.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
