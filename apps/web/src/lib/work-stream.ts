"use client";
import { isSessionExpired } from "./session-expiry";

/**
 * /api/work/stream 구독 (2026-09-04 검증관 B 지적).
 *
 * EventSource 는 401 을 받으면 스스로 CLOSED 가 되고 **다시 붙지 않는다.**
 * 종전에는 세 곳 모두 onerror 가 없어서, 세션이 끊기거나 배포로 서버가 잠깐 내려가면
 * 새 메시지.읽음.타이핑이 조용히 멈춘 채 화면은 마지막 상태 그대로였다
 * (사용자는 "채팅이 안 온다"고만 느낀다). 재로그인해도 새로고침 전까지 죽어 있었다.
 *
 * 여기서 끊김을 받아 (a) 세션 만료면 안내하고 멈추고, (b) 아니면 백오프로 다시 붙는다.
 * EventSource 는 상태코드를 안 주므로 만료 판별은 가벼운 요청 한 번으로 대신한다.
 */
export function openWorkStream(onMessage: (ev: MessageEvent) => void): () => void {
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = 3000;
  let stopped = false;

  const schedule = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => { timer = null; connect(); }, delay);
    delay = Math.min(delay * 2, 60000); // 서버가 오래 죽어 있어도 폭주하지 않게
  };

  const connect = () => {
    if (stopped) return;
    const cur = new EventSource("/api/work/stream");
    es = cur;
    cur.onopen = () => { delay = 3000; };
    cur.onmessage = onMessage;
    cur.onerror = () => {
      // CONNECTING(0) 이면 브라우저가 알아서 재시도 중이다 — 건드리면 중복 연결이 된다.
      if (cur.readyState !== EventSource.CLOSED) return;
      cur.close();
      if (es === cur) es = null;
      if (stopped) return;
      fetch("/api/work/unread", { cache: "no-store" })
        .then((r) => { if (!isSessionExpired(r)) schedule(); else stopped = true; })
        .catch(() => schedule()); // 네트워크 단절 — 만료로 단정하지 않는다
    };
  };

  connect();
  return () => { stopped = true; if (timer) clearTimeout(timer); timer = null; es?.close(); es = null; };
}
