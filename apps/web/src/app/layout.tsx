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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
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
