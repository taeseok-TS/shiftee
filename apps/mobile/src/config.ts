/**
 * ============================================
 * 큐브티(Cubetee) 모바일 — 전역 설정
 * ============================================
 *
 * API 서버 주소는 EXPO_PUBLIC_API_URL 환경변수로 주입합니다.
 * 앱 루트의 `.env` 파일에 설정하면 Expo 가 자동으로 읽습니다.
 *
 *   EXPO_PUBLIC_API_URL=http://192.168.0.10:3000/api
 *
 * ⚠️ 실기기(실제 폰)에서 PC의 개발 서버에 붙을 때 주의:
 *    `localhost` 는 폰 자신을 가리키므로 동작하지 않습니다.
 *    PC 와 폰이 같은 와이파이일 때, PC 의 LAN IP 를 사용하세요.
 *    (Windows: `ipconfig` 의 IPv4 주소)
 *
 * 🚀 온라인 배포 후에는 실제 도메인으로 교체:
 *    EXPO_PUBLIC_API_URL=https://cubetee.example.com/api
 *
 * 환경변수가 없으면 에뮬레이터/웹 기준 기본값(localhost)을 사용합니다.
 */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000/api"
).replace(/\/+$/, "");
