// 직영(큐브티 본사) 주소 판별 — 규칙은 여기 하나다. 서버(headers 의 host)와 화면(window.location) 양쪽에서 쓴다.
// 판매용 고객사 인스턴스도 같은 화면을 쓰므로, 직영 전용 안내(직영 포털 링크·EMS 계정 안내)는 이 판별을 거친다.
// ⚠ 하위 주소 전체(*.cubetee.co.kr)로 보면 안 된다 — 고객사 기본 주소가 "회사명.cubetee.co.kr" 이다.
//   포트(:443 등)는 붙어 올 수 있어 허용하고, 대문자 호스트도 같은 주소로 본다.
export function isDirectHost(host: string | null | undefined): boolean {
  return /^(www\.)?cubetee\.co\.kr(:\d+)?$/i.test((host || "").trim());
}
