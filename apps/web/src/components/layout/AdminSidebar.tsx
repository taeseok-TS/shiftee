"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Building2,
  BarChart3,
  FileText,
  Settings,
  LogOut,
  Zap,
  FileSignature,
  UmbrellaOff,
  Clock,
  Calendar,
  CheckCircle,
} from "lucide-react";

const adminNavItems = [
  { href: "/admin/dashboard", label: "대시보드", icon: LayoutDashboard },
  { href: "/admin/employees", label: "직원 관리", icon: Users },
  { href: "/admin/branches", label: "지점 관리", icon: Building2 },
  { href: "/admin/contracts", label: "전자계약", icon: FileSignature },
  { href: "/admin/contract-approvals", label: "계약 결재", icon: CheckCircle },
  { href: "/admin/leave", label: "휴가 관리", icon: UmbrellaOff },
  { href: "/admin/leave-approvals", label: "결재 (휴가, 근무일정)", icon: CheckCircle },
  { href: "/admin/attendance", label: "출퇴근", icon: Clock },
  { href: "/admin/schedule", label: "근무일정", icon: Calendar },
  { href: "/admin/employee-stats", label: "직원 현황", icon: BarChart3 },
  { href: "/admin/contract-templates", label: "계약 템플릿", icon: FileText },
  { href: "/admin/test-api", label: "🔧 API 테스트", icon: Zap },
];

export function AdminSidebar() {
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
          <div className="w-9 h-9 bg-red-600 rounded-lg flex items-center justify-center shrink-0">
            <span className="font-bold text-white text-lg">A</span>
          </div>
          <div>
            <p className="font-bold text-white text-lg leading-tight">시프티</p>
            <p className="text-slate-400 text-xs">관리자 시스템</p>
          </div>
        </div>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {adminNavItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-red-600 text-white"
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
          href="/admin/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            pathname === "/admin/settings" || pathname.startsWith("/admin/settings/")
              ? "bg-red-600 text-white"
              : "text-slate-300 hover:bg-slate-800 hover:text-white"
          )}
        >
          <Settings size={18} />
          환경설정
        </Link>
        <button
          onClick={() => window.location.href = "/manager/dashboard"}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors w-full"
        >
          🧑‍💼 원장 모드로 전환
        </button>
        <button
          onClick={() => window.location.href = "/dashboard"}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors w-full"
        >
          👤 직원 모드로 전환
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
