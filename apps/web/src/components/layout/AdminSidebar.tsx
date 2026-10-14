"use client";

import { resetUserPrefs } from "@/components/prefs/useUserPrefs";
import Link from "next/link";
import { useEffect, useState, type ComponentType } from "react";
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
} from "lucide-react";

type NavItem = { href: string; label: string; icon: ComponentType<{ size?: number; className?: string }> };
// 관리자 메뉴 5묶음(2026-10-12 개선 제안 #214-5, 디렉터 채택): 근태 / 결재 / 전자계약 / 인사 / 설정. 대시보드는 맨 위에 그대로.
// 묶음은 접었다 펼 수 있고 상태는 브라우저에 기억한다. 지금 보고 있는 화면이 든 묶음은 늘 펼친다
const DASHBOARD: NavItem = { href: "/admin/dashboard", label: "대시보드", icon: LayoutDashboard };
const adminNavGroups: { key: string; title: string; items: NavItem[] }[] = [
  { key: "attendance", title: "근태", items: [
    { href: "/admin/attendance", label: "출퇴근", icon: Clock },
    { href: "/admin/attendance-board", label: "출퇴근기록 (달력·목록)", icon: Clock },
    { href: "/admin/work-report", label: "근로시간 리포트", icon: BarChart3 }, // 연장·야간·휴일·주 52시간(2026-10-08 #41)
    { href: "/admin/schedule", label: "근무일정", icon: Calendar },
    { href: "/admin/schedule-templates", label: "근무일정 템플릿", icon: Calendar },
    { href: "/admin/leave", label: "휴가 관리", icon: UmbrellaOff },
    { href: "/admin/leave-types", label: "휴가 유형 관리", icon: UmbrellaOff }, // 본부가 유형을 만들고 기본 유형을 숨김(2026-10-12 #216-1)
    { href: "/admin/holidays", label: "공휴일 관리", icon: CalendarDays },
  ] },
  { key: "approval", title: "결재", items: [
    { href: "/admin/leave-approvals", label: "결재 (휴가, 근무일정)", icon: CheckCircle },
    { href: "/admin/contract-approvals", label: "계약 결재", icon: CheckCircle },
    { href: "/requests?who=decided", label: "처리한 요청", icon: Inbox },   // 내가 결재한 휴가·일정·출퇴근 요청(2026-10-07 #43)
  ] },
  { key: "contract", title: "전자계약", items: [
    { href: "/admin/contracts", label: "전자계약", icon: FileSignature },
    { href: "/admin/contract-templates", label: "계약 템플릿", icon: FileText },
  ] },
  { key: "hr", title: "인사", items: [
    { href: "/admin/employees", label: "직원 관리", icon: Users },
    { href: "/admin/employee-stats", label: "직원 현황", icon: BarChart3 },
    { href: "/admin/portal-sync", label: "포털 인원명부 연동", icon: RefreshCw }, // 포털 → 큐브티 한 방향 (2026-09-15)
    { href: "/admin/hire-dates", label: "입사일 대조", icon: CalendarCheck }, // 큐브티·포털·시프티 입사일 대조·반영(2026-10-08 #5)
    { href: "/admin/branches", label: "지점 관리", icon: Building2 },
    { href: "/admin/permissions", label: "권한 설정", icon: ShieldCheck }, // 역할별 권한 켜고 끄기 + 현황(2026-10-14 #39)
  ] },
  { key: "settings", title: "설정", items: [
    { href: "/admin/suggestions", label: "개선 제안", icon: Lightbulb },
    { href: "/admin/audit", label: "변경 로그", icon: History }, // 업무 변경은 모든 관리자, 시스템·보안 탭은 최고관리자(2026-10-14 #66 후속)
    { href: "/admin/emoticons", label: "이모티콘 관리", icon: Sticker }, // 채팅 스티커 세트 (2026-09-29)
    { href: "/admin/bot", label: "봇 브리핑", icon: Bot },
    { href: "/admin/api-keys", label: "API 키", icon: Zap }, // 개인 API 키 허용·현황 (2026-09-13)
    { href: "/admin/test-api", label: "🔧 API 테스트", icon: Zap },
  ] },
];
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
  const isActive = (href: string) => {
    const path = href.split("?")[0];
    return pathname === path || pathname.startsWith(path + "/");
  };

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

      {/* 네비게이션 — 5묶음(#214-5). 묶음 머리를 누르면 접히고, 보고 있는 화면이 든 묶음은 늘 펼친다 */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        <NavLink item={DASHBOARD} active={isActive(DASHBOARD.href)} />
        {adminNavGroups.map(g => {
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

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
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

