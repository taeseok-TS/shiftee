// @이름 정확 매칭. "@name" 뒤에 이름 구성문자(한글/영숫자/_)가 이어지면 매칭 안 됨
// → "@김태석"은 이름 "김"에 매칭되지 않는다(부분일치 오작동 방지).
// "@전체"/"@all"은 방 전체 멘션 — 구성원 누구에게나 멘션으로 간주(푸시·멘션모아보기·배지 공통)
const ALL_RE = /@(전체|all)(?![가-힣A-Za-z0-9_])/i;
export function isMentioned(content: string, name: string): boolean {
  if (!content) return false;
  if (ALL_RE.test(content)) return true;
  if (!name) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${esc}(?![가-힣A-Za-z0-9_])`).test(content);
}
