import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 2026-09-03: 타입 오류 42건을 전부 정리하고 무시 설정을 껐다.
  // 그 42건 안에는 실제 결함이 섞여 있었다 — 시드가 잘못된 유니크 키를 써서 그대로 돌리면
  // 실패했고, 드롭다운은 asChild(Radix 문법)를 써서 버튼 안에 버튼이 들어가고 있었다.
  // 무시해 두면 이런 것이 계속 쌓인다. 다시 켜지 말 것 — 오류가 나면 그 오류를 고칠 것.
  typescript: {
    ignoreBuildErrors: false,
  },
  // 이미지 최적화 API(/_next/image) 끄기 (2026-10-26 보안 점검) — Next 16.2.6 에는 이 API 에 AVIF·SVG 를 넣으면
  // 인증 없이 원격 코드 실행이 되는 결함이 있다(16.4.1 에서 고침). 직원 누구나 채팅으로 이미지를 올릴 수 있어 입구를 닫는다.
  // next/image 는 그대로 쓰되 원본을 <img> 로 보여 준다(쓰는 곳 3곳, 화질·속도 차이 거의 없음). Next 를 16.4.1 이상으로 올린 뒤 다시 켤지 판단.
  images: { unoptimized: true },
  // 요청 본문 크기 제한 상향(기본 10MB) — 큐브티워크 채팅 첨부 업로드(최대 20MB)용.
  experimental: {
    proxyClientMaxBodySize: "110mb",
  } as NextConfig["experimental"],
};

export default nextConfig;
