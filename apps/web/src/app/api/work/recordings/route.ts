import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

// 녹화본 목록 (최근)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const recordings = await prisma.workMeetingRecording.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    recordings: recordings.map((r) => ({
      id: r.id,
      meetingTitle: r.meetingTitle,
      room: r.room,
      fileUrl: r.fileUrl,
      fileName: r.fileName,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt,
      canDelete: r.createdBy === session.userId || session.role === "ADMIN",
    })),
  });
}

// 녹화본 업로드 (회의 종료 후 보존)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const meetingTitle = (formData.get("meetingTitle") as string) || "화상회의";
  const room = (formData.get("room") as string) || "";
  if (!file) return NextResponse.json({ error: "녹화 파일이 없습니다." }, { status: 400 });

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-recording.webm`;
  const dir = path.join(process.cwd(), "uploads", "work", "recordings");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, safeName), buffer);

  const fileName = `${meetingTitle}_${new Date().toISOString().slice(0, 10)}.webm`;
  const recording = await prisma.workMeetingRecording.create({
    data: {
      meetingTitle,
      room,
      fileUrl: `/api/uploads/work/recordings/${safeName}`,
      fileName,
      sizeBytes: buffer.length,
      createdBy: session.userId,
    },
  });
  return NextResponse.json({ success: true, recording });
}
