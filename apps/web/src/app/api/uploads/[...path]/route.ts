import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { Readable } from "stream";
import fs from "fs/promises";
import path from "path";

// 업로드 파일은 요청 시점에 디스크에서 읽어야 하므로 정적 프리렌더 금지(항상 동적 실행)
export const dynamic = "force-dynamic";

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml",
  ".webm": "video/webm", ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v", ".mkv": "video/x-matroska",
  // 음성 (앱 녹음 .m4a 포함) — Range 지원과 함께 브라우저·앱에서 스트리밍 재생
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg",
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

  // 비공개 자산(회사 직인 등)은 URL로 절대 서빙하지 않음 — 서버 내부 코드만 접근
  if (decoded[0] === "private" || pathParts[0] === "private")
    return NextResponse.json({ error: "접근할 수 없습니다." }, { status: 403 });

  // 파일 전체를 메모리에 올리지 않고 stat만 확인 후 스트리밍 (500MB 영상 대응)
  async function tryStat(parts: string[]) {
    try {
      const p = path.join(baseDir, ...parts);
      const st = await fs.stat(p);
      return st.isFile() ? { filePath: p, size: st.size } : null;
    } catch { return null; }
  }

  // 디코드 경로 → 실패 시 원본 경로 폴백
  let hit = await tryStat(decoded);
  let usedName = decoded[decoded.length - 1];
  if (!hit) { hit = await tryStat(pathParts); usedName = pathParts[pathParts.length - 1]; }
  if (!hit) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });

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

  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(usedName)}`,
    "Accept-Ranges": "bytes",
  };

  const toBody = (stream: import("fs").ReadStream) =>
    Readable.toWeb(stream) as unknown as BodyInit;

  // Range 요청 처리 (iOS Safari/AVPlayer는 동영상에 필수 — 무시하면 재생 거부/탐색 불가)
  const range = _request.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      const size = hit.size;
      let start = m[1] ? parseInt(m[1]) : 0;
      let end = m[2] ? parseInt(m[2]) : size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= size) end = size - 1;
      if (start > end || start >= size) {
        return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      return new NextResponse(toBody(createReadStream(hit.filePath, { start, end })), {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }
  }

  return new NextResponse(toBody(createReadStream(hit.filePath)), {
    headers: { ...baseHeaders, "Content-Length": String(hit.size) },
  });
}
