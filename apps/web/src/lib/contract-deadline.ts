// ─── 전자계약 서명 기한(2026-10-07 QA76 #45, 본부 답변 #35) ─────────────────────
// 발송할 때 기한을 정한다(기본 14일, 1~90일). 기한 날의 KST 23:59:59 까지 서명할 수 있고, 지나면 매일 점검이 만료(EXPIRED)
// 처리하고 본부에 알린다. 외부 서명 링크의 만료도 같은 시각으로 맞춘다. 미서명 알림은 발송 뒤 3일마다(contract-notify).
export const DEFAULT_DEADLINE_DAYS = 14;

/** 오늘(KST)부터 N일 뒤 그날 KST 23:59:59.999 (UTC Date) */
export function deadlineFromDays(days: unknown): Date {
  const n = Math.min(90, Math.max(1, Math.floor(Number(days) || DEFAULT_DEADLINE_DAYS)));
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + n, 23, 59, 59, 999) - 9 * 3600 * 1000);
}

/** "YYYY-MM-DD"(KST 날짜) → 그날 KST 23:59:59.999. 형식이 틀리거나, 오늘보다 앞이거나, 오늘부터 90일 뒤보다 늦으면 null(발송 때와 같은 상한) */
export function deadlineFromYmd(ymd: unknown): Date | null {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - 9 * 3600 * 1000);
  if (Number.isNaN(t.getTime()) || new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) !== ymd) return null;
  return t.getTime() < Date.now() || t.getTime() > deadlineFromDays(90).getTime() ? null : t;
}

/** 기한 → KST 날짜 글자 */
export const deadlineYmd = (d: Date | null | undefined) => (d ? new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) : null);
