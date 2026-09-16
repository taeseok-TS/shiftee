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

// 변환기 세대 — gotenberg/LibreOffice 를 올리거나 **한글 글꼴을 바꾸면 같은 문서도 다르게 그려진다.**
// 그때 이 값을 올리면(또는 PDF_CACHE_EPOCH 환경변수를 주면) 전체 키가 바뀌어 옛 렌더가 사라진다.
// 이게 없으면 글꼴을 고쳐도 최대 14일간 예전 모습이 서명 화면에 계속 나온다(2026-09-16 검증관 F2).
const CACHE_EPOCH = process.env.PDF_CACHE_EPOCH || "1";

const pdfCacheDir = () => path.join(process.cwd(), "uploads", "private", "pdfcache");
const SWEEP_MARK = ".sweep";

/**
 * 원본 파일 기준 키 — 파일이 바뀌면(재생성.교체) mtime.크기가 달라져 자동으로 새 키가 된다.
 * ⚠ 문서 뷰어(/api/docs/pdf)와 **같은 문자열**을 써서 캐시를 공유한다. 형식을 바꾸면
 *   두 경로가 서로의 캐시를 못 쓰게 되니(성능만 손해, 오작동은 아님) 굳이 바꾸지 말 것.
 */
export const fileCacheKey = (group: string, filename: string, mtimeMs: number, size: number) =>
  createHash("sha1").update(`${group}/${filename}|${mtimeMs}|${size}|e${CACHE_EPOCH}`).digest("hex");

/**
 * 내용 기준 키 — 서명을 얹거나 템플릿을 다시 그려 **메모리에서 만든 문서**용.
 * 바이트가 같으면 변환 결과도 같으므로 옛 문서가 나올 여지가 없다(진본성 사고 방지).
 */
export const bufferCacheKey = (buf: Buffer, extra = "") =>
  createHash("sha1").update(buf).update(`|${buf.length}|${extra}|e${CACHE_EPOCH}`).digest("hex");

/** 여러 PDF 를 합친 결과용 키 — 조각들의 내용과 순서, 제목까지 반영한다. */
export const mergeCacheKey = (parts: Buffer[], extra = "") => {
  const h = createHash("sha1");
  for (const b of parts) h.update(createHash("sha1").update(b).digest());
  return h.update(`|merge|${extra}|e${CACHE_EPOCH}`).digest("hex");
};

/** 캐시된 PDF 를 읽는다. 없으면 null. 읽을 때마다 사용 시각을 갱신해 최근 쓴 것이 오래 남는다. */
export async function readCachedPdf(key: string): Promise<Buffer | null> {
  const p = path.join(pdfCacheDir(), `${key}.pdf`);
  try {
    const buf = await fs.readFile(p);
    // 쓰다 만.잘린 파일 방어 — 갑자기 껐다 켜면 이름만 바뀌고 내용이 모자란 파일이 남을 수 있다.
    // PDF 는 %PDF 로 시작해 %%EOF 로 끝난다. 아니면 캐시가 없는 셈 치고 다시 변환한다.
    if (buf.length < 32 || buf.subarray(0, 4).toString("latin1") !== "%PDF") return null;
    if (!buf.subarray(-1024).toString("latin1").includes("%%EOF")) return null;
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
  // 하루에 한 번만 청소 — 요청 처리를 막지 않는다.
  // ⚠ 프로세스 안 변수만으로는 워커 수.재시작 횟수만큼 돈다(검증관 F5). 표식 파일의 시각을
  //   함께 보므로 워커가 여럿이어도 하루 한 번으로 수렴한다.
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  if (now - lastSweep < DAY) return;
  lastSweep = now;
  const mark = path.join(dir, SWEEP_MARK);
  try {
    const ms = await fs.stat(mark).catch(() => null);
    if (ms && now - ms.mtimeMs < DAY) return;
    await fs.writeFile(mark, String(now)); // 먼저 찍어 다른 워커가 겹쳐 돌지 않게 한다
    const cutoff = now - CACHE_TTL_DAYS * DAY;
    const tmpCutoff = now - 60 * 60 * 1000; // 쓰다 만 .tmp 는 한 시간이면 버린다
    for (const name of await fs.readdir(dir)) {
      if (name === SWEEP_MARK) continue;
      const p = path.join(dir, name);
      const s = await fs.stat(p).catch(() => null);
      if (!s) continue;
      if (s.mtimeMs < (name.endsWith(".tmp") ? tmpCutoff : cutoff)) await fs.unlink(p).catch(() => {});
    }
  } catch (e) {
    console.error("PDF 캐시 정리 실패(무시):", e);
  }
}
