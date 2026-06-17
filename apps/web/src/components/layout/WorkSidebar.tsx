"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MessageSquare, Megaphone, CalendarDays, Video, LogOut, ArrowLeft } from "lucide-react";

const workNavItems = [
  { href: "/work/chat", label: "채팅", icon: MessageSquare },
  { href: "/work/announcements", label: "공지", icon: Megaphone },
  { href: "/work/calendar", label: "캘린더", icon: CalendarDays },
  { href: "/work/meeting", label: "화상회의", icon: Video },
];

export function WorkSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-64 min-h-screen bg-indigo-950 text-white flex flex-col">
      <div className="px-6 py-5 border-b border-indigo-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-500 rounded-lg flex items-center justify-center shrink-0">
            <span className="font-bold text-white text-lg">W</span>
          </div>
          <div>
            <p className="font-bold text-white text-lg leading-tight">큐브티워크</p>
            <p className="text-indigo-300 text-xs">협업 메신저</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {workNavItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-indigo-500 text-white"
                : "text-indigo-200 hover:bg-indigo-900 hover:text-white"
            )}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-indigo-800 space-y-1">
        <button
          onClick={() => (window.location.href = "/dashboard")}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-indigo-200 hover:bg-indigo-900 hover:text-white transition-colors w-full"
        >
          <ArrowLeft size={18} />
          큐브티로 돌아가기
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-indigo-200 hover:bg-indigo-900 hover:text-white transition-colors w-full"
        >
          <LogOut size={18} />
          로그아웃
        </button>
      </div>
    </aside>
  );
}
