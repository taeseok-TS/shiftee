"use client";

import { resetUserPrefs } from "@/components/prefs/useUserPrefs";
import Link from "next/link";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { WorkUnreadBadge } from "./WorkUnreadBadge";
import {
  Sticker,
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
  Lightbulb,
  CalendarDays,
  Bot,
  RefreshCw,
  Inbox,
  ShieldCheck,
  CalendarCheck,
  ChevronDown,
  History,
  GitBranch,
  Send,
  Upload,
  Search,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: ComponentType<{ size?: number; className?: string }> };
// 관리자 메뉴 묶음 — 근태 / 결재 / 전자계약 / 휴가 / 인사 / 설정(2026-10-17 본부 박정인 님 개선 시안 1, 디렉터 채택. 그 전 5묶음은 2026-10-12 #214-5).
// 대시보드는 맨 위에 그대로. 메뉴 항목(주소·권한 조건)은 바꾸지 않고 묶음만 옮겼다 — 빠진 메뉴 없음.
// 전자계약만 이름을 시안대로: 전자계약 → 「보낸 계약서」, 계약 템플릿 → 「양식 관리」, + 「계약서 보내기」(새 화면)·「체결본 가져오기」(보낸 계약서 화면 버튼과 같은 곳).
// 묶음은 접었다 펼 수 있고 상태는 브라우저에 기억한다. 지금 보고 있는 화면이 든 묶음은 늘 펼친다. 맨 위 「메뉴 찾기」로 이름 거르기
const DASHBOARD: NavItem = { href: "/admin/dashboard", label: "대시보드", icon: LayoutDashboard };
const adminNavGroups: { key: string; title: string; items: NavItem[] }[] = [
  { key: "attendance", title: "근태", items: [
    { href: "/admin/attendance", label: "출퇴근", icon: Clock },
    { href: "/admin/attendance-board", label: "출퇴근기록 (달력·목록)", icon: Clock },
    { href: "/admin/work-report", label: "근로시간 리포트", icon: BarChart3 }, // 연장·야간·휴일·주 52시간(2026-10-08 #41)
    { href: "/admin/schedule", label: "근무일정", icon: Calendar },
    { href: "/admin/schedule-templates", label: "근무일정 템플릿", icon: Calendar },
  ] },
  { key: "approval", title: "결재", items: [
    { href: "/admin/leave-approvals", label: "결재 (휴가, 근무일정)", icon: CheckCircle },
    { href: "/admin/contract-approvals", label: "계약 결재", icon: CheckCircle },
    { href: "/requests?who=decided", label: "처리한 요청", icon: Inbox },   // 내가 결재한 휴가·일정·출퇴근 요청(2026-10-07 #43)
    { href: "/admin/approval-rules", label: "결재 규칙", icon: GitBranch }, // 요청 종류별 결재선·예외·원장대행(2026-10-15 #16)
  ] },
  { key: "contract", title: "전자계약", items: [
    { href: "/admin/contracts/send", label: "계약서 보내기", icon: Send },          // 용도별로 고르기(2026-10-17 시안 1·2)
    { href: "/admin/contracts", label: "보낸 계약서", icon: FileSignature },        // 종전 「전자계약」 — 목록·작성 창·외부 계약
    { href: "/admin/contract-templates", label: "양식 관리", icon: FileText },      // 종전 「계약 템플릿」
    { href: "/admin/contract-import", label: "체결본 가져오기", icon: Upload },     // 모두싸인 체결본(#4) — 보낸 계약서 화면 버튼과 같은 곳
  ] },
  { key: "leave", title: "휴가", items: [
    { href: "/admin/leave", label: "휴가 관리", icon: UmbrellaOff },
    { href: "/admin/leave-types", label: "휴가 유형 관리", icon: UmbrellaOff }, // 본부가 유형을 만들고 기본 유형을 숨김(2026-10-12 #216-1)
  ] },
  { key: "hr", title: "인사", items: [
    { href: "/admin/employees", label: "직원 관리", icon: Users },
    { href: "/admin/employee-stats", label: "직원 현황", icon: BarChart3 },
    { href: "/admin/portal-sync", label: "포털 인원명부 연동", icon: RefreshCw }, // 포털 → 큐브티 한 방향 (2026-09-15)
    { href: "/admin/hire-dates", label: "입사일 대조", icon: CalendarCheck }, // 큐브티·포털·시프티 입사일 대조·반영(2026-10-08 #5)
    { href: "/admin/branches", label: "지점 관리", icon: Building2 },
  ] },
  { key: "settings", title: "설정", items: [
    { href: "/admin/permissions", label: "권한 설정", icon: ShieldCheck }, // 역할별 권한 켜고 끄기 + 현황(2026-10-14 #39)
    { href: "/admin/attendance-rules", label: "근태 규칙", icon: Clock }, // 퇴근 기록이 없는 날 처리 — 모든 화면 같은 규칙(2026-10-20 시안 v2 7번)
    { href: "/admin/holidays", label: "공휴일 관리", icon: CalendarDays },
    { href: "/admin/audit", label: "변경 로그", icon: History }, // 업무 변경은 모든 관리자, 시스템·보안 탭은 최고관리자(2026-10-14 #66 후속)
    { href: "/admin/suggestions", label: "개선 제안", icon: Lightbulb },
    { href: "/admin/emoticons", label: "이모티콘 관리", icon: Sticker }, // 채팅 스티커 세트 (2026-09-29)
    { href: "/admin/bot", label: "봇 브리핑", icon: Bot },
    { href: "/admin/api-keys", label: "API 키", icon: Zap }, // 개인 API 키 허용·현황 (2026-09-13)
    { href: "/admin/test-api", label: "🔧 API 테스트", icon: Zap },
  ] },
];
// 메뉴 찾기 — 띄어쓰기·대소문자 무시, 메뉴 이름이나 묶음 이름에 들어 있으면
const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();
// 지금 화면에 맞는 메뉴 하나 — 가장 길게 맞는 주소(「/admin/contracts/send」에서 「보낸 계약서(/admin/contracts)」까지 켜지지 않게)
const SETTINGS_ITEM: NavItem = { href: "/admin/settings", label: "환경설정", icon: Settings };   // 최고관리자 전용(아래 고정 링크와 같은 곳) — 메뉴 찾기에도 그 조건으로만
const ALL_HREFS = [DASHBOARD, SETTINGS_ITEM, ...adminNavGroups.flatMap(g => g.items)].map(it => it.href.split("?")[0]);
const COLLAPSE_KEY = "adminNav.collapsed";

export function AdminSidebar({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  // 접힌 묶음 — 브라우저에만 기억(새로고침·다른 화면에서도 유지). 저장소를 못 쓰는 환경이면 늘 펼친 상태
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    // 서버 렌더와 첫 화면을 맞추려고(hydration) 저장값은 붙은 뒤에 읽는다 — 그래서 effect 안에서 한 번 setState 한다
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const v = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}"); if (v && typeof v === "object") setCollapsed(v); } catch { /* 무시 */ }
  }, []);
  const toggleGroup = (key: string) => setCollapsed(prev => {
    const next = { ...prev, [key]: !prev[key] };
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* 무시 */ }
    return next;
  });
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
  const activePath = ALL_HREFS.filter(p => pathname === p || pathname.startsWith(p + "/")).sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href.split("?")[0] === activePath;

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    resetUserPrefs();   // 내 화면 설정 저장소 비움 — 같은 브라우저의 다음 사람에게 넘어가지 않게(#73)
    router.push("/login");
    router.refresh();
  }

  return (
    // h-screen-safe sticky: 본문이 길어도 사이드바는 화면에 고정 — 하단(전환·로그아웃)이 페이지 밑으로 밀리지 않게 (다른 사이드바와 동일 구조)
    <aside className="w-64 h-screen-safe sticky top-0 overflow-y-auto bg-slate-900 text-white flex flex-col shrink-0">
      {/* 로고 */}
      <div className="px-6 py-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-red-600 rounded-lg flex items-center justify-center shrink-0">
            <span className="font-bold text-white text-lg">A</span>
          </div>
          <div>
            <p className="font-bold text-white text-lg leading-tight">큐브티</p>
            <p className="text-slate-400 text-xs">관리자 시스템</p>
          </div>
        </div>
      </div>

      {/* 메뉴 찾기(2026-10-17 시안 1) — 이름 일부만 쳐도 그 메뉴만 남는다(찾는 동안은 묶음을 모두 펼침) */}
      <div className="px-3 pt-3">
        <label className="flex items-center gap-2 rounded-lg bg-slate-800 px-2.5 py-1.5 text-slate-300 focus-within:ring-1 focus-within:ring-slate-500">
          <Search size={14} className="shrink-0 text-slate-500" />
          <input ref={searchRef} value={menuQuery} onChange={e => setMenuQuery(e.target.value)} placeholder="메뉴 찾기 (예: 체결본)"
            onKeyDown={e => { if (e.key === "Escape") setMenuQuery(""); }}
            className="w-full min-w-0 bg-transparent text-sm text-white placeholder:text-slate-500 outline-none" aria-label="메뉴 찾기" />
          {menuQuery && <button type="button" onClick={() => setMenuQuery("")} className="text-xs text-slate-400 hover:text-white" aria-label="지우기">✕</button>}
        </label>
      </div>

      {/* 네비게이션 — 6묶음(2026-10-17). 묶음 머리를 누르면 접히고, 보고 있는 화면이 든 묶음은 늘 펼친다 */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {(() => {
          const mq = norm(menuQuery);
          if (!mq) return null;
          // 찾는 중 — 맞는 메뉴만 묶음 이름과 함께
          const hits = [{ title: "", items: isSuperAdmin ? [DASHBOARD, SETTINGS_ITEM] : [DASHBOARD] }, ...adminNavGroups]
            .map(g => ({ title: g.title, items: norm(g.title).includes(mq) ? g.items : g.items.filter(it => norm(it.label).includes(mq)) }))
            .filter(g => g.items.length > 0);
          if (hits.length === 0) return <p className="px-3 py-2 text-xs text-slate-500">「{menuQuery.trim()}」 메뉴가 없습니다</p>;
          return hits.map(g => (
            <div key={g.title || "dash"} className="pt-1">
              {g.title && <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.title}</p>}
              {g.items.map(it => <NavLink key={it.href} item={it} active={isActive(it.href)} onClick={() => setMenuQuery("")} />)}
            </div>
          ));
        })()}
        {!norm(menuQuery) && <NavLink item={DASHBOARD} active={isActive(DASHBOARD.href)} />}
        {!norm(menuQuery) && adminNavGroups.map(g => {
          const hasActive = g.items.some(it => isActive(it.href));
          const open = hasActive || !collapsed[g.key];
          return (
            <div key={g.key} className="pt-2">
              <button type="button" onClick={() => { if (!hasActive) toggleGroup(g.key); }}   // 보고 있는 화면의 묶음은 늘 펼쳐 둔다(눌러도 접히지 않음)
                className="flex w-full items-center justify-between px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300"
                aria-expanded={open}>
                <span>{g.title}</span>
                <ChevronDown size={14} className={cn("transition-transform", open ? "" : "-rotate-90")} />
              </button>
              {open && g.items.map(it => <NavLink key={it.href} item={it} active={isActive(it.href)} />)}
            </div>
          );
        })}
      </nav>

      {/* 환경설정 및 로그아웃 */}
      <div className="px-3 py-3 border-t border-slate-700 space-y-0.5">
        {/* 시스템 설정·백업은 메인 관리자 전용 */}
        {isSuperAdmin && (
          <Link
            href="/admin/settings"
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              pathname === "/admin/settings" || pathname.startsWith("/admin/settings/")
                ? "bg-red-600 text-white"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            )}
          >
            <Settings size={18} />
            환경설정
          </Link>
        )}
        <button
          onClick={() => window.location.href = "/work"}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors w-full"
        >
          💬 큐브티워크
          <WorkUnreadBadge />
        </button>
        <button
          onClick={() => window.location.href = "/manager/dashboard"}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors w-full"
        >
          🧑‍💼 원장 모드로 전환
        </button>
        <button
          onClick={() => window.location.href = "/dashboard"}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors w-full"
        >
          👤 직원 모드로 전환
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors w-full"
        >
          <LogOut size={18} />
          로그아웃
        </button>
      </div>
    </aside>
  );
}

function NavLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
        active ? "bg-red-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
      )}
    >
      <Icon size={18} />
      {item.label}
    </Link>
  );
}

