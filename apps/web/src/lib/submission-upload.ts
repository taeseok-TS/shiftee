// 자료제출 첨부 받기(멀티파트) — /api/v1/submissions POST 가 파일과 항목을 한 번에 받을 때 쓴다 (2026-09-13)
// 검사 규칙은 웹 업로드 라우트(api/work/submissions/upload)와 같다: 확장자·50MB·매직바이트, 파일명 안전화 + 업로더 표식.
import Busboy from "busboy";
import { Readable } from "stream";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import type { NextRequest } from "next/server";
import { ALLOWED_EXT, MAX_FILES, MAX_FILE_BYTES, extOf, fileTypeOf, magicMatches, type SubmissionFile } from "@/lib/submissions";
import { uploaderTag } from "@/lib/submission-access";

export type MultipartResult = { fields: Record<string, string>; files: SubmissionFile[]; error?: string };

export async function receiveSubmissionMultipart(request: NextRequest, userId: string): Promise<MultipartResult> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data") || !request.body) return { fields: {}, files: [], error: "multipart/form-data 로 보내주세요." };
  const dir = path.join(process.cwd(), "uploads", "submissions");
  await fs.mkdir(dir, { recursive: true });
  const tag = uploaderTag(userId);
  const fields: Record<string, string> = {};
  const saved: { fileName: string; safeName: string }[] = [];
  let error: string | undefined;

  let bb: ReturnType<typeof Busboy>;
  try {
    bb = Busboy({ headers: { "content-type": contentType }, defParamCharset: "utf8", limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 20 } });
  } catch {
    return { fields: {}, files: [], error: "multipart 본문이 올바르지 않습니다(boundary 없음)." }; // 검증관 P4 — 500 이 아니라 400
  }
  await new Promise<void>((resolve) => {
    let pending = 0;
    let finished = false;
    const done = () => { if (finished && pending === 0) resolve(); };
    bb.on("field", (name, val) => { if (typeof val === "string") fields[name] = val.slice(0, 4000); });
    bb.on("file", (_field, stream, info) => {
      const fileName = (info.filename || "").trim();
      const ext = extOf(fileName);
      if (!fileName || !ALLOWED_EXT.has(ext) || error) { stream.resume(); if (!error && fileName) error = `허용하지 않는 파일 형식입니다: ${fileName}`; return; }
      pending++;
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${tag}-${fileName.replace(/[^a-zA-Z0-9.\-_가-힣]/g, "_").replace(/\.{2,}/g, ".")}`;
      const full = path.join(dir, safeName);
      const dest = createWriteStream(full);
      // ⚠ 검증관 C1: limit 뒤 dest.destroy() 하면 pipe 가 파괴된 스트림에 쓰다 'error' 를 또 내고(pending 두 번 감소),
      //   busboy 파일 스트림은 멈춘 채 'end' 를 못 내 finish 가 영영 안 온다(핸들러 무응답). 파일마다 **한 번만** 정산하고,
      //   실패하면 unpipe + resume 으로 busboy 가 나머지를 비우게 한다.
      let settled = false;
      const settle = (fn: () => void) => { if (settled) return; settled = true; fn(); pending--; done(); };
      const fail = (msg: string) => settle(() => {
        stream.unpipe(dest); stream.resume();
        dest.destroy();
        fs.unlink(full).catch(() => {});
        if (!error) error = msg;
      });
      stream.pipe(dest);
      stream.on("limit", () => fail(`파일당 50MB 이하만 올릴 수 있습니다: ${fileName}`));
      stream.on("error", () => fail("업로드 본문을 읽지 못했습니다."));
      dest.on("finish", () => settle(() => { saved.push({ fileName, safeName }); }));
      dest.on("error", () => fail("파일 저장 중 오류가 발생했습니다."));
    });
    bb.on("filesLimit", () => { error = `파일은 ${MAX_FILES}개까지입니다.`; });
    bb.on("error", () => { error = "업로드 본문을 읽지 못했습니다."; finished = true; done(); });
    bb.on("finish", () => { finished = true; done(); });
    Readable.fromWeb(request.body as import("stream/web").ReadableStream).pipe(bb);
  });

  // 매직바이트 검사 — 하나라도 틀리면 전부 지운다
  const files: SubmissionFile[] = [];
  for (const s of saved) {
    const full = path.join(dir, s.safeName);
    const ext = extOf(s.fileName);
    let ok = false; let size = 0;
    try {
      const fh = await fs.open(full, "r");
      try { const head = new Uint8Array(32); const { bytesRead } = await fh.read(head, 0, 32, 0); size = (await fh.stat()).size; ok = bytesRead > 0 && magicMatches(ext, head.subarray(0, bytesRead)); }
      finally { await fh.close().catch(() => {}); }
    } catch { ok = false; }
    if (!ok) { error = error || `파일 내용이 확장자와 맞지 않습니다: ${s.fileName}`; continue; }
    files.push({ url: `/api/uploads/submissions/${s.safeName}`, name: s.fileName, size, type: fileTypeOf(ext) });
  }
  if (error) {
    for (const s of saved) await fs.unlink(path.join(dir, s.safeName)).catch(() => {});
    return { fields, files: [], error };
  }
  return { fields, files };
}
