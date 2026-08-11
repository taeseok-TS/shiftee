"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { WorkUnreadBadge } from "./WorkUnreadBadge";
import {
  LayoutDashboard,
  Clock,
  Calendar,
  UmbrellaOff,
  FileSignature,
  Lightbulb,
  User,
  Settings,
  LogOut,
} from "lucide-react";

const sharedNavItems = [
  { href: "/dashboard", label: "내 대시보드", icon: LayoutDashboard },
  // 출퇴근(기록 조회)은 관리자·원장만 웹에서 노출. 직원은 앱으로만 출퇴근.
  { href: "/attendance", label: "출퇴근 관리", icon: Clock, adminOnly: true },
  { href: "/schedule", label: "근무일정", icon: Calendar },
  { href: "/leave", label: "휴가 관리", icon: UmbrellaOff },
  { href: "/contracts", label: "내 계약서", icon: FileSignature },
  { href: "/suggestions", label: "개선 제안", icon: Lightbulb },
];

export function SharedSidebar({ role }: { role?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const navItems = sharedNavItems.filter(
    (it) => !it.adminOnly || role === "ADMIN" || role === "MANAGER"
  );

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-64 h-screen sticky top-0 overflow-y-auto bg-slate-900 text-white flex flex-col shrink-0">
      {/* 로고 */}
      <div className="px-6 py-5 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-500 rounded-lg flex items-center justify-center shrink-0">
            <span className="font-bold text-white text-lg">E</span>
          </div>
          <div>
            <p className="font-bold text-white text-lg leading-tight">큐브티</p>
            <p className="text-slate-400 text-xs">직원 시스템</p>
          </div>
        </div>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-blue-600 text-white"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            )}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}
      </nav>

      {/* 환경설정 및 로그아웃 */}
      <div className="px-3 py-4 border-t border-slate-700 space-y-1">
        <Link
          href="/profile"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            pathname === "/profile" || pathname.startsWith("/profile/")
              ? "bg-blue-600 text-white"
              : "text-slate-300 hover:bg-slate-800 hover:text-white"
          )}
        >
          <User size={18} />
          프로필
        </Link>
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            pathname === "/settings" || pathname.startsWith("/settings/")
              ? "bg-blue-600 text-white"
              : "text-slate-300 hover:bg-slate-800 hover:text-white"
          )}
        >
          <Settings size={18} />
          환경설정
        </Link>
        <button
          onClick={() => (window.location.href = "/work")}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors w-full"
        >
          💬 큐브티워크
          <WorkUnreadBadge />
        </button>
        {/* 역할별 모드 전환 — ADMIN은 관리자, MANAGER(원장)는 원장 모드로. 일반 직원은 버튼 없음 */}
        {role === "ADMIN" && (
          <button
            onClick={() => (window.location.href = "/admin/dashboard")}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors w-full"
          >
            🔐 관리자 모드로 전환
          </button>
        )}
        {role === "MANAGER" && (
          <button
            onClick={() => (window.location.href = "/manager/dashboard")}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors w-full"
          >
            🧑‍💼 원장 모드로 전환
          </button>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors w-full"
        >
          <LogOut size={18} />
          로그아웃
        </button>
      </div>
    </aside>
  );
}
