import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // 요청 본문 크기 제한 상향(기본 10MB) — 큐브티워크 채팅 첨부 업로드(최대 20MB)용.
  experimental: {
    proxyClientMaxBodySize: "30mb",
  } as NextConfig["experimental"],
};

export default nextConfig;
