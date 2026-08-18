/**
 * 퇴사 판정 — 목록·현황·로그인이 같은 기준을 쓰도록 한 곳에 둔다.
 *
 * 날짜 필드는 UTC 자정으로 저장되므로 기준도 KST 오늘의 자정으로 맞춘다.
 * 퇴사일 '당일'은 아직 재직이다(마지막 근무일에 출퇴근을 찍어야 한다).
 */
export function kstTodayMidnight(): Date {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
}

export function isResigned(resignDate: Date | null | undefined): boolean {
  if (!resignDate) return false;
  return resignDate < kstTodayMidnight();
}
