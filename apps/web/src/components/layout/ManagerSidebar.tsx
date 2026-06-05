"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  UmbrellaOff,
  FileSignature,
  Calendar,
  Settings,
  LogOut,
} from "lucide-react";

const managerNavItems = [
  { href: "/manager/dashboard", label: "팀 대시보드", icon: LayoutDashboard },
  { href: "/manager/team-employees", label: "팀 직원", icon: Users },
  { href: "/manager/team-leave", label: "팀 휴가", icon: UmbrellaOff },
  { href: "/manager/team-contracts", label: "팀 계약서", icon: FileSignature },
  { href: "/manager/team-schedule", label: "팀 일정", icon: Calendar },
];

export function ManagerSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-64 min-h-screen bg-slate-900 text-white flex flex-col">
      {/* 로고 */}
      <div className="px-6 py-5 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-yellow-600 rounded-lg flex items-center justify-center shrink-0">
            <span className="font-bold text-white text-lg">M</span>
          </div>
          <div>
            <p className="font-bold text-white text-lg leading-tight">시프티</p>
            <p className="text-slate-400 text-xs">원장 관리 시스템</p>
          </div>
        </div>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {managerNavItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-yellow-600 text-white"
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
          href="/manager/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            pathname === "/manager/settings" || pathname.startsWith("/manager/settings/")
              ? "bg-yellow-600 text-white"
              : "text-slate-300 hover:bg-slate-800 hover:text-white"
          )}
        >
          <Settings size={18} />
          환경설정
        </Link>
        <button
          onClick={() => (window.location.href = "/admin/dashboard")}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors w-full"
        >
          🔐 관리자 모드로 전환
        </button>
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
