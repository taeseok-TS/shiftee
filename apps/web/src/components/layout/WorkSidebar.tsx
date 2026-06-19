"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MessageSquare, Megaphone, CalendarDays, Video, LogOut, ArrowLeft, ChevronsLeft, ChevronsRight } from "lucide-react";

const workNavItems = [
  { href: "/work/chat", label: "채팅", icon: MessageSquare },
  { href: "/work/announcements", label: "공지", icon: Megaphone },
  { href: "/work/calendar", label: "캘린더", icon: CalendarDays },
  { href: "/work/meeting", label: "화상회의", icon: Video },
];

export function WorkSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("work_sidebar_collapsed") === "1");
  }, []);

  function toggle() {
    setCollapsed((v) => {
      const n = !v;
      localStorage.setItem("work_sidebar_collapsed", n ? "1" : "0");
      return n;
    });
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className={cn("min-h-screen bg-indigo-950 text-white flex flex-col transition-all duration-200", collapsed ? "w-16" : "w-64")}>
      <div className="px-3 py-5 border-b border-indigo-800">
        <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
          <div className="w-9 h-9 bg-indigo-500 rounded-lg flex items-center justify-center shrink-0">
            <span className="font-bold text-white text-lg">W</span>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="font-bold text-white text-lg leading-tight">큐브티워크</p>
              <p className="text-indigo-300 text-xs">협업 메신저</p>
            </div>
          )}
          {!collapsed && (
            <button onClick={toggle} title="사이드바 접기" className="ml-auto text-indigo-300 hover:text-white p-1 rounded hover:bg-indigo-900">
              <ChevronsLeft size={18} />
            </button>
          )}
        </div>
        {collapsed && (
          <button onClick={toggle} title="사이드바 펼치기" className="mt-3 w-full flex justify-center text-indigo-300 hover:text-white p-1 rounded hover:bg-indigo-900">
            <ChevronsRight size={18} />
          </button>
        )}
      </div>

      <nav className={cn("flex-1 py-4 space-y-1", collapsed ? "px-2" : "px-3")}>
        {workNavItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            title={collapsed ? label : undefined}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              collapsed && "justify-center px-0",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-indigo-500 text-white"
                : "text-indigo-200 hover:bg-indigo-900 hover:text-white"
            )}
          >
            <Icon size={18} />
            {!collapsed && label}
          </Link>
        ))}
      </nav>

      <div className={cn("py-4 border-t border-indigo-800 space-y-1", collapsed ? "px-2" : "px-3")}>
        <button
          onClick={() => (window.location.href = "/dashboard")}
          title={collapsed ? "큐브티로 돌아가기" : undefined}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-indigo-200 hover:bg-indigo-900 hover:text-white transition-colors w-full",
            collapsed && "justify-center px-0"
          )}
        >
          <ArrowLeft size={18} />
          {!collapsed && "큐브티로 돌아가기"}
        </button>
        <button
          onClick={handleLogout}
          title={collapsed ? "로그아웃" : undefined}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-indigo-200 hover:bg-indigo-900 hover:text-white transition-colors w-full",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut size={18} />
          {!collapsed && "로그아웃"}
        </button>
      </div>
    </aside>
  );
}
