"use client";

// 관리자 왼쪽 메뉴 — 두 단(2026-10-20 본부 박정인 시안 v2 8번, 디렉터 「추천대로」).
//  · 왼쪽 좁은 레일: 대분류 7개(대시보드·근태·결재·전자계약·휴가·인사·설정) 아이콘 + 이름. 지금 보고 있는 대분류만 칠한다(묶음마다 색 없음)
//  · 옆 흰 패널: 고른 대분류의 메뉴(23개 → 14개, 세부는 화면 위 탭 — admin-nav). 맨 위 「메뉴 찾기」는 모든 메뉴·탭 이름에서 거른다
// 큐브티워크·모드 전환·로그아웃은 상단 바로 옮겼다(TopBar). 개선 제안도 상단 바.
// 레일을 누르면 그 대분류의 첫 화면이 바로 열린다(2026-10-21 본부 이예지 재요청 A — 전에는 패널만 바뀌고 본문은 그대로였다)
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { ADMIN_NAV, matchNav, groupHome, type NavItem } from "./admin-nav";
import { useNavCounts, CountBadge, RED_KEYS, type NavCounts } from "./useNavCounts";

const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();

export function AdminSidebar({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const pathname = usePathname();
  const counts = useNavCounts();
  const { group: activeGroup, item: activeItem } = matchNav(pathname);
  const groups = ADMIN_NAV.map((g) => ({ ...g, items: g.items.filter((it) => !it.superOnly || isSuperAdmin) }));
  // 패널 = 지금 화면의 대분류(대분류 밖 화면이면 첫 묶음)
  const shown = groups.find((g) => g.key === activeGroup?.key) ?? groups.find((g) => g.items.length);
  const panelItems = shown ? shown.items.filter((it) => !it.hidden) : [];

  const [menuQuery, setMenuQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // 휴대폰 서랍(MobileDashboardNav)은 ESC 를 document 캡처 단계에서 받아 서랍을 닫는다 — 검색칸에 글자가 있으면 그보다 먼저(window 캡처) 받아 검색어만 지운다
  useEffect(() => {
    if (!menuQuery) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.activeElement !== searchRef.current) return;
      e.stopPropagation(); e.preventDefault();
      setMenuQuery("");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menuQuery]);

  const mq = norm(menuQuery);
  // 찾기 — 메뉴 이름·대분류 이름·탭 이름 어디에 들어 있어도(탭에서 찾으면 그 탭 주소로 바로)
  const hits = mq ? groups.flatMap((g) => [
    ...(g.href && norm(g.title).includes(mq) ? [{ g, href: g.href, label: g.title }] : []),
    ...g.items.flatMap((it) => {
      const own = norm(it.label).includes(mq) || norm(g.title).includes(mq) ? [{ g, href: it.href, label: it.label }] : [];
      // 메뉴 주소와 같은 첫 탭은 메뉴 자체가 이미 찾혔으면 겹치니 뺀다(「개발자」 › 「이모티콘 관리」처럼 이름이 다르면 찾는다 — 검증 3)
      const tabs = (it.tabs || []).filter((t) => norm(t.label).includes(mq) && !(t.href === it.href && own.length)).map((t) => ({ g, href: t.href, label: `${it.label} › ${t.label}` }));
      return [...own, ...tabs];
    }),
  ]) : [];

  return (
    // h-screen-safe sticky: 본문이 길어도 메뉴는 화면에 고정
    <aside className="flex h-screen-safe sticky top-0 shrink-0">
      {/* 레일 */}
      <div className="flex w-[76px] flex-col items-center gap-1 overflow-y-auto bg-slate-900 py-3 text-slate-400">
        <Link href="/admin/dashboard" className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-lg font-bold text-white" aria-label="큐브티 대시보드">A</Link>
        {groups.map((g) => {
          const Icon = g.icon;
          const on = g.key === activeGroup?.key;
          const cls = cn("flex w-[64px] flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] font-medium",
            on ? "bg-red-600 text-white" : "hover:bg-slate-800 hover:text-white");
          // 빨간 점 — 이 대분류 안에 아직 안 끝난 건이 있으면(시안 v2 10번)
          const dot = g.items.some((it) => it.countKey && RED_KEYS.has(it.countKey) && (counts[it.countKey as keyof NavCounts] || 0) > 0);
          const inner = <><span className="relative"><Icon size={19} />{dot && <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-slate-900" aria-label="처리할 건 있음" />}</span>{g.title}</>;
          return <Link key={g.key} href={groupHome(g)} onClick={() => setMenuQuery("")} className={cls} aria-current={on ? "page" : undefined}>{inner}</Link>;
        })}
      </div>
      {/* 패널 */}
      <div className="flex w-52 flex-col border-r border-gray-200 bg-white">
        <div className="px-4 pt-4 pb-2">
          <p className="text-base font-bold leading-tight text-gray-900">큐브티</p>
          <p className="text-xs text-gray-500">관리자 시스템</p>
        </div>
        <div className="px-3 pb-2">
          <label className="flex items-center gap-2 rounded-lg border bg-gray-50 px-2.5 py-1.5 text-gray-600 focus-within:ring-1 focus-within:ring-indigo-300">
            <Search size={14} className="shrink-0 text-gray-400" />
            <input ref={searchRef} value={menuQuery} onChange={(e) => setMenuQuery(e.target.value)} placeholder="메뉴 찾기 (예: 체결본)"
              onKeyDown={(e) => { if (e.key === "Escape") setMenuQuery(""); }}
              className="w-full min-w-0 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none" aria-label="메뉴 찾기" />
            {menuQuery && <button type="button" onClick={() => setMenuQuery("")} className="text-xs text-gray-400 hover:text-gray-700" aria-label="지우기">✕</button>}
          </label>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {mq ? (
            hits.length ? hits.map((h) => (
              <Link key={h.href + h.label} href={h.href} onClick={() => setMenuQuery("")} className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                <span className="mr-1 text-[11px] text-gray-400">{h.g.title}</span>{h.label}
              </Link>
            )) : <p className="px-3 py-2 text-xs text-gray-500">「{menuQuery.trim()}」 메뉴가 없습니다</p>
          ) : shown ? (
            <>
              <p className="mb-1 border-b px-1 pb-2 text-base font-bold text-gray-900">{shown.title}</p>
              {shown.items.length === 0 && shown.href && (
                <Link href={shown.href} className={cn("mt-1 block rounded-lg px-3 py-2 text-sm font-medium", shown.key === activeGroup?.key ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-gray-100")}>{shown.title}</Link>
              )}
              <div className="mt-1 space-y-0.5">
                {panelItems.filter((it) => !it.dim).map((it) => <PanelLink key={it.href} item={it} counts={counts} active={it === activeItem || (!!activeItem && activeItem.href === it.href)} />)}
              </div>
              {panelItems.some((it) => it.dim) && (
                <div className="mt-4 space-y-0.5 border-t pt-2">
                  {panelItems.filter((it) => it.dim).map((it) => <PanelLink key={it.href} item={it} counts={counts} dim active={it === activeItem || (!!activeItem && activeItem.href === it.href)} />)}
                </div>
              )}
            </>
          ) : null}
        </nav>
      </div>
    </aside>
  );
}

function PanelLink({ item, active, counts, dim = false }: { item: NavItem; active: boolean; counts: NavCounts; dim?: boolean }) {
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined}
      className={cn("flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm",
        active ? "bg-indigo-50 font-semibold text-indigo-700" : dim ? "text-gray-400 hover:bg-gray-100 hover:text-gray-600" : "text-gray-700 hover:bg-gray-100")}>
      <span className="truncate">{item.label}</span>
      {item.countKey && <CountBadge n={counts[item.countKey as keyof NavCounts]} red={RED_KEYS.has(item.countKey)} />}
    </Link>
  );
}
