/**
 * 알림·메일에 넣는 서비스 주소.
 *
 * NEXT_PUBLIC_* 은 빌드 시점에 코드로 박히므로 고객사마다 이미지를 새로 빌드해야 한다.
 * 링크는 전부 서버에서만 만들기 때문에 런타임 변수(APP_URL)로 충분하다.
 *
 * 값이 없으면 조용히 localhost 로 떨어지지 않게 경고를 남긴다(프로세스당 1회).
 */
let warned = false;

export function getAppUrl(): string {
  const url = process.env.APP_URL?.trim();
  if (url) return url.replace(/\/+$/, "");

  if (!warned) {
    warned = true;
    console.error(
      "[app-url] APP_URL 이 설정되지 않았습니다 — 결재 알림·계약 메일·회의 초대 링크가 " +
        "http://localhost:3000 으로 나갑니다. compose 의 .env 에 APP_URL 을 넣으세요."
    );
  }
  return "http://localhost:3000";
}
