// 관리자 메뉴 정의 — 왼쪽 레일(대분류 7)·흰 패널(메뉴)·화면 안 탭이 이 한 곳을 본다(2026-10-20 본부 박정인 시안 v2 8번, 23개 → 14개).
// 비슷한 화면은 메뉴 하나로 묶고 세부는 그 화면 위 탭으로 옮겼다 — 주소는 그대로라 북마크·알림 링크가 깨지지 않는다.
// 새 관리자 화면을 만들면: 메뉴로 둘지(items) 기존 메뉴의 탭으로 둘지(tabs)를 정해 여기에 넣는다. 빠지면 레일·패널 어디에도 안 보인다.
import type { ComponentType } from "react";
import {
  LayoutDashboard, Clock, CheckCircle, FileSignature, UmbrellaOff, Users, SlidersHorizontal,
  Calendar, BarChart3, GitBranch, Send, FileText, Building2, ShieldCheck, CalendarDays, History,
  Sticker, Bot, Zap, Settings, Lightbulb,
} from "lucide-react";

export type Icon = ComponentType<{ size?: number; className?: string }>;
/** 화면 위 탭 하나 — href 는 실제 주소(쿼리 포함 가능) */
export type NavTab = { href: string; label: string };
/** 패널 메뉴 하나 — tabs 가 있으면 그 탭 주소들에서도 이 메뉴가 켜진다 */
export type NavItem = { href: string; label: string; icon: Icon; tabs?: NavTab[]; superOnly?: boolean; countKey?: string; also?: string[] };   // also = 메뉴·탭엔 없지만 이 메뉴에서 들어가는 화면
export type NavGroup = { key: string; title: string; icon: Icon; href?: string; items: NavItem[] };

export const ADMIN_NAV: NavGroup[] = [
  { key: "dashboard", title: "대시보드", icon: LayoutDashboard, href: "/admin/dashboard", items: [] },
  { key: "attendance", title: "근태", icon: Clock, items: [
    { href: "/admin/attendance", label: "출퇴근 현황", icon: Clock, tabs: [
      { href: "/admin/attendance", label: "출퇴근" },
      { href: "/admin/attendance-board", label: "출퇴근기록 (달력·목록)" },
    ] },
    { href: "/admin/schedule", label: "근무일정", icon: Calendar, tabs: [
      { href: "/admin/schedule", label: "근무일정" },
      { href: "/admin/schedule-templates", label: "근무일정 템플릿" },
    ] },
    { href: "/admin/work-report", label: "근로시간 리포트", icon: BarChart3 },
  ] },
  { key: "approval", title: "결재", icon: CheckCircle, items: [
    { href: "/admin/leave-approvals", label: "결재함", icon: CheckCircle, countKey: "approvals", tabs: [
      { href: "/admin/leave-approvals", label: "휴가 · 근무일정" },
      { href: "/admin/contract-approvals", label: "계약" },
      { href: "/admin/requests?who=decided", label: "처리한 요청" },
    ] },
    { href: "/admin/approval-rules", label: "결재 규칙", icon: GitBranch },
  ] },
  { key: "contract", title: "전자계약", icon: FileSignature, items: [
    { href: "/admin/contracts/send", label: "계약서 보내기", icon: Send },
    { href: "/admin/contracts", label: "보낸 계약서", icon: FileSignature, countKey: "contractsOpen", tabs: [
      { href: "/admin/contracts", label: "보낸 계약서" },
      { href: "/admin/contract-import", label: "체결본 가져오기" },
    ] },
    { href: "/admin/contract-templates", label: "양식 관리", icon: FileText, countKey: "templates", tabs: [
      { href: "/admin/contract-templates", label: "양식" },
      { href: "/admin/route-course", label: "루트코스 일정" },
    ] },
  ] },
  { key: "leave", title: "휴가", icon: UmbrellaOff, items: [
    { href: "/admin/leave", label: "휴가 관리", icon: UmbrellaOff, countKey: "leavePending", also: ["/admin/leave-ledger"], tabs: [
      { href: "/admin/leave", label: "휴가 관리" },
      { href: "/admin/leave-types", label: "휴가 유형" },
    ] },
  ] },
  { key: "hr", title: "인사", icon: Users, items: [
    { href: "/admin/employees", label: "직원", icon: Users, tabs: [
      { href: "/admin/employees", label: "관리" },
      { href: "/admin/employee-stats", label: "현황" },
      { href: "/admin/hire-dates", label: "입사일 대조" },
      { href: "/admin/portal-sync", label: "인원명부 연동" },
    ] },
    { href: "/admin/branches", label: "지점 관리", icon: Building2 },
  ] },
  { key: "settings", title: "설정", icon: SlidersHorizontal, items: [
    { href: "/admin/permissions", label: "권한 설정", icon: ShieldCheck },
    { href: "/admin/attendance-rules", label: "근태 규칙", icon: Clock },
    { href: "/admin/holidays", label: "공휴일", icon: CalendarDays },
    { href: "/admin/audit", label: "변경 로그", icon: History },
    { href: "/admin/suggestions", label: "개선 제안", icon: Lightbulb },   // 상단 바에도 있다 — 휴대폰 서랍·메뉴 찾기에서도 찾게
    // 시안 예시(14개) 밖의 운영 도구 — 빼면 들어갈 길이 없어 설정 아래에 둔다
    { href: "/admin/emoticons", label: "이모티콘 관리", icon: Sticker },
    { href: "/admin/bot", label: "봇 브리핑", icon: Bot },
    { href: "/admin/api-keys", label: "API 키", icon: Zap },
    { href: "/admin/test-api", label: "API 테스트", icon: Zap },
    { href: "/admin/settings", label: "환경설정", icon: Settings, superOnly: true, also: ["/admin/storage", "/admin/system-logs"] },
  ] },
];

const pathOf = (href: string) => href.split("?")[0];
/** 메뉴가 켜지는 주소들(자기 + 탭) */
export const itemPaths = (it: NavItem) => [...new Set([pathOf(it.href), ...(it.tabs || []).map((t) => pathOf(t.href)), ...(it.also || [])])];
const ALL = ADMIN_NAV.flatMap((g) => (g.href ? [{ g, it: null as NavItem | null, p: pathOf(g.href) }] : [])).concat(
  ADMIN_NAV.flatMap((g) => g.items.flatMap((it) => itemPaths(it).map((p) => ({ g, it: it as NavItem | null, p })))),
);
/** 지금 주소에 맞는 대분류·메뉴 — 가장 길게 맞는 주소(「/admin/contracts/send」에서 「보낸 계약서(/admin/contracts)」가 켜지지 않게) */
export function matchNav(pathname: string): { group: NavGroup | null; item: NavItem | null; path: string | null } {
  const hit = ALL.filter((x) => pathname === x.p || pathname.startsWith(x.p + "/")).sort((a, b) => b.p.length - a.p.length)[0];
  return hit ? { group: hit.g, item: hit.it, path: hit.p } : { group: null, item: null, path: null };
}
