// 채팅 첨부 파일의 디스크 경로 — 업로드 폴더 밖으로 나가지 못하게 봉한다 (2026-09-02)
//
// 종전 구현은 `/api/uploads/` 접두사만 확인하고 세그먼트마다 decodeURIComponent 를 돌려
// 경로를 이었다. 그래서 첨부 주소에 `%2e%2e`(..)를 넣으면 uploads 밖의 임의 파일(.env,
// 회사 직인 uploads/private/*)까지 읽혔다. 첨부 주소는 메시지 저장 때 클라이언트가 준
// 문자열을 그대로 쓰기 때문에 값 자체를 신뢰할 수 없다.
//
// 채팅 첨부는 work 군(業)만 허용한다 — 계약서·서명·직인은 각자의 권한 판정을 거쳐야 하고,
// 이 경로로 새어 나가면 그 판정이 통째로 우회된다.
import path from "path";

const ALLOWED_GROUPS = new Set(["work"]);

export function workFileDiskPath(fileUrl: string): string | null {
  if (typeof fileUrl !== "string" || !fileUrl.startsWith("/api/uploads/")) return null;
  const rel = fileUrl.slice("/api/uploads/".length).split("?")[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null; // 잘못된 인코딩
  }
  const parts = decoded.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  if (!ALLOWED_GROUPS.has(parts[0])) return null;
  if (parts.some((p) => p === "." || p === ".." || p.includes("\\"))) return null;

  const baseDir = path.join(process.cwd(), "uploads");
  const full = path.resolve(baseDir, ...parts);
  // 최종 경로가 uploads 안인지 다시 확인 (심볼릭 링크·잔여 조작 대비)
  const rootWithSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  if (!full.startsWith(rootWithSep)) return null;
  return full;
}
