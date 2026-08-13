// 서버 컨테이너 TZ가 UTC이므로 한국시간(KST) 시/분은 +9시간 후 getUTC*로 계산해야 한다.
// (now.getHours()를 그대로 쓰면 UTC 기준이라 지각/조퇴 판정이 9시간 어긋남)

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstHour(d: Date): number {
  return new Date(d.getTime() + KST_OFFSET_MS).getUTCHours();
}

export function kstMinute(d: Date): number {
  return new Date(d.getTime() + KST_OFFSET_MS).getUTCMinutes();
}
