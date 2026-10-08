// 금액의 한글 표기 (예: 34000000 → "삼천사백만원") — 근로계약서 金 표기용. 순수 함수라 화면(client)에서도 쓴다(2026-10-08 #213-5)
export function koreanMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  const digits = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const smallUnits = ["", "십", "백", "천"];
  const bigUnits = ["", "만", "억", "조"];
  let result = "";
  let group = 0;
  let v = Math.floor(n);
  while (v > 0) {
    const part = v % 10000;
    if (part) {
      let s = "";
      let p = part, i = 0;
      while (p > 0) {
        const d = p % 10;
        if (d) s = (d === 1 && i > 0 ? "" : digits[d]) + smallUnits[i] + s;
        p = Math.floor(p / 10); i++;
      }
      result = s + bigUnits[group] + result;
    }
    v = Math.floor(v / 10000); group++;
  }
  return result + "원";
}
