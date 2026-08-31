import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";

// 변환 PDF 캐시 보관 기간 — 이 기간 안에 다시 열리지 않은 파일은 지운다.
// (계약 문서는 서명이 끝나면 다시 열릴 일이 드물어 캐시가 무한정 쌓이면 디스크만 먹는다)
const CACHE_TTL_DAYS = 14;
let lastSweep = 0;

async function writeCache(dir: string, file: string, pdf: Buffer) {
  try {
    await fs.mkdir(dir, { recursive: true });
    // 같은 문서를 동시에 열면 쓰기가 겹친다 — 임시 파일에 쓴 뒤 원자적으로 바꾼다
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, pdf);
    await fs.rename(tmp, file);
  } catch (e) {
    console.error("PDF 캐시 저장 실패(무시):", e);
  }
  // 하루에 한 번만 청소 — 요청 처리를 막지 않는다
  const now = Date.now();
  if (now - lastSweep < 24 * 60 * 60 * 1000) return;
  lastSweep = now;
  try {
    const cutoff = now - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    for (const name of await fs.readdir(dir)) {
      const p = path.join(dir, name);
      const s = await fs.stat(p).catch(() => null);
      if (s && s.mtimeMs < cutoff) await fs.unlink(p).catch(() => {});
    }
  } catch (e) {
    console.error("PDF 캐시 정리 실패(무시):", e);
  }
}

// 업로드된 문서(.docx)를 PDF 로 변환해 돌려주는 범용 라우트 (#153~#157·#162·#163, 2026-08-27).
//
// 배경: 문서를 보여주는 화면이 두 갈래였다 — 목록·서명 화면은 브라우저에서 docx-preview 로
// 그리고(로고·정렬을 못 그림), 발송 전 미리보기만 LibreOffice(gotenberg) PDF 였다.
// 같은 문서가 화면마다 다르게 보여 "어느 게 진짜냐"가 반복됐다(이예지대리 QA).
// 이제 모든 열람 경로가 이 라우트 하나(=발송·다운로드와 같은 엔진)를 쓴다.
//
// 권한: /api/uploads 게이트와 동일 규칙 — 세션 또는 업로드 티켓(?t=). 템플릿은 관리자만.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const src = url.searchParams.get("src") || "";
  const ticket = url.searchParams.get("t");

  // /api/uploads/<군>/<파일명> 형태만 허용 (경로 이탈·외부 URL 차단)
  const m = /^\/api\/uploads\/([^/?#]+)\/([^/?#]+)$/.exec(src.split("?")[0]);
  if (!m) return NextResponse.json({ error: "잘못된 문서 경로입니다." }, { status: 400 });
  const group = decodeURIComponent(m[1]);
  const filename = decodeURIComponent(m[2]);
  if (group.includes("..") || filename.includes("..") || filename.includes("/") || filename.includes("\\"))
    return NextResponse.json({ error: "잘못된 문서 경로입니다." }, { status: 400 });
  if (group === "private") return NextResponse.json({ error: "접근할 수 없습니다." }, { status: 403 });

  // 템플릿 원본은 관리자만 (uploads 라우트와 동일)
  if (group === "templates") {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
  } else {
    // 세션 또는 티켓 (게스트 서명·앱 WebView 는 티켓을 URL 에 싣는다)
    const { verifyUploadTicket } = await import("@/lib/upload-ticket");
    if (!verifyUploadTicket(ticket)) {
      const session = await getSession();
      if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
  }

  const filePath = path.join(process.cwd(), "uploads", group, filename);
  let buf: Buffer;
  let stat: { mtimeMs: number; size: number };
  try {
    const s = await fs.stat(filePath);
    stat = { mtimeMs: s.mtimeMs, size: s.size };
    buf = await fs.readFile(filePath);
  } catch {
    return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
  }

  const title = url.searchParams.get("title") || filename.replace(/\.[^.]+$/, "");
  const dispo = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  const headers = (type: string, ext: string) => ({
    "Content-Type": type,
    "Content-Disposition": `${dispo}; filename*=UTF-8''${encodeURIComponent(title + ext)}`,
    // 문서는 서명·재생성으로 바뀔 수 있어 캐시 금지 (구버전 표시 방지)
    "Cache-Control": "no-store",
  });

  // 이미 PDF 면 그대로
  if (/\.pdf$/i.test(filename)) return new NextResponse(new Uint8Array(buf), { headers: headers("application/pdf", ".pdf") });
  if (!/\.docx?$/i.test(filename))
    return NextResponse.json({ error: "미리보기를 지원하지 않는 형식입니다." }, { status: 400 });

  // 변환 결과 디스크 캐시 (#179, 2026-08-31 이예지대리 — 서명 화면 미리보기가 매번 1.5~1.8초)
  //
  // LibreOffice 변환은 열 때마다 새로 돌고 있었다. 서명 모달은 열 때 한 번, 확대하면 또 한 번,
  // 패키지 문서를 연속으로 서명하면 문서 수만큼 반복된다.
  // 캐시 키에 파일의 mtime·크기를 넣으므로, 문서가 재생성되거나 템플릿이 교체되면 자동으로 새 키가 된다
  // (계약 문서는 재생성할 때마다 파일명 자체가 새로 생기므로 구버전이 나올 여지가 없다).
  const cacheKey = createHash("sha1")
    .update(`${group}/${filename}|${stat.mtimeMs}|${stat.size}`)
    .digest("hex");
  // 캐시는 uploads/private 아래에 둔다 — /api/uploads 라우트가 private 을 403 으로 막으므로
  // 캐시 파일이 URL 로 직접 노출되지 않는다. 볼륨 안이라 재배포해도 유지된다.
  const cacheDir = path.join(process.cwd(), "uploads", "private", "pdfcache");
  const cachePath = path.join(cacheDir, `${cacheKey}.pdf`);
  try {
    const hit = await fs.readFile(cachePath);
    // 오래된 캐시가 먼저 지워지지 않게 사용 시각 갱신 (정리는 최근 사용 기준)
    fs.utimes(cachePath, new Date(), new Date()).catch(() => {});
    return new NextResponse(new Uint8Array(hit), { headers: headers("application/pdf", ".pdf") });
  } catch {
    // 캐시 없음 — 변환 진행
  }

  try {
    const fd = new FormData();
    fd.append("files", new Blob([new Uint8Array(buf)]), "document.docx");
    const gres = await fetch(
      `${process.env.GOTENBERG_URL || "http://gotenberg:3000"}/forms/libreoffice/convert`,
      { method: "POST", body: fd }
    );
    if (!gres.ok) {
      console.error("문서 PDF 변환 실패(gotenberg):", gres.status);
      return NextResponse.json({ error: "문서를 여는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });
    }
    const pdf = Buffer.from(await gres.arrayBuffer());
    // 캐시 저장은 응답을 막지 않는다 (실패해도 기능에는 영향 없음)
    void writeCache(cacheDir, cachePath, pdf);
    return new NextResponse(new Uint8Array(pdf), { headers: headers("application/pdf", ".pdf") });
  } catch (e) {
    console.error("문서 PDF 변환 오류:", e);
    return NextResponse.json({ error: "문서를 여는 중 오류가 발생했습니다." }, { status: 500 });
  }
}
