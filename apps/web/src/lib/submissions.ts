// 큐브티워크 자료제출 — 공통 상수·판별 (2026-09-13 1단계)
//
// 서버·클라이언트가 함께 쓰는 순수 모듈. Prisma·fs·path 를 여기서 import 하지 않는다(클라이언트 번들).

/** 공유 대상·요청 대상으로 쓰는 직군 — 직원 관리 드롭다운(JOBGROUP_DEFAULT)과 같은 목록.
 *  본부 인원(ADMIN)은 언제나 전부 보므로 대상에 넣지 않는다. */
export const JOB_GROUPS = ["원장", "CM", "TM", "코디", "학습실장", "튜터"] as const;
export type JobGroup = (typeof JOB_GROUPS)[number];
/** shareJobGroups 에 이 값이 있으면 전 직원 공유 */
export const SHARE_ALL = "*";

export const CATEGORY_GROUPS = ["EDU", "PROMO", "EVENT"] as const;
export const CATEGORY_GROUP_LABEL: Record<(typeof CATEGORY_GROUPS)[number], string> = {
  EDU: "교육", PROMO: "본부 프로모션", EVENT: "본부 이벤트",
};

export const SUBMISSION_STATUSES = ["SUBMITTED", "CHECKED"] as const;

/** 파일당 50MB · 제출당 10개 (디렉터 승인 ④). 프록시 본문 상한 110MB 안쪽. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES = 10;

/** 허용 확장자 — 워드·엑셀·PPT·PDF·한글·이미지·ZIP. 실행 파일·스크립트는 목록에 없으므로 거부된다. */
export const ALLOWED_EXT = new Set([
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf",
  ".hwp", ".hwpx",
  ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".zip",
]);

/** /api/docs/pdf 로 미리보기가 되는 확장자 (LibreOffice 변환). 한글은 변환기가 없어 내려받기만. */
export const PREVIEW_EXT = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf"]);
export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export type SubmissionFile = { url: string; name: string; size: number; type: string };

export function extOf(name: string): string {
  const m = /\.[^./\\]+$/.exec(name || "");
  return m ? m[0].toLowerCase() : "";
}

export function fileTypeOf(ext: string): string {
  if (IMAGE_EXT.has(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  if (ext === ".doc" || ext === ".docx") return "word";
  if (ext === ".xls" || ext === ".xlsx") return "excel";
  if (ext === ".ppt" || ext === ".pptx") return "ppt";
  if (ext === ".hwp" || ext === ".hwpx") return "hwp";
  if (ext === ".zip") return "zip";
  return "file";
}

/**
 * 확장자와 파일 머리(매직 바이트)가 맞는지. 확장자만 바꿔 올린 실행 파일을 거른다.
 * - PK\x03\x04 : docx·xlsx·pptx·hwpx·zip (전부 ZIP 컨테이너)
 * - D0 CF 11 E0 : doc·xls·ppt·hwp 5.x (OLE 복합 문서)
 * - "HWP Document File" : hwp 3.x
 */
export function magicMatches(ext: string, h: Uint8Array): boolean {
  // Buffer 없이(클라이언트 번들에도 실리는 모듈) — 바이트를 ASCII 로 비교
  const ascii = (from: number, to: number) => {
    let s = "";
    for (let i = from; i < to && i < h.length; i++) s += String.fromCharCode(h[i]);
    return s;
  };
  const isPk = h.length >= 4 && h[0] === 0x50 && h[1] === 0x4b && (h[2] === 0x03 || h[2] === 0x05 || h[2] === 0x07);
  const isOle = h.length >= 4 && h[0] === 0xd0 && h[1] === 0xcf && h[2] === 0x11 && h[3] === 0xe0;
  switch (ext) {
    case ".docx": case ".xlsx": case ".pptx": case ".hwpx": case ".zip":
      return isPk;
    case ".doc": case ".xls": case ".ppt":
      return isOle;
    case ".hwp":
      return isOle || ascii(0, 17) === "HWP Document File";
    case ".pdf":
      return ascii(0, 5) === "%PDF-";
    case ".png":
      return h.length >= 8 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
    case ".jpg": case ".jpeg":
      return h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
    case ".gif":
      return ascii(0, 4) === "GIF8";
    case ".webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    default:
      return false;
  }
}

/** 제출물 첨부 URL 인가 — /api/uploads/submissions/<파일명> 한 단계만 */
export function isSubmissionFileUrl(url: unknown): url is string {
  return typeof url === "string" && /^\/api\/uploads\/submissions\/[^/?#]+$/.test(url);
}

/** 지금 연월(KST) — "2026-09". 서버는 UTC 라 +9h 뒤 UTC 게터로 읽는다. */
export function currentYearMonthKST(now: Date = new Date()): string {
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isYearMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** @db.Date(UTC 자정) → "YYYY-MM-DD". 날짜 비교는 늘 이 문자열로 한다. */
export function dateStr(d: Date | null | undefined): string | null {
  if (!d) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → @db.Date 용 UTC 자정. 달력에 없는 날짜(2월 30일)는 null. */
export function parseDateStr(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

/** 오늘(KST) "YYYY-MM-DD" */
export function todayStrKST(now: Date = new Date()): string {
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-${String(k.getUTCDate()).padStart(2, "0")}`;
}

/** 파일 목록 정규화 — 우리 저장 구역 URL 만, 최대 MAX_FILES 개. 하나라도 이상하면 null. */
export function normalizeFiles(raw: unknown): SubmissionFile[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_FILES) return null;
  const out: SubmissionFile[] = [];
  const seen = new Set<string>();
  for (const f of raw) {
    if (!f || typeof f !== "object") return null;
    const { url, name, size, type } = f as Record<string, unknown>;
    if (!isSubmissionFileUrl(url) || seen.has(url)) return null;
    if (typeof name !== "string" || !name.trim()) return null;
    const ext = extOf(name);
    if (!ALLOWED_EXT.has(ext)) return null;
    seen.add(url);
    out.push({
      url,
      name: name.trim().slice(0, 200),
      size: typeof size === "number" && size >= 0 ? Math.floor(size) : 0,
      type: typeof type === "string" && type ? type : fileTypeOf(ext),
    });
  }
  return out;
}
