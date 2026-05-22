"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Clock,
  Calendar,
  UmbrellaOff,
  FileSignature,
  Users,
  Building2,
  LogOut,
} from "lucide-react";

const navItems = [
  { href: "/dashboard",  label: "대시보드",   icon: LayoutDashboard },
  { href: "/attendance", label: "출퇴근 관리", icon: Clock },
  { href: "/schedule",   label: "근무일정",   icon: Calendar },
  { href: "/leave",      label: "휴가 관리",  icon: UmbrellaOff },
  { href: "/contracts",  label: "전자계약",   icon: FileSignature },
  { href: "/employees",  label: "직원 관리",  icon: Users },
  { href: "/branches",   label: "지점 관리",  icon: Building2 },
];

export function Sidebar() {
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
          <div className="w-9 h-9 bg-blue-500 rounded-lg flex items-center justify-center shrink-0">
            <span className="font-bold text-white text-lg">S</span>
          </div>
          <div>
            <p className="font-bold text-white text-lg leading-tight">시프티</p>
            <p className="text-slate-400 text-xs">HR 관리 시스템</p>
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

      {/* 로그아웃 */}
      <div className="px-3 py-4 border-t border-slate-700">
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
