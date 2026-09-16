import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";

// 변환 PDF 디스크 캐시 (#179).
//
// LibreOffice(gotenberg) 변환은 한 번에 0.5~1.5초가 걸리는데, 같은 문서를 목록.서명 모달.확대.
// 다운로드에서 반복해서 연다. 처음 도입한 곳은 문서 뷰어(/api/docs/pdf) 한 곳이었고,
// 2026-09-16 디렉터 지시로 **계약 원본 보기와 묶음 미리보기**까지 같은 저장소를 쓰게 넓혔다.
//
// 캐시는 uploads/private 아래에 둔다 — /api/uploads 라우트가 private 을 403 으로 막으므로
// 캐시 파일이 URL 로 직접 노출되지 않는다. 볼륨 안이라 재배포해도 유지된다.
const CACHE_TTL_DAYS = 14;
let lastSweep = 0;

export const pdfCacheDir = () => path.join(process.cwd(), "uploads", "private", "pdfcache");

/**
 * 원본 파일 기준 키 — 파일이 바뀌면(재생성.교체) mtime.크기가 달라져 자동으로 새 키가 된다.
 * ⚠ 문서 뷰어(/api/docs/pdf)와 **같은 문자열**을 써서 캐시를 공유한다. 형식을 바꾸면
 *   두 경로가 서로의 캐시를 못 쓰게 되니(성능만 손해, 오작동은 아님) 굳이 바꾸지 말 것.
 */
export const fileCacheKey = (group: string, filename: string, mtimeMs: number, size: number) =>
  createHash("sha1").update(`${group}/${filename}|${mtimeMs}|${size}`).digest("hex");

/**
 * 내용 기준 키 — 서명을 얹거나 템플릿을 다시 그려 **메모리에서 만든 문서**용.
 * 바이트가 같으면 변환 결과도 같으므로 옛 문서가 나올 여지가 없다(진본성 사고 방지).
 */
export const bufferCacheKey = (buf: Buffer, extra = "") =>
  createHash("sha1").update(buf).update(`|${extra}`).digest("hex");

/** 여러 PDF 를 합친 결과용 키 — 조각들의 내용과 순서, 제목까지 반영한다. */
export const mergeCacheKey = (parts: Buffer[], extra = "") => {
  const h = createHash("sha1");
  for (const b of parts) h.update(createHash("sha1").update(b).digest());
  return h.update(`|merge|${extra}`).digest("hex");
};

/** 캐시된 PDF 를 읽는다. 없으면 null. 읽을 때마다 사용 시각을 갱신해 최근 쓴 것이 오래 남는다. */
export async function readCachedPdf(key: string): Promise<Buffer | null> {
  const p = path.join(pdfCacheDir(), `${key}.pdf`);
  try {
    const buf = await fs.readFile(p);
    if (buf.length === 0) return null; // 쓰다 만 파일 방어
    fs.utimes(p, new Date(), new Date()).catch(() => {});
    return buf;
  } catch {
    return null;
  }
}

/**
 * 캐시에 저장한다. 실패해도 기능에는 영향이 없으므로 삼킨다.
 * 호출부는 `void writeCachedPdf(...)` 로 응답을 막지 않는다.
 */
export async function writeCachedPdf(key: string, pdf: Buffer): Promise<void> {
  const dir = pdfCacheDir();
  const file = path.join(dir, `${key}.pdf`);
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
