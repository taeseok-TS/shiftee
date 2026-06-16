import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml",
  ".webm": "video/webm", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathParts } = await params;

  if (!pathParts || pathParts.length === 0)
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  // 한글 등 퍼센트 인코딩된 세그먼트 디코드 (안 되면 원본 유지)
  const decoded = pathParts.map((p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
  // 경로 이탈 방지
  if (decoded.some((p) => p.includes("..") || p.includes("/") || p.includes("\\")))
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  const baseDir = path.join(process.cwd(), "uploads");

  async function tryRead(parts: string[]) {
    try { return await fs.readFile(path.join(baseDir, ...parts)); } catch { return null; }
  }

  // 디코드 경로 → 실패 시 원본 경로 폴백
  let buffer = await tryRead(decoded);
  let usedName = decoded[decoded.length - 1];
  if (!buffer) { buffer = await tryRead(pathParts); usedName = pathParts[pathParts.length - 1]; }
  if (!buffer) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });

  const ext = path.extname(usedName).toLowerCase();
  const contentType =
    IMAGE_TYPES[ext] ||
    (ext === ".pdf"
      ? "application/pdf"
      : ext === ".docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/octet-stream");
  // 이미지/PDF는 inline, 워드 등은 다운로드. 파일명은 RFC5987로 안전 인코딩
  const disposition = ext === ".docx" ? "attachment" : "inline";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(usedName)}`,
    },
  });
}
