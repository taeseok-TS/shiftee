// 마케팅 자료 블로그 발행 기록(2026-11-06 디렉터 — 「여러 자료를 합쳐 한 글로 발행」 · 「같은 자료로 여러 번 발행」)
//  · Submission.publishHistory = [{ url, note, at, by }] 오래된 것부터. publishedUrl · publishedAt 은 「마지막 발행」으로 그대로 둔다(옛 화면 · 연동 호환)
//  · 기록이 비어 있는데 publishedAt 이 있으면(이 칸 전에 발행된 자료) 그 한 건을 첫 기록으로 본다
//  · 같은 주소가 다시 오면 새 줄을 만들지 않고 덧붙일 말만 고친다 — 알림도 다시 보내지 않는다
//  · 큐브마케팅 연동(api/v1/marketing/materials/[id]/published)과 화면 직접 표시(api/work/submissions/[id]/published)가 이 한 곳을 쓴다
export type PublishEntry = { url: string | null; note: string | null; at: string; by: string | null };
export const PUBLISH_NOTE_MAX = 300;

type Row = { publishedAt: Date | null; publishedUrl: string | null; publishedBy: string | null; publishHistory: unknown };

/** 지금까지의 발행 기록 */
export function publishHistoryOf(s: Row): PublishEntry[] {
  const raw = Array.isArray(s.publishHistory) ? s.publishHistory : [];
  const list = raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      url: typeof x.url === "string" && x.url ? x.url : null,
      note: typeof x.note === "string" && x.note ? x.note : null,
      at: typeof x.at === "string" ? x.at : new Date(0).toISOString(),
      by: typeof x.by === "string" ? x.by : null,
    }));
  if (!list.length && s.publishedAt) return [{ url: s.publishedUrl, note: null, at: s.publishedAt.toISOString(), by: s.publishedBy }];
  return list;
}

/** 새 발행을 더한다 — isNew: 새 글(알림 대상), false 면 같은 주소라 덧붙일 말만 고쳤다 */
export function addPublish(s: Row, e: { url: string | null; note: string | null; by: string }): { history: PublishEntry[]; isNew: boolean } {
  const history = publishHistoryOf(s);
  const same = e.url ? history.findIndex((h) => h.url === e.url) : -1;
  if (same >= 0) {
    if (e.note) history[same] = { ...history[same], note: e.note };
    return { history, isNew: false };
  }
  history.push({ url: e.url, note: e.note, at: new Date().toISOString(), by: e.by });
  return { history, isNew: true };
}
