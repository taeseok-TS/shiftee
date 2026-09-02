// 업로드 경로군 게이트 — 어떤 경로군에 인증(세션 또는 티켓)을 요구할지 한 곳에서 정한다.
//
// 앱은 이 목록을 티켓과 함께 받아 **게이트가 켜진 경로에만** ?t= 를 붙인다. 그래서
//  ① 게이트 밖 파일(채팅 첨부 등)의 URL 이 고정돼 RN 이미지 캐시가 유지되고
//  ② 나중에 서버에서 경로군을 추가하면 앱을 다시 배포하지 않아도 티켓이 따라 붙는다.
//
// ⚠ work 를 넣기 전에 반드시: 앱 확산 확인 + work 경로 판정을 채널 멤버십·소유자로.
//    2026-09-02 에 앱이 티켓을 안 붙이는 상태에서 켰다가 첨부가 전부 401 이 됐다.
const DEFAULT_GROUPS = "signatures,contracts";

export function uploadGateGroups(): string[] {
  const raw = (process.env.UPLOADS_GATE ?? "").trim();
  // 빈 문자열은 오설정으로 보고 기본값 사용 — 끄려면 명시적으로 "off"
  const value = raw === "" ? DEFAULT_GROUPS : raw;
  if (value === "off") return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
