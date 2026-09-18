import type { MetadataRoute } from "next";

// PC 에 "앱처럼 설치" 할 수 있게 하는 설정 (2026-09-18 직영 주간회의 건의 — 이예지 대리, 본부장 지시).
// 매니저 공지를 큐브티로 자동 발송하는데, 매니저가 PC 에서 큐브티를 직접 켜야 해서 공지·메시지를 놓쳤다.
// 크롬·엣지에서 [앱 설치] 후 "로그인할 때 자동 시작" 을 켜면, PC 를 켤 때 큐브티워크 창이 따로 뜨고
// 새 메시지·공지 알림(웹 채팅의 데스크톱 알림)이 바로 온다. 별도 프로그램 설치는 필요 없다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    // 앱 식별값을 고정한다 — 없으면 start_url 로 정해져, 나중에 시작 화면을 바꾸면 PC 에 두 번 설치된다
    id: "/",
    name: "큐브티",
    short_name: "큐브티",
    description: "큐브티 · 큐브티워크",
    // 켜자마자 메시지부터 — 공지·채팅을 놓치지 않는 것이 목적이다
    start_url: "/work/chat",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1e1b4b", // 큐브티워크 사이드바(indigo-950)와 같은 색 — 앱 창 제목줄만 튀지 않게
    lang: "ko",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
