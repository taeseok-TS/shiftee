import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import WorkDesktopNotifier from "@/components/WorkDesktopNotifier";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "큐브티",
  description: "큐브티 HR 관리 시스템",
  // 크롬 자동 번역 차단 — 번역기가 텍스트 노드를 <font> 로 바꿔치기해 React 가 목록을 다시 그릴 때
  // "removeChild … not a child" 로 화면이 통째로 죽는다(2026-09-14 디렉터 크롬에서 재현). 한국어 사내 시스템이라 번역이 필요 없다.
  other: { google: "notranslate" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      translate="no"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* 큐브티워크 새 메시지 데스크톱 알림 — 채팅 화면이 아니어도 전역으로 동작 */}
        <WorkDesktopNotifier />
        {children}
      </body>
    </html>
  );
}
