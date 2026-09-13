// IP 가리기 — 앞 두 마디만(112.170.*.*). 증명서(signed-freeze)와 API 키 마지막 사용 표시가 함께 쓴다.
// signed-freeze 에 있던 것을 옮겼다(2026-09-13) — 그 모듈은 pdf-lib 를 끌어와 가벼운 라우트에 실기엔 무겁다.
// 9/12 디렉터 확정 (나). IPv6 는 앞 두 묶음만, 알 수 없는 형식은 통째로 가린다.
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return "-";
  const t = ip.trim();
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/i.exec(t);
  if (v4) return `${v4[1]}.${v4[2]}.*.*`;
  // 순수 IPv6(16진수·콜론만)만 앞부분을 보인다 — 포트·괄호·점·%가 섞인 형식(1.2.3.4:5678 등)은 통째로 가린다.
  // 앞부분은 "::" 앞에서만 센다(2001::abcd 가 2001:abcd 로 적히지 않게). 33456f8 검증 F1·F2
  // 올바른 IPv6 모양(:: 축약이 있거나 8묶음)만 — "a:b" 같은 두 묶음짜리가 통째로 적히지 않게(359ea9c 검증 P1)
  if (t.includes(":") && /^[0-9a-f:]+$/i.test(t) && (t.includes("::") || t.split(":").length === 8)) {
    const head = t.split("::")[0].split(":").filter(Boolean);
    return head.length >= 2 ? `${head[0]}:${head[1]}:*` : head.length === 1 ? `${head[0]}:*` : "*";
  }
  return "*";
}
