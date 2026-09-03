import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 2026-09-03: 타입 오류 42건을 전부 정리하고 무시 설정을 껐다.
  // 그 42건 안에는 실제 결함이 섞여 있었다 — 시드가 잘못된 유니크 키를 써서 그대로 돌리면
  // 실패했고, 드롭다운은 asChild(Radix 문법)를 써서 버튼 안에 버튼이 들어가고 있었다.
  // 무시해 두면 이런 것이 계속 쌓인다. 다시 켜지 말 것 — 오류가 나면 그 오류를 고칠 것.
  typescript: {
    ignoreBuildErrors: false,
  },
  // 요청 본문 크기 제한 상향(기본 10MB) — 큐브티워크 채팅 첨부 업로드(최대 20MB)용.
  experimental: {
    proxyClientMaxBodySize: "110mb",
  } as NextConfig["experimental"],
};

export default nextConfig;
