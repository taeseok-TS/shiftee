import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import fs from "fs/promises";
import path from "path";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);

// 시프티워크 채팅 첨부 업로드
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  if (file.size > 100 * 1024 * 1024)
    return NextResponse.json({ error: "100MB 이하 파일만 업로드할 수 있습니다." }, { status: 400 });

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const ext = path.extname(file.name).toLowerCase();
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${file.name.replace(/[^a-zA-Z0-9.\-_가-힣]/g, "_")}`;
  const dir = path.join(process.cwd(), "uploads", "work");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, safeName), buffer);

  return NextResponse.json({
    fileUrl: `/api/uploads/work/${safeName}`,
    fileName: file.name,
    fileType: IMAGE_EXT.has(ext) ? "image" : "file",
  });
}
