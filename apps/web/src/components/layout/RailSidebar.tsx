"use client";

// 왼쪽 메뉴 — 레일 + 흰 패널(2026-10-20 본부 박정인 시안 v2 8번, 디렉터 「추천대로」 · 10/21 시안 R8 「세 모드 같은 틀」).
//  · 왼쪽 좁은 레일: 대분류 아이콘 + 이름. 지금 보고 있는 대분류만 칠한다(묶음마다 색 없음). 맨 위 빨간 네모 로고(A · M · E), 맨 아래 듀리 「큐브티워크」
//  · 옆 흰 패널: 고른 대분류의 메뉴. 맨 위 「메뉴 찾기」는 모든 메뉴 · 탭 이름에서 거른다. 대시보드에서는 패널 없이 레일만
// 큐브티워크 · 모드 전환 · 로그아웃은 상단 바(TopBar). 레일을 누르면 그 대분류의 첫 화면이 바로 열린다(재요청 A)
// 관리자(AdminSidebar) · 원장(ManagerSidebar) · 직원(SharedSidebar)이 이 부품 하나를 쓴다 — 메뉴 정의만 다르다(admin-nav · mode-nav)
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { makeNavMatcher, type NavGroup, type NavItem } from "./admin-nav";
import { useNavCounts, CountBadge, RED_KEYS, type NavCounts } from "./useNavCounts";

const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();

export function RailSidebar({ nav, letter, home, system }: { nav: NavGroup[]; letter: string; home: string; system: string }) {
  const pathname = usePathname();
  const counts = useNavCounts();
  // 쿼리가 붙은 메뉴(지점 휴가 = ?tab=history)를 맞추려고 지금 쿼리를 읽는다. 쿼리 메뉴는 <a>(새로 읽기)로 열어 화면을 바꿀 때마다 다시 읽힌다
  const [search, setSearch] = useState("");
  useEffect(() => { const q = window.location.search; Promise.resolve().then(() => setSearch(q)); }, [pathname]);
  // 화면 안 탭이 주소 쿼리를 바꾸면(원장 결재함 ↔ 지점 휴가 — team-leave) 알려 준다. 뒤로 가기도 같이
  useEffect(() => {
    const re = () => setSearch(window.location.search);
    window.addEventListener("rail:search", re); window.addEventListener("popstate", re);
    return () => { window.removeEventListener("rail:search", re); window.removeEventListener("popstate", re); };
  }, []);
  // 새로 열어야 하는 주소 — 쿼리가 붙었거나, 지금과 같은 화면인데 지금 주소에 쿼리가 붙어 있을 때(?tab=history → 결재함).
  // 같은 경로로의 <Link> 는 Next 가 화면을 다시 그리지 않아 주소만 바뀌고 탭 · 제목은 그대로였다(R8 검증 1)
  const reload = (href: string) => href.includes("?") || (href === pathname && !!search);
  // 그린 뒤 화면이 replaceState 로 쿼리를 바꿨을 수 있다(rail:search 를 안 쏘는 화면) — 누르는 순간 다시 본다(R8 재검증 C)
  const onLink = (href: string) => (e: MouseEvent) => {
    setMenuQuery("");
    if (href === window.location.pathname && window.location.search && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) { e.preventDefault(); window.location.assign(href); }
  };
  const matcher = useMemo(() => makeNavMatcher(nav, home), [nav, home]);
  const { group: activeGroup, item: activeItem } = matcher.match(pathname, search);
  const groupHome = matcher.home;
  const groups = nav;
  // 패널 = 지금 화면의 대분류(대분류 밖 화면이면 첫 묶음)
  const shown = groups.find((g) => g.key === activeGroup?.key) ?? groups.find((g) => g.items.length);
  const panelItems = shown ? shown.items.filter((it) => !it.hidden) : [];

  // 브라우저 탭 제목 = 「화면 이름 · CUBETEE」(2026-10-28 이예지 ⑦ — 탭을 여러 개 열면 전부 「CUBETEE」라 구분이 안 됐다).
  // 화면 이름 = 지금 주소 · 쿼리에 맞는 탭(찾기 항목 포함) → 메뉴 → 대분류 순. 화면들이 클라이언트라 메타데이터 대신 여기서 바꾼다
  const pageLabel = (() => {
    if (!activeItem) return activeGroup?.title ?? "";
    const cur = new URLSearchParams(search);
    const sub = [...(activeItem.tabs || []), ...(activeItem.find || [])].filter((t) => {
      const [p, q] = t.href.split("?");
      if (p !== pathname) return false;
      const want = new URLSearchParams(q || "");
      // 쿼리 없는 탭은 메뉴 첫 주소와 다른 화면일 때만(근무일정 › 근무 시간 종류 · 출퇴근 현황 › 달력 · 목록)
      return q ? [...want.entries()].every(([k, v]) => cur.get(k) === v) : p !== activeItem.href.split("?")[0];
    }).sort((a, b) => Number(b.href.includes("?")) - Number(a.href.includes("?")))[0];   // 쿼리까지 맞는 것이 먼저(달력 · 목록)
    return sub ? `${sub.label} · ${activeItem.label}` : activeItem.label;
  })();
  useEffect(() => {
    const t = pageLabel ? `${pageLabel} · CUBETEE` : "CUBETEE";
    document.title = t;
    // 화면을 옮길 때 Next 가 머리의 제목을 다시 그릴 수 있어 한 번 더(늦게) 맞춘다
    const id = window.setTimeout(() => { if (document.title !== t) document.title = t; }, 400);
    return () => window.clearTimeout(id);
  }, [pageLabel]);

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
      const tabs = [...(it.tabs || []), ...(it.find || [])].filter((t) => norm(t.label).includes(mq) && !(t.href === it.href && own.length)).map((t) => ({ g, href: t.href, label: `${it.label} › ${t.label}` }));
      return [...own, ...tabs];
    }),
  ]) : [];

  return (
    // h-screen-safe sticky: 본문이 길어도 메뉴는 화면에 고정
    <aside className="flex h-screen-safe sticky top-0 shrink-0">
      {/* 레일 */}
      {/* 세로로만 밀고 스크롤바는 감춘다 — 낮은 화면(배율 175% 노트북 등)에서 스크롤바 15px 가 메뉴 폭 64px 를 밀어 가로 스크롤바·왼쪽 잘림이 생겼다(듀리 검증 1) */}
      <div className="flex w-[76px] flex-col items-center gap-1 overflow-y-auto overflow-x-hidden bg-slate-900 py-3 text-slate-400 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Link href={home} className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-lg font-bold text-white" aria-label="CUBETEE 대시보드">{letter}</Link>
        {groups.map((g) => {
          const Icon = g.icon;
          const on = g.key === activeGroup?.key;
          const cls = cn("flex w-[64px] flex-col items-center gap-0.5 rounded-xl py-2 text-[12px] font-medium",
            on ? "bg-indigo-600 text-white" : "hover:bg-slate-800 hover:text-white");   // 고른 칸은 인디고(빨강은 경고에만 — 2026-10-29 이예지)
          // 인디고 점(10/28 이예지 디자인 ① — 빨강은 경고에만) — 이 대분류 안에 아직 안 끝난 건이 있으면(시안 v2 10번)
          const dot = g.items.some((it) => it.countKey && RED_KEYS.has(it.countKey) && (counts[it.countKey as keyof NavCounts] || 0) > 0);
          const inner = <><span className="relative"><Icon size={19} />{dot && <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-indigo-400 ring-2 ring-slate-900" aria-label="처리할 건 있음" />}</span>{g.title}</>;
          const to = groupHome(g);
          return reload(to)
            ? <a key={g.key} href={to} className={cls} aria-current={on ? "page" : undefined}>{inner}</a>
            : <Link key={g.key} href={to} onClick={onLink(to)} className={cls} aria-current={on ? "page" : undefined}>{inner}</Link>;
        })}
        {/* 레일 맨 아래 듀리 「큐브티워크」는 뺐다 — 상단 바 버튼 하나만(2026-10-28 이예지 디자인 ⑨, 10/21 시안도 상단에만) */}
      </div>
      {/* 패널 */}
      <div className={cn("flex w-52 flex-col border-r border-gray-200 bg-white", activeGroup?.key === "dashboard" && "hidden")}>
        <div className="px-4 pt-4 pb-2">
          <p className="text-base font-bold uppercase leading-tight tracking-[.04em] text-gray-900">CUBETEE</p>
          <p className="text-xs text-gray-500">{system}</p>
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
            hits.length ? hits.map((h) => {
              const body = <><span className="mr-1 text-[12px] text-gray-400">{h.g.title}</span>{h.label}</>;
              const cls = "block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100";
              // ?tab= 이 붙은 주소(화면 안 알약 탭 — admin-nav find)는 새로 연다. 같은 화면에서 쿼리만 바뀌면 Next 가 화면을
              // 다시 그리지 않아 주소만 바뀌고 탭은 그대로였다(최종 검증 — 탭은 처음 열 때 한 번만 읽는다)
              return reload(h.href)
                ? <a key={h.href + h.label} href={h.href} className={cls}>{body}</a>
                : <Link key={h.href + h.label} href={h.href} onClick={onLink(h.href)} className={cls}>{body}</Link>;
            }) : <p className="px-3 py-2 text-xs text-gray-500">「{menuQuery.trim()}」 메뉴가 없습니다</p>
          ) : shown ? (
            <>
              <p className="mb-1 border-b px-1 pb-2 text-base font-bold text-gray-900">{shown.title}</p>
              {shown.items.length === 0 && shown.href && (
                <Link href={shown.href} className={cn("mt-1 block rounded-lg px-3 py-2 text-sm font-medium", shown.key === activeGroup?.key ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-gray-100")}>{shown.title}</Link>
              )}
              <div className="mt-1 space-y-0.5">
                {panelItems.filter((it) => !it.dim).map((it) => <PanelLink key={it.href} item={it} counts={counts} reload={reload(it.href)} onClick={onLink(it.href)} active={it === activeItem || (!!activeItem && activeItem.href === it.href)} />)}
              </div>
              {panelItems.some((it) => it.dim) && (
                <div className="mt-4 space-y-0.5 border-t pt-2">
                  {panelItems.filter((it) => it.dim).map((it) => <PanelLink key={it.href} item={it} counts={counts} reload={reload(it.href)} onClick={onLink(it.href)} dim active={it === activeItem || (!!activeItem && activeItem.href === it.href)} />)}
                </div>
              )}
            </>
          ) : null}
        </nav>
      </div>
    </aside>
  );
}

function PanelLink({ item, active, counts, reload, onClick, dim = false }: { item: NavItem; active: boolean; counts: NavCounts; reload: boolean; onClick: (e: MouseEvent) => void; dim?: boolean }) {
  const cls = cn("flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm",
    active ? "bg-indigo-50 font-semibold text-indigo-700" : dim ? "text-gray-400 hover:bg-gray-100 hover:text-gray-600" : "text-gray-700 hover:bg-gray-100");
  const body = <><span className="truncate">{item.label}</span>{item.countKey && <CountBadge n={counts[item.countKey as keyof NavCounts]} red={RED_KEYS.has(item.countKey)} />}</>;
  // 쿼리가 붙은 메뉴(?tab=)는 새로 연다 — 같은 화면에서 쿼리만 바뀌면 Next 가 화면을 다시 그리지 않아 탭이 그대로였다(메뉴 찾기와 같은 규칙)
  return reload
    ? <a href={item.href} aria-current={active ? "page" : undefined} className={cls}>{body}</a>
    : <Link href={item.href} onClick={onClick} aria-current={active ? "page" : undefined} className={cls}>{body}</Link>;
}
