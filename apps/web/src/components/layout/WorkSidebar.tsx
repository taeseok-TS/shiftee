"use client";

import { isSessionExpired } from "@/lib/session-expiry";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MessageSquare, Megaphone, CalendarDays, Video, FileUp, Camera, LogOut, ArrowLeft, ChevronsLeft, ChevronsRight, Building2, ExternalLink } from "lucide-react";
import { useIsDirectHost } from "@/lib/direct-host";

const workNavItems = [
  { href: "/work/chat", label: "채팅", icon: MessageSquare },
  { href: "/work/announcements", label: "공지", icon: Megaphone },
  { href: "/work/calendar", label: "캘린더", icon: CalendarDays },
  { href: "/work/meeting", label: "화상회의", icon: Video },
  { href: "/work/submissions", label: "자료제출", icon: FileUp }, // 2026-09-13 디렉터 승인 기획 1단계
  { href: "/work/marketing", label: "마케팅 자료", icon: Camera }, // 2026-09-14 본부장 과제 — 지점 마케팅 자료 올리기 → 큐브마케팅 블로그 발행
];

// 직영 포털 바로가기 (2026-09-18 직영 주간회의 건의 — 이예지 대리, 본부장 지시).
// 포털을 매니저까지 전체 공유하기로 해서, 큐브티워크 안에서 바로 들어갈 수 있게 한다. 외부 사이트라 새 탭으로 연다.
const JIKYOUNG_PORTAL_URL = "https://jikyoung-portal-one.vercel.app/";
// 직영 포털은 큐브티(cubetee.co.kr) 전용이다 — 판매용 고객사 인스턴스도 같은 화면을 쓰므로 거기서는 숨긴다(검증관 3).
// 판별 규칙은 lib/is-direct-host 하나뿐이다(로그인 화면의 EMS 안내도 같은 규칙을 쓴다).
const useShowPortalLink = useIsDirectHost;

// 새 글 뱃지 (개선 제안 2026-08-25, 김나현팀장) — 채팅: 안읽은 메시지 합계(채팅 목록과 동일 수치),
// 공지: 마지막으로 공지 화면을 연 시각(localStorage) 이후 등록된 공지 수
const NOTICE_SEEN_KEY = "work_notice_seen_at";

function useWorkBadges(pathname: string) {
  const [chatUnread, setChatUnread] = useState(0);
  const [noticeNew, setNoticeNew] = useState(0);
  const [submissionPending, setSubmissionPending] = useState(0); // 자료제출 — 내게 걸린 요청 중 아직 안 낸 수

  const ivRef = useRef<number>(0);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [chRes, anRes, sbRes] = await Promise.all([
          fetch("/api/work/channels"),
          fetch("/api/work/announcements?times=1"),
          fetch("/api/work/submissions/badge"),
        ]);
        if (!alive) return;
        // 세션이 끊기면 폴링을 멈추고 로그인으로 보낸다 — 종전에는 조용히 삼켜
        // 낡은 화면을 그대로 두고 영원히 찔렀다 (2026-09-04)
        if (isSessionExpired(chRes) || isSessionExpired(anRes)) { window.clearInterval(ivRef.current); return; }
        if (sbRes.ok) {
          const d = await sbRes.json();
          setSubmissionPending(Number(d.pending) || 0);
        }
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

  return { "/work/chat": chatUnread, "/work/announcements": noticeNew, "/work/submissions": submissionPending } as Record<string, number>;
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
  const showPortal = useShowPortalLink();
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
    // h-screen-safe + sticky: 본문이 길어도 사이드바는 화면에 고정 (관리자 사이드바와 동일)
    // 모바일에서는 숨기고 WorkMobileNav(상단 바)로 대체
    <aside className={cn("hidden md:flex h-screen-safe sticky top-0 overflow-y-auto shrink-0 bg-indigo-950 text-white flex-col transition-all duration-200", collapsed ? "w-16" : "w-64")}>
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
        {showPortal && <a
          href={JIKYOUNG_PORTAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          title={collapsed ? "직영 포털 (새 탭)" : "새 탭에서 열립니다"}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-indigo-200 hover:bg-indigo-900 hover:text-white",
            collapsed && "justify-center px-0"
          )}
        >
          <Building2 size={18} />
          {!collapsed && <span className="flex-1">직영 포털</span>}
          {!collapsed && <ExternalLink size={13} className="opacity-60" />}
        </a>}
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
  const showPortal = useShowPortalLink();
  const badges = useWorkBadges(pathname);
  const navRef = useRef<HTMLElement>(null);
  // 지금 화면의 메뉴가 옆으로 가려진 쪽에 있으면 보이게 굴린다(검증관 4 — 예: 마케팅 자료 화면)
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);
  return (
    <div className="md:hidden sticky top-0 z-40 h-12 shrink-0 bg-indigo-950 text-white flex items-center px-2 gap-1">
      <button onClick={() => (window.location.href = "/dashboard")} title="큐브티로 돌아가기"
        className="p-2 rounded-lg text-indigo-200 hover:bg-indigo-900">
        <ArrowLeft size={18} />
      </button>
      <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center shrink-0">
        <span className="font-bold text-white text-sm">W</span>
      </div>
      {/* 폰 폭에서는 메뉴가 한 줄에 다 안 들어간다 — 원래도 375px 에서 이름이 세로로 접히며 넘쳤다.
          줄바꿈 없이 옆으로 밀어 보게 한다(검증관 1: 포털 아이콘이 화면 밖으로 밀려나던 것과 함께 해결) */}
      {/* py-1: 가로 스크롤은 세로도 잘라서 알림 점 윗부분이 잘렸다(검증관 2). 스크롤바는 감춘다 — 좁힌 PC 창에서
          메뉴 밑에 15px 막대가 생기던 것(검증관 3). 폰은 손가락으로 민다. */}
      <nav ref={navRef} className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {workNavItems.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}
            aria-current={pathname === href || pathname.startsWith(href + "/") ? "page" : undefined}
            className={cn(
              "relative shrink-0 whitespace-nowrap flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium",
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
      {/* 폰 폭 상단 바는 칸이 좁아 아이콘만 — 누르면 직영 포털이 새 탭으로 열린다 */}
      {showPortal && (
        <a href={JIKYOUNG_PORTAL_URL} target="_blank" rel="noopener noreferrer" title="직영 포털 (새 탭)"
          className="p-2 rounded-lg text-indigo-200 hover:bg-indigo-900 shrink-0">
          <Building2 size={18} />
        </a>
      )}
    </div>
  );
}
