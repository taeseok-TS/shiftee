"use client";

import { isSessionExpired } from "@/lib/session-expiry";
import { useState, useEffect, useRef } from "react";
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

// 새 글 뱃지 (개선 제안 2026-08-25, 김나현팀장) — 채팅: 안읽은 메시지 합계(채팅 목록과 동일 수치),
// 공지: 마지막으로 공지 화면을 연 시각(localStorage) 이후 등록된 공지 수
const NOTICE_SEEN_KEY = "work_notice_seen_at";

function useWorkBadges(pathname: string) {
  const [chatUnread, setChatUnread] = useState(0);
  const [noticeNew, setNoticeNew] = useState(0);

  const ivRef = useRef<number>(0);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [chRes, anRes] = await Promise.all([
          fetch("/api/work/channels"),
          fetch("/api/work/announcements?times=1"),
        ]);
        if (!alive) return;
        // 세션이 끊기면 폴링을 멈추고 로그인으로 보낸다 — 종전에는 조용히 삼켜
        // 낡은 화면을 그대로 두고 영원히 찔렀다 (2026-09-04)
        if (isSessionExpired(chRes) || isSessionExpired(anRes)) { window.clearInterval(ivRef.current); return; }
        if (chRes.ok) {
          const d = await chRes.json();
          const sum = (d.channels || []).reduce((a: number, c: { unread?: number }) => a + (c.unread || 0), 0);
          setChatUnread(sum);
        }
        if (anRes.ok) {
          const d = await anRes.json();
          const seen = localStorage.getItem(NOTICE_SEEN_KEY);
          const seenTime = seen ? new Date(seen).getTime() : 0;
          const cnt = (d.times || []).filter((t: string) => new Date(t).getTime() > seenTime).length;
          setNoticeNew(cnt);
        }
      } catch { /* 네트워크 오류는 무시 — 다음 주기에 재시도 */ }
    }
    load();
    const iv = window.setInterval(load, 60_000); // 1분 주기
    ivRef.current = iv;
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.clearInterval(iv); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]); // 화면 이동(방 읽음 등) 때마다 즉시 갱신

  // 공지 화면에 들어오면 확인한 것으로 기록하고 뱃지 소등
  useEffect(() => {
    if (pathname.startsWith("/work/announcements")) {
      localStorage.setItem(NOTICE_SEEN_KEY, new Date().toISOString());
      setNoticeNew(0);
    }
  }, [pathname]);

  return { "/work/chat": chatUnread, "/work/announcements": noticeNew } as Record<string, number>;
}

function NavBadge({ count, collapsed }: { count: number; collapsed?: boolean }) {
  if (!count) return null;
  if (collapsed)
    return <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full" />;
  return (
    <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function WorkSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const badges = useWorkBadges(pathname);

  useEffect(() => {
    setCollapsed(localStorage.getItem("work_sidebar_collapsed") === "1");
    // 다른 화면(화상회의 등)에서 토글하면 동기화
    const h = () => setCollapsed(localStorage.getItem("work_sidebar_collapsed") === "1");
    window.addEventListener("work-sidebar-changed", h);
    return () => window.removeEventListener("work-sidebar-changed", h);
  }, []);

  function toggle() {
    const n = !collapsed;
    localStorage.setItem("work_sidebar_collapsed", n ? "1" : "0");
    setCollapsed(n);
    window.dispatchEvent(new Event("work-sidebar-changed"));
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    // h-screen + sticky: 본문이 길어도 사이드바는 화면에 고정 (관리자 사이드바와 동일)
    // 모바일에서는 숨기고 WorkMobileNav(상단 바)로 대체
    <aside className={cn("hidden md:flex h-screen sticky top-0 overflow-y-auto shrink-0 bg-indigo-950 text-white flex-col transition-all duration-200", collapsed ? "w-16" : "w-64")}>
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
              "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              collapsed && "justify-center px-0",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-indigo-500 text-white"
                : "text-indigo-200 hover:bg-indigo-900 hover:text-white"
            )}
          >
            <Icon size={18} />
            {!collapsed && label}
            <NavBadge count={badges[href] || 0} collapsed={collapsed} />
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

// 모바일 전용 상단 바 — 폰 폭에서는 좌측 사이드바 대신 이 바로 이동한다
export function WorkMobileNav() {
  const pathname = usePathname();
  const badges = useWorkBadges(pathname);
  return (
    <div className="md:hidden sticky top-0 z-40 h-12 shrink-0 bg-indigo-950 text-white flex items-center px-2 gap-1">
      <button onClick={() => (window.location.href = "/dashboard")} title="큐브티로 돌아가기"
        className="p-2 rounded-lg text-indigo-200 hover:bg-indigo-900">
        <ArrowLeft size={18} />
      </button>
      <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center shrink-0">
        <span className="font-bold text-white text-sm">W</span>
      </div>
      <nav className="flex-1 flex items-center justify-evenly">
        {workNavItems.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}
            className={cn(
              "relative flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-indigo-500 text-white"
                : "text-indigo-200"
            )}>
            <Icon size={15} />
            {label}
            {(badges[href] || 0) > 0 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full" />}
          </Link>
        ))}
      </nav>
    </div>
  );
}
