import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { Readable } from "stream";
import fs from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";

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

  // 계약 템플릿은 관리자만. 원래 URL만 알면 로그인 없이 받아갈 수 있었다.
  if (decoded[0] === "templates" || pathParts[0] === "templates") {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    if (session.role !== "ADMIN")
      return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  // 접근 게이트 (2026-08-24) — 세션(웹 쿠키/Bearer) 또는 접근 티켓(?t=) 필수.
  // 앱·게스트·MS 뷰어처럼 헤더를 못 싣는 경로는 티켓을 URL에 부착한다(lib/upload-ticket).
  // 경로군별 단계 적용: 기본 signatures·contracts. 앱 OTA 확산 후 work·avatars 확대 예정
  // (환경변수 UPLOADS_GATE 로 조절, "off" 면 게이트 없음).
  // 빈 문자열은 오설정으로 보고 기본값 사용 — 끄려면 명시적으로 "off"
  const gateEnvRaw = (process.env.UPLOADS_GATE ?? "").trim();
  const gateEnv = gateEnvRaw === "" ? "signatures,contracts" : gateEnvRaw;
  const gated = gateEnv === "off" ? [] : gateEnv.split(",").map((s) => s.trim()).filter(Boolean);
  if (gated.includes(decoded[0]) || gated.includes(pathParts[0])) {
    const { verifyUploadTicket } = await import("@/lib/upload-ticket");
    const ticket = new URL(_request.url).searchParams.get("t");
    if (!verifyUploadTicket(ticket)) {
      const session = await getSession();
      if (!session)
        return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
  }

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
  // 기본 inline(미리보기/오피스 뷰어가 렌더 가능). ?download=1 이면 다운로드로 강제.
  // (워드도 inline이면 브라우저가 자체 렌더 못 해 결국 다운로드되므로 다운로드 UX엔 지장 없음)
  const url = new URL(_request.url);
  const forceDownload = url.searchParams.get("download") === "1";
  const disposition = forceDownload ? "attachment" : "inline";

  // ?name= 으로 저장 파일명 지정 가능 (개선 제안 2026-08-24 — 계약서를 제목으로 저장).
  // 헤더용 표시 이름일 뿐 디스크 경로와 무관. 경로 문자만 제거하고 확장자는 실제 파일 것을 보장.
  let downloadName = usedName;
  const rawName = url.searchParams.get("name");
  if (rawName) {
    const safe = rawName.replace(/[\\/:*?"<>|\r\n]/g, "").trim().slice(0, 120);
    if (safe) downloadName = safe.toLowerCase().endsWith(ext) ? safe : safe + ext;
  }

  // RFC 5987: encodeURIComponent 가 남기는 '()* 도 attr-char 가 아니라 추가 인코딩,
  // 엄격한 파서용 ASCII filename= 폴백도 함께 (검증관 지적 — 제목에 괄호가 흔함)
  const rfc5987 = encodeURIComponent(downloadName).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const asciiFallback = downloadName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'") || usedName;
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${rfc5987}`,
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
