import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import Busboy from "busboy";
import { Readable } from "stream";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
// 브라우저에서 재생 가능한 포맷만 video로 (avi/mkv는 <video>가 재생 못해 일반 파일로 취급)
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);
// 음성 메시지 (앱 녹음은 .m4a) — 웹·앱 모두 <audio>로 재생
const AUDIO_EXT = new Set([".m4a", ".mp3", ".wav", ".aac", ".ogg"]);

const MAX_SIZE = 500 * 1024 * 1024; // 500MB — 고화질(4K) 영상 대응

// 시프티워크 채팅 첨부 업로드 — 메모리에 올리지 않고 디스크로 스트리밍 (대용량 대응)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data") || !request.body)
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  const dir = path.join(process.cwd(), "uploads", "work");
  await fs.mkdir(dir, { recursive: true });

  const result = await new Promise<
    { fileName: string; safeName: string } | { _error: string; status: number }
  >((resolve) => {
    const bb = Busboy({
      headers: { "content-type": contentType },
      // 브라우저는 파일명을 UTF-8 그대로 보냄 — 기본(latin1)이면 한글 파일명이 깨진다
      defParamCharset: "utf8",
      limits: { fileSize: MAX_SIZE, files: 1 },
    });
    let sawFile = false;
    bb.on("file", (_field, stream, info) => {
      sawFile = true;
      const fileName = info.filename || "file";
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${fileName.replace(/[^a-zA-Z0-9.\-_가-힣]/g, "_")}`;
      const dest = createWriteStream(path.join(dir, safeName));
      stream.pipe(dest);
      stream.on("limit", () => {
        dest.destroy();
        fs.unlink(path.join(dir, safeName)).catch(() => {});
        resolve({ _error: "500MB 이하 파일만 업로드할 수 있습니다.", status: 400 });
      });
      dest.on("finish", () => resolve({ fileName, safeName }));
      dest.on("error", () => {
        fs.unlink(path.join(dir, safeName)).catch(() => {});
        resolve({ _error: "파일 저장 중 오류가 발생했습니다.", status: 500 });
      });
    });
    bb.on("error", () => resolve({ _error: "업로드 본문을 읽지 못했습니다. 다시 시도해주세요.", status: 400 }));
    bb.on("finish", () => { if (!sawFile) resolve({ _error: "파일이 없습니다.", status: 400 }); });
    Readable.fromWeb(request.body as import("stream/web").ReadableStream).pipe(bb);
  });

  if ("_error" in result) return NextResponse.json({ error: result._error }, { status: result.status });

  const ext = path.extname(result.fileName).toLowerCase();
  const fileUrl = `/api/uploads/work/${result.safeName}`;
  const fileType = IMAGE_EXT.has(ext) ? "image" : VIDEO_EXT.has(ext) ? "video" : AUDIO_EXT.has(ext) ? "audio" : "file";

  // 100MB 초과 영상은 백그라운드 압축 큐에 등록 (스케줄러가 1080p로 변환 후 교체)
  if (fileType === "video") {
    const st = await fs.stat(path.join(dir, result.safeName)).catch(() => null);
    if (st) {
      const { enqueueVideoCompress } = await import("@/lib/videoCompress");
      await enqueueVideoCompress(fileUrl, st.size).catch(() => {});
    }
  }

  return NextResponse.json({ fileUrl, fileName: result.fileName, fileType });
}
