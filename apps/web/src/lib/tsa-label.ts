// 시각 도장 발급처 표시 이름 — 검증 페이지·관리자 감사 기록 창이 같이 쓴다(서버 전용 lib/tsa.ts 를 끌어오지 않게 분리)
export function tsaName(url?: string | null): string {
  if (!url) return "";
  if (/digicert/i.test(url)) return "DigiCert";
  if (/sectigo/i.test(url)) return "Sectigo";
  try { return new URL(url).hostname; } catch { return url; }
}
