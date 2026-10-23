import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const HEIC_EXT = new Set([".heic", ".heif"]);   // 아이폰 원본 — JPG 로 바꿀 수 있을 때만 받는다(2026-10-23 ■1)

// 프로필 사진 업로드 (본인) → uploads/avatars 저장 + User.avatarUrl 갱신
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  let ext = path.extname(file.name).toLowerCase();
  if (!IMAGE_EXT.has(ext) && !HEIC_EXT.has(ext))
    return NextResponse.json({ error: "이미지 파일만 업로드할 수 있습니다." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024)
    return NextResponse.json({ error: "10MB 이하 이미지만 업로드할 수 있습니다." }, { status: 400 });

  const bytes = await file.arrayBuffer();
  let buffer: Buffer = Buffer.from(bytes);
  // HEIC 사진(이름만 .jpg 인 것 포함 — 내용으로 판별)은 JPG 로 바꿔 저장한다. .heic 이름인데 못 바꾸면 받지 않는다(종전과 같다)
  const { heicToJpeg } = await import("@/lib/heic-jpeg");
  const jpg = await heicToJpeg(buffer);
  if (jpg) { buffer = jpg; ext = ".jpg"; }
  else if (HEIC_EXT.has(ext)) return NextResponse.json({ error: "이 사진은 열 수 없습니다. JPG 로 바꿔 올려 주세요." }, { status: 400 });
  const safeName = `${session.userId}-${Date.now()}${ext}`;
  const dir = path.join(process.cwd(), "uploads", "avatars");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, safeName), buffer);

  const avatarUrl = `/api/uploads/avatars/${safeName}`;
  await prisma.user.update({ where: { id: session.userId }, data: { avatarUrl } });

  return NextResponse.json({ avatarUrl });
}

// 프로필 사진 삭제 (이니셜 아바타로 복귀)
export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  await prisma.user.update({ where: { id: session.userId }, data: { avatarUrl: null } });
  return NextResponse.json({ success: true });
}
