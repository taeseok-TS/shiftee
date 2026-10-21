"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useNavCounts } from "./useNavCounts";
import {
  LayoutDashboard,
  Clock,
  Calendar,
  UmbrellaOff,
  FileSignature,
  Lightbulb,
  ClipboardCheck,
  User,
  Settings,
  Inbox,
} from "lucide-react";

const sharedNavItems = [
  { href: "/dashboard", label: "내 대시보드", icon: LayoutDashboard },
  // 출퇴근(기록 조회)은 관리자·원장. 직원은 본부가 「본인 출퇴근 기록 열람(웹)」을 켠 경우에만(권한 설정 #39)
  { href: "/attendance", label: "출퇴근 관리", icon: Clock, adminOnly: true },
  { href: "/schedule", label: "근무일정", icon: Calendar },
  { href: "/leave", label: "휴가 관리", icon: UmbrellaOff },
  { href: "/requests", label: "내 요청", icon: Inbox },   // 휴가·일정·출퇴근 요청 한눈에(2026-10-07 #51)
  { href: "/contracts", label: "내 계약서", icon: FileSignature },
  { href: "/suggestions", label: "개선 제안", icon: Lightbulb },
];

export function SharedSidebar({ role }: { role?: string }) {
  const pathname = usePathname();
  // 아직 안 끝난 내 차례(시안 v2 10번) — 내 계약서 = 내가 서명할 것, 원장대행 결재 = 휴가·근무일정·출퇴근 결재
  const counts = useNavCounts();
  const countOf = (href: string) => href === "/contracts" ? counts.mySign || 0 : href === "/approvals" ? counts.leaveInbox || 0 : 0;
  // 원장대행으로 지정된 직원에게만 「결재」 메뉴 — 원장·관리자는 각자 모드의 결재 화면을 쓴다(2026-10-07)
  const [delegateBranches, setDelegateBranches] = useState<string[]>([]);
  const [selfAttendance, setSelfAttendance] = useState(false);   // 직원 본인 출퇴근 열람(웹) 권한(#39)
  useEffect(() => {
    if (role === "ADMIN" || role === "MANAGER") return;
    let alive = true;
    fetch("/api/me/delegate").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (alive) setDelegateBranches(Array.isArray(d?.branches) ? d.branches : []);
    }).catch(() => {});
    fetch("/api/me/permissions").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (alive) setSelfAttendance(d?.permissions?.["employee.viewOwnAttendance"] === true);
    }).catch(() => {});
    return () => { alive = false; };
  }, [role]);
  const navItems = [
    ...sharedNavItems.filter((it) => !it.adminOnly || role === "ADMIN" || role === "MANAGER" || selfAttendance),
    ...(delegateBranches.length > 0
      ? [{ href: "/approvals", label: `결재 (원장대행 · ${delegateBranches.join(", ")})`, icon: ClipboardCheck }]
      : []),
  ];

  return (
    <aside className="w-64 h-screen-safe sticky top-0 overflow-y-auto bg-slate-900 text-white flex flex-col shrink-0">
      {/* 로고 */}
      <div className="px-6 py-5 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-500 rounded-lg flex items-center justify-center shrink-0">
            <span className="font-bold text-white text-lg">E</span>
          </div>
          <div>
            <p className="font-bold text-white text-lg leading-tight">큐브티</p>
            <p className="text-slate-400 text-xs">직원 시스템</p>
          </div>
        </div>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => { const n = countOf(href); return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-blue-600 text-white"
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
          href="/profile"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            pathname === "/profile" || pathname.startsWith("/profile/")
              ? "bg-blue-600 text-white"
              : "text-slate-300 hover:bg-slate-800 hover:text-white"
          )}
        >
          <User size={18} />
          프로필
        </Link>
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            pathname === "/settings" || pathname.startsWith("/settings/")
              ? "bg-blue-600 text-white"
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
