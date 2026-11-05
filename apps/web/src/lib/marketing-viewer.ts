// 마케팅 자료 「전체 보기 · 발행 처리」 지정 계정 (2026-11-05 디렉터 「현영님도 볼 수 있게 — 큐브마케팅에서 실제로 블로그 쓰는 사람」)
//
// 관리자가 아닌 직원 계정(예: 본부 노현영 주임)에게 **마케팅 자료만** 다음을 더 연다:
//   · 전 지점이 올린 마케팅 자료 목록 · 사진 · 파일 보기(api/work/submissions scope=all&group=MARKETING, 파일 서빙)
//   · 「블로그 발행 완료」로 표시 · 되돌리기(api/work/submissions/[id]/published) — 큐브마케팅 연동 키 말고 따로 블로그를 쓴 경우
// 다른 자료제출(MARKETING 이 아닌 것) · 지우기 · 관리자 화면은 열지 않는다.
// 스키마는 바꾸지 않는다. AppSetting `marketingViewers`(JSON 배열 — 계정 id). lib/contract-viewer 와 같은 관례.
import { prisma } from "@/lib/db";

export const MARKETING_VIEWERS_KEY = "marketingViewers";
const TTL_MS = 60_000;
let cache: { at: number; ids: string[] } | null = null;

export async function marketingViewerIds(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ids;
  let ids: string[] = [];
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: MARKETING_VIEWERS_KEY } });
    const v = row?.value?.trim();
    if (v) {
      let parsed: unknown;
      try { parsed = JSON.parse(v); } catch { parsed = v.split(","); }
      ids = (Array.isArray(parsed) ? parsed : [parsed]).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
    }
  } catch (e) {
    console.error("[marketing-viewer] 설정 읽기 실패:", e instanceof Error ? e.message : e);
    return cache?.ids ?? [];
  }
  cache = { at: Date.now(), ids };
  return ids;
}

/** 마케팅 자료 전체 보기 · 발행 처리를 할 수 있나 — 관리자는 늘, 그 밖에는 지정한 계정만 */
export async function canManageMarketing(viewer: { userId: string; role: string } | null | undefined): Promise<boolean> {
  if (!viewer) return false;
  if (viewer.role === "ADMIN") return true;
  return (await marketingViewerIds()).includes(viewer.userId);
}
