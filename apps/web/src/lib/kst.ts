// 서버 컨테이너 TZ가 UTC이므로 한국시간(KST) 시/분은 +9시간 후 getUTC*로 계산해야 한다.
// (now.getHours()를 그대로 쓰면 UTC 기준이라 지각/조퇴 판정이 9시간 어긋남)

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstHour(d: Date): number {
  return new Date(d.getTime() + KST_OFFSET_MS).getUTCHours();
}

export function kstMinute(d: Date): number {
  return new Date(d.getTime() + KST_OFFSET_MS).getUTCMinutes();
}

/**
 * "오늘"(KST 기준)의 날짜를 @db.Date 컬럼용 UTC 자정 Date 로.
 *
 * 주의: `new Date(Date.UTC(now.getFullYear(), ...))` 로 쓰면 안 된다.
 * 컨테이너 TZ 가 UTC 라 local getter = UTC getter 가 되어 하루 경계가 09:00 KST 가 되고,
 * 08시 출근이 전날 날짜로 저장돼 저녁에 퇴근을 못 찍는다(실제 발생).
 */
export function kstTodayDateUTC(now: Date = new Date()): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
}

/** 임의 시각(KST 기준)의 날짜를 @db.Date 컬럼용 UTC 자정 Date 로 */
export function kstDateUTC(d: Date): Date {
  return kstTodayDateUTC(d);
}
