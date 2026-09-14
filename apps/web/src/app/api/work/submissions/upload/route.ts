import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import Busboy from "busboy";
import { createHash } from "crypto";
import { Readable } from "stream";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { ALLOWED_EXT, MAX_FILE_BYTES, extOf, fileTypeOf, magicMatches } from "@/lib/submissions";
import { uploaderTag } from "@/lib/submission-access";

// 자료제출 첨부 업로드 — 채팅 업로드(api/work/upload)와 같은 디스크 스트리밍이지만
// 저장 구역이 다르고(uploads/submissions — 서빙 라우트가 권한을 본다), 50MB·확장자·매직바이트를 본다.
// 올린 파일은 아직 어느 제출물에도 속하지 않는다 — 제출(POST /api/work/submissions)이 되기 전엔
// 서빙 라우트가 404 를 준다(제출물에 없는 파일은 아무도 못 본다).
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data") || !request.body)
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  const dir = path.join(process.cwd(), "uploads", "submissions");
  await fs.mkdir(dir, { recursive: true });

  const result = await new Promise<
    { fileName: string; safeName: string; sha256: string } | { _error: string; status: number }
  >((resolve) => {
    const bb = Busboy({
      headers: { "content-type": contentType },
      defParamCharset: "utf8", // 한글 파일명
      limits: { fileSize: MAX_FILE_BYTES, files: 1 },
    });
    let sawFile = false;
    let failCurrent: ((msg: string, status: number) => void) | null = null;
    bb.on("file", (_field, stream, info) => {
      sawFile = true;
      const fileName = (info.filename || "file").trim();
      const ext = extOf(fileName);
      if (!ALLOWED_EXT.has(ext)) {
        stream.resume(); // 본문은 버린다
        resolve({ _error: "워드·엑셀·PPT·PDF·한글·이미지·ZIP 파일만 올릴 수 있습니다.", status: 400 });
        return;
      }
      // 연속 점(..)은 서빙 라우트가 경로 이탈로 막아 열 수 없게 된다(검증관 2) — 점 하나로 접는다
      // 올린 사람 표식(tag)을 이름에 박는다 — 제출 때 본인 파일인지 대조한다(lib/submission-access fileBelongsTo)
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${uploaderTag(session.userId)}-${fileName.replace(/[^a-zA-Z0-9.\-_가-힣]/g, "_").replace(/\.{2,}/g, ".")}`;
      const full = path.join(dir, safeName);
      const dest = createWriteStream(full);
      // 한 번만 정산 + 실패 시 unpipe/resume, unlink 는 close 뒤 — lib/submission-upload 와 같은 방식(앱 검증관 P1)
      let settled = false;
      const hash = createHash("sha256"); // 받으면서 바로 계산(요청 ⑤)
      stream.on("data", (c: Buffer) => hash.update(c));
      const fail = (msg: string, status: number) => {
        if (settled) return; settled = true;
        stream.unpipe(dest); stream.resume();
        dest.once("close", () => { fs.unlink(full).catch(() => {}); });
        dest.destroy();
        resolve({ _error: msg, status });
      };
      failCurrent = fail;
      stream.pipe(dest);
      stream.on("limit", () => fail("파일당 50MB 이하만 올릴 수 있습니다.", 400));
      stream.on("error", () => fail("업로드 본문을 읽지 못했습니다.", 400));
      dest.on("finish", () => { if (!settled) { settled = true; resolve({ fileName, safeName, sha256: hash.digest("hex") }); } });
      dest.on("error", () => fail("파일 저장 중 오류가 발생했습니다.", 500));
    });
    bb.on("error", () => resolve({ _error: "업로드 본문을 읽지 못했습니다. 다시 시도해주세요.", status: 400 }));
    bb.on("finish", () => { if (!sawFile) resolve({ _error: "파일이 없습니다.", status: 400 }); });
    // 클라이언트가 중간에 끊으면 요청 본문 스트림이 'error' 를 낸다 — 리스너가 없으면 uncaughtException 이 되고
    // 진행 중 파일·핸들러가 영원히 남는다(9/13 검증관). 정리하고 응답한다. (앱 업로드는 끊김이 잦다)
    const src = Readable.fromWeb(request.body as import("stream/web").ReadableStream);
    src.on("error", () => { failCurrent?.("전송이 끊겼습니다.", 400); resolve({ _error: "전송이 끊겼습니다. 다시 시도해주세요.", status: 400 }); });
    src.pipe(bb);
  });

  if ("_error" in result) return NextResponse.json({ error: result._error }, { status: result.status });

  const full = path.join(dir, result.safeName);
  const ext = extOf(result.fileName);
  // 확장자만 바꾼 실행 파일을 거른다 — 머리 32바이트와 확장자가 맞아야 한다
  let size = 0;
  try {
    const fh = await fs.open(full, "r");
    try {
      const head = new Uint8Array(32);
      const { bytesRead } = await fh.read(head, 0, 32, 0);
      size = (await fh.stat()).size;
      if (bytesRead === 0 || !magicMatches(ext, head.subarray(0, bytesRead))) {
        await fh.close();
        await fs.unlink(full).catch(() => {});
        return NextResponse.json({ error: "파일 내용이 확장자와 맞지 않습니다. 원본 파일을 그대로 올려주세요." }, { status: 400 });
      }
    } finally { await fh.close().catch(() => {}); }
  } catch {
    await fs.unlink(full).catch(() => {});
    return NextResponse.json({ error: "파일 저장 중 오류가 발생했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    url: `/api/uploads/submissions/${result.safeName}`,
    name: result.fileName,
    sha256: result.sha256,
    size,
    type: fileTypeOf(ext),
  });
}
