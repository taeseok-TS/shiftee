/**
 * 세션이 끊겼음을 화면에 알리는 통로.
 *
 * 서버에서 세션을 무효화하면(퇴사.기기초기화.비밀번호 변경 등) 앱은 401 을 받는데,
 * 종전에는 console.warn 만 찍고 화면마다 오류만 떴다 — 사용자는 뭐가 잘못됐는지
 * 모른 채 앱을 껐다 켜야 로그인 화면으로 갔다. 이제 **즉시** 로그인 화면으로 보낸다
 * (2026-09-08 디렉터 지시).
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onSessionExpired(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitSessionExpired(): void {
  for (const cb of listeners) {
    try { cb(); } catch { /* 한 화면의 오류가 나머지를 막지 않게 */ }
  }
}
