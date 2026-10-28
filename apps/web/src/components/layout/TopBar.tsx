"use client";

// 상단 바(2026-10-20 본부 박정인 시안 v2 9번) — 모드 전환·큐브티워크를 이름 드롭다운에서 꺼내 늘 보이게.
//  · 왼쪽: 「관리자 모드 · 원장 모드 · 직원 모드」 한 줄 버튼(지금 모드가 눌린 상태). 한 번 눌러 바로 넘어간다
//    관리자 = 세 모드, 원장 = 원장·직원, 직원 = 모드 버튼 없음(제목만). 폰 폭은 지금 모드 하나 「○○ 모드 ▾」(■0-6)
//  · 오른쪽: 큐브티워크 버튼(안 읽은 수 빨간 숫자) · 이름·소속 — 이름을 누르면 내 정보·로그아웃
// 사이드바 아래에 있던 큐브티워크·모드 전환·로그아웃 버튼은 여기로 옮겼다(관리자·원장·직원 사이드바 모두).
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ChevronDown, LogOut, User, Lightbulb } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { resetUserPrefs } from "@/components/prefs/useUserPrefs";
import { WorkUnreadBadge, resetWorkUnread } from "./WorkUnreadBadge";
import { useNavCounts, resetNavCounts } from "./useNavCounts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type Mode = "admin" | "manager" | "employee";
const MODES: { key: Mode; label: string; href: string; roles: string[] }[] = [
  { key: "admin", label: "관리자 모드", href: "/admin/dashboard", roles: ["ADMIN"] },
  { key: "manager", label: "원장 모드", href: "/manager/dashboard", roles: ["ADMIN", "MANAGER"] },
  { key: "employee", label: "직원 모드", href: "/dashboard", roles: ["ADMIN", "MANAGER"] },
];

export function TopBar({ mode, role, name, sub, menu, title }: {
  mode: Mode;
  role: string;
  name: string;
  sub?: string | null;      // 소속(지점·본부)
  menu?: ReactNode;         // 휴대폰 메뉴 버튼(서랍)
  title?: string;           // 모드 버튼이 없는 사람(직원)에게 보이는 제목
}) {
  const router = useRouter();
  const counts = useNavCounts();
  const modes = MODES.filter((m) => m.roles.includes(role));
  // 모드마다 내 차례 — 관리자·원장 = 결재함, 직원 = 내가 서명할 계약서(시안 v2 10번 「모드를 바꿔도 같게」)
  const pendingN = (m: Mode) => (m === "employee" ? (counts.mySign || 0) : m === "manager" && role === "MANAGER" ? (counts.approvals || 0) : m === "admin" ? (counts.approvals || 0) : 0);
  // 모드 옆 빨간 점(●)은 뜻을 알 수 없어 뺐다 — 「다른 모드」에 처리할 건이 있을 때만 인디고 건수로(2026-10-28 이예지 디자인 ①). 지금 모드 건수는 왼쪽 메뉴에 있다
  const modeCount = (m: Mode, cls = "ml-1") => {
    const n = m === mode ? 0 : pendingN(m);
    return n > 0 ? <span className={cn(cls, "min-w-[20px] shrink-0 rounded-full bg-[#eef2ff] px-1.5 text-center text-xs font-bold leading-5 text-[#4f46e5]")} aria-label={`처리할 건 ${n}건`}>{n > 99 ? "99+" : n}</span> : null;
  };
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    resetUserPrefs();   // 내 화면 설정 저장소 비움 — 같은 브라우저의 다음 사람에게 넘어가지 않게(#73)
    resetNavCounts();   // 메뉴 빨간 불 숫자도 — 다음 사람에게 앞사람 숫자가 잠깐 보이지 않게
    resetWorkUnread();  // 큐브티워크 안 읽은 수도(한 번 받은 값을 함께 쓰는 저장소라 남는다)
    router.push("/login");
    router.refresh();
  }
  return (
    // 고정(sticky)·z 를 주지 않는다 — 본문 스크롤은 창이 하고, z 를 주면 안에 든 휴대폰 서랍(z-50)이 그 아래에 갇혔다(검증)
    <div className="border-b border-gray-200 bg-white">
      <div className="flex items-center gap-2 px-3 md:px-6 h-14">
        {menu}
        {/* 폰 폭(sm 아래) — 지금 모드 하나만 「직원 모드 ▾」, 누르면 바꾸기(2026-10-23 본부 요청 ■0-6, 시안 S1 · S2 맨 위).
            세 칸이 다 들어가지 않아 「직원」이 화면 밖으로 잘리던 것. 누르는 자리는 44px 이상(■4) */}
        {modes.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="sm:hidden inline-flex min-h-11 min-w-0 items-center gap-1 rounded-lg px-2 text-[15px] font-bold text-indigo-700 outline-none hover:bg-indigo-50" aria-label="모드 바꾸기">
              <span className="truncate">{modes.find((m) => m.key === mode)?.label ?? "모드"}</span>
              {(() => { const n = modes.reduce((a, m) => a + (m.key === mode ? 0 : pendingN(m.key)), 0);
                return n > 0 ? <span className="min-w-[20px] shrink-0 rounded-full bg-[#eef2ff] px-1.5 text-center text-xs font-bold leading-5 text-[#4f46e5]" aria-label={`다른 모드에 처리할 건 ${n}건`}>{n > 99 ? "99+" : n}</span> : null; })()}
              <ChevronDown size={16} className="shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {modes.map((m) => (
                <DropdownMenuItem key={m.key} onClick={() => { if (m.key !== mode) router.push(m.href); }}
                  aria-current={m.key === mode ? "page" : undefined}
                  className={cn("min-h-11 text-[15px]", m.key === mode && "font-bold text-indigo-700")}>
                  {m.label}
                  {modeCount(m.key, "ml-auto")}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {modes.length > 1 ? (
          <nav className="hidden h-full min-w-0 items-stretch gap-1 overflow-x-auto sm:flex" aria-label="모드 전환">
            {modes.map((m) => (
              <Link key={m.key} href={m.href} aria-current={m.key === mode ? "page" : undefined}
                className={cn("flex shrink-0 items-center border-b-2 px-2.5 md:px-3 text-sm font-semibold whitespace-nowrap",
                  m.key === mode ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-800")}>
                {m.label}
                {modeCount(m.key)}
              </Link>
            ))}
          </nav>
        ) : (
          <h1 className="truncate text-base md:text-lg font-semibold text-gray-800">{title}</h1>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2">
          <Link href={role === "ADMIN" ? "/admin/suggestions" : "/suggestions"} className="hidden sm:inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100" title="개선 제안">
            <Lightbulb size={15} /><span className="hidden lg:inline">개선 제안</span>
          </Link>
          <a href="/work" className="inline-flex min-h-11 min-w-11 justify-center sm:min-h-0 sm:min-w-0 items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50/60 px-2.5 py-1.5 text-sm font-semibold text-gray-800 hover:bg-indigo-50">
            {/* 듀리 얼굴 20px(시안 듀리 아이콘 ⑤ — 말풍선 선 아이콘 대신) */}
            <Image src="/icons/duri-face-64.png" alt="" width={20} height={20} className="h-5 w-5" />
            <span className="hidden sm:inline">큐브티워크</span>
            <WorkUnreadBadge />
          </a>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex min-h-11 sm:min-h-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-100 outline-none">
              <span className="font-semibold text-gray-900 max-w-[4.5rem] sm:max-w-[7rem] truncate">{name}</span>
              {sub && <span className="hidden md:inline text-xs text-gray-500 max-w-[8rem] truncate">{sub}</span>}
              <ChevronDown size={14} className="text-gray-400" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => router.push("/profile")}><User size={15} className="mr-2" />내 정보</DropdownMenuItem>
              {/* 휴대폰은 위 개선 제안 버튼이 숨어 여기로(설정 패널에서 뺐다 — 재요청 H) */}
              <DropdownMenuItem onClick={() => router.push(role === "ADMIN" ? "/admin/suggestions" : "/suggestions")} className="sm:hidden"><Lightbulb size={15} className="mr-2" />개선 제안</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void logout()} className="text-red-600"><LogOut size={15} className="mr-2" />로그아웃</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
