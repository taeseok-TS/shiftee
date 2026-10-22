"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useNavCounts } from "./useNavCounts";
import {
  LayoutDashboard,
  Users,
  UmbrellaOff,
  FileSignature,
  Calendar,
  Settings,
  Inbox,
  BarChart3,
} from "lucide-react";

const managerNavItems = [
  { href: "/manager/dashboard", label: "팀 대시보드", icon: LayoutDashboard },
  { href: "/manager/team-employees", label: "팀 직원", icon: Users },
  { href: "/manager/team-leave", label: "팀 휴가", icon: UmbrellaOff },
  { href: "/manager/team-contracts", label: "팀 계약서", icon: FileSignature },
  { href: "/manager/team-schedule", label: "팀 일정", icon: Calendar },
  { href: "/manager/team-attendance", label: "팀 출퇴근기록", icon: Calendar, needs: "manager.viewAttendance" },   // 본부가 끄면 숨김(권한 설정 #39)
  { href: "/manager/work-report", label: "근로시간 리포트", icon: BarChart3, needs: "manager.viewAttendance" }, // 담당 지점(2026-10-08 #41)
  { href: "/requests?who=decided", label: "처리한 요청", icon: Inbox },   // 내가 결재한 휴가·일정·출퇴근 요청(2026-10-07 #43)
];

export function ManagerSidebar() {
  const pathname = usePathname();
  // 아직 안 끝난 내 차례(시안 v2 10번) — 팀 휴가 = 휴가·근무일정·출퇴근 결재, 팀 계약서 = 계약 결재
  const counts = useNavCounts();
  const countOf = (href: string) => href === "/manager/team-leave" ? counts.leaveInbox || 0 : href === "/manager/team-contracts" ? counts.contractSign || 0 : 0;
  // 원장 권한 토글(#39) — 꺼진 메뉴는 숨긴다(실제 차단은 API 가 한다). 읽기 전엔 모두 보여 준다
  const [perms, setPerms] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/me/permissions").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.permissions) setPerms(d.permissions); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const visibleItems = managerNavItems.filter((it) => !("needs" in it) || !perms || perms[(it as { needs: string }).needs] !== false);

  return (
    <aside className="w-64 h-screen-safe sticky top-0 overflow-y-auto bg-slate-900 text-white flex flex-col shrink-0">
      {/* 로고 */}
      <div className="px-6 py-5 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-yellow-600 rounded-lg flex items-center justify-center shrink-0">
            <span className="font-bold text-white text-lg">M</span>
          </div>
          <div>
            <p className="font-bold text-white text-lg leading-tight tracking-[.04em]">CUBETEE</p>
            <p className="text-slate-400 text-xs">원장 관리 시스템</p>
          </div>
        </div>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {visibleItems.map(({ href, label, icon: Icon }) => { const n = countOf(href); return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-yellow-600 text-white"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            )}
          >
            <Icon size={18} />
            {label}
            {n > 0 && <span className="ml-auto min-w-[20px] rounded-full bg-red-500 px-1.5 text-center text-[11px] font-bold leading-5 text-white">{n > 99 ? "99+" : n}</span>}
          </Link>
        ); })}
      </nav>

      {/* 환경설정 */}
      <div className="px-3 py-4 border-t border-slate-700 space-y-1">
        <Link
          href="/manager/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            pathname === "/manager/settings" || pathname.startsWith("/manager/settings/")
              ? "bg-yellow-600 text-white"
              : "text-slate-300 hover:bg-slate-800 hover:text-white"
          )}
        >
          <Settings size={18} />
          환경설정
        </Link>
        {/* 큐브티워크·모드 전환·로그아웃은 상단 바로 옮겼다(2026-10-20 시안 v2 9번 — TopBar) */}
      </div>
    </aside>
  );
}
