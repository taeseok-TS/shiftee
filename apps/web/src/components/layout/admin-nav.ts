// 관리자 메뉴 정의 — 왼쪽 레일(대분류 7)·흰 패널(메뉴)·화면 안 탭이 이 한 곳을 본다(2026-10-20 본부 박정인 시안 v2 8번, 23개 → 14개).
// 비슷한 화면은 메뉴 하나로 묶고 세부는 그 화면 위 탭으로 옮겼다 — 주소는 그대로라 북마크·알림 링크가 깨지지 않는다.
// 새 관리자 화면을 만들면: 메뉴로 둘지(items) 기존 메뉴의 탭으로 둘지(tabs)를 정해 여기에 넣는다. 빠지면 레일·패널 어디에도 안 보인다.
import type { ComponentType } from "react";
import {
  LayoutDashboard, Clock, CheckCircle, FileSignature, UmbrellaOff, Users, SlidersHorizontal,
  Calendar, BarChart3, GitBranch, Send, FileText, Building2, ShieldCheck, CalendarDays, History,
  Settings, Lightbulb, Wrench, Wallet,
} from "lucide-react";

export type Icon = ComponentType<{ size?: number; className?: string }>;
/** 화면 위 탭 하나 — href 는 실제 주소(쿼리 포함 가능) */
export type NavTab = { href: string; label: string };
/** 패널 메뉴 하나 — tabs 가 있으면 그 탭 주소들에서도 이 메뉴가 켜진다 */
// also = 메뉴·탭엔 없지만 이 메뉴에서 들어가는 화면 · hidden = 패널엔 안 보이고 메뉴 찾기·주소 맞춤에만(다른 곳에 버튼이 있는 화면) · dim = 패널 맨 아래 옅게
// find = 메뉴 찾기에만 나오는 화면 안 알약 탭(위 탭 줄은 그리지 않는다 — 시안 R11·R13 「탭 한 줄」. tabs 와 달리 주소 맞춤에도 안 쓴다)
// salaryOnly = 「연봉 보기」 권한자(메인 관리자·켠 관리자)에게만 보인다(2026-10-22 디렉터, lib/salary-access)
export type NavItem = { href: string; label: string; icon: Icon; tabs?: NavTab[]; find?: NavTab[]; superOnly?: boolean; salaryOnly?: boolean; countKey?: string; also?: string[]; hidden?: boolean; dim?: boolean };
export type NavGroup = { key: string; title: string; icon: Icon; href?: string; items: NavItem[] };

export const ADMIN_NAV: NavGroup[] = [
  { key: "dashboard", title: "대시보드", icon: LayoutDashboard, href: "/admin/dashboard", items: [] },
  { key: "attendance", title: "근태", icon: Clock, items: [
    // 탭은 화면 안 알약 한 줄로(R10 — components/attendance/AttendanceTabs)
    { href: "/admin/attendance", label: "출퇴근 현황", icon: Clock, also: ["/admin/attendance-board"],
      find: [
        { href: "/admin/attendance-board", label: "달력 · 목록(출퇴근기록)" },
        { href: "/admin/attendance?tab=stats", label: "기간별 통계" },
        { href: "/admin/attendance?tab=weekend", label: "주말 근무 엑셀" },
      ] },
    { href: "/admin/schedule", label: "근무일정", icon: Calendar, tabs: [
      { href: "/admin/schedule", label: "근무일정" },
      { href: "/admin/schedule-templates", label: "근무일정 템플릿" },
    ] },
    { href: "/admin/work-report", label: "근로시간 리포트", icon: BarChart3 },
  ] },
  { key: "approval", title: "결재", icon: CheckCircle, items: [
    { href: "/admin/leave-approvals", label: "결재함", icon: CheckCircle, countKey: "approvals",
      // 위 탭 대신 화면 안 알약 한 줄(시안 R11 — components/approvals/ApprovalsHeader). 계약·처리한 요청 주소도 이 메뉴로 켠다
      also: ["/admin/contract-approvals", "/admin/requests"],
      find: [
        { href: "/admin/leave-approvals?tab=leave", label: "휴가" },
        { href: "/admin/leave-approvals?tab=schedule", label: "근무일정" },
        { href: "/admin/leave-approvals?tab=contract", label: "계약" },
        { href: "/admin/leave-approvals?tab=cancel", label: "휴가 취소" },
        { href: "/admin/leave-approvals?tab=attendance", label: "출퇴근 요청" },
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
    // 탭은 화면 안 알약 한 줄로(R13 — 「휴가 유형」 포함)
    { href: "/admin/leave", label: "휴가 관리", icon: UmbrellaOff, countKey: "leavePending", also: ["/admin/leave-ledger", "/admin/leave-types"],
      find: [
        { href: "/admin/leave?tab=balance", label: "직원별 잔여" },
        { href: "/admin/leave?tab=grants", label: "종류별 잔여" },
        { href: "/admin/leave?tab=report", label: "휴가 리포트" },
        { href: "/admin/leave?tab=settlement", label: "연차 정산" },
        { href: "/admin/leave?tab=import", label: "휴가 가져오기" },
        { href: "/admin/leave-types", label: "휴가 유형" },
      ] },
  ] },
  { key: "hr", title: "인사", icon: Users, items: [
    // 탭은 화면 안 알약 한 줄로(R14 — components/hr/EmployeeTabs)
    { href: "/admin/employees", label: "직원", icon: Users, also: ["/admin/employee-stats", "/admin/hire-dates", "/admin/portal-sync"],
      find: [
        { href: "/admin/employee-stats", label: "현황" },
        { href: "/admin/hire-dates", label: "입사일 대조" },
        { href: "/admin/portal-sync", label: "인원명부 연동" },
      ] },
    { href: "/admin/branches", label: "지점 관리", icon: Building2 },
    { href: "/admin/salary", label: "연봉", icon: Wallet, salaryOnly: true },
  ] },
  { key: "settings", title: "설정", icon: SlidersHorizontal, items: [
    { href: "/admin/permissions", label: "권한 설정", icon: ShieldCheck },
    { href: "/admin/attendance-rules", label: "근태 규칙", icon: Clock },
    { href: "/admin/holidays", label: "공휴일", icon: CalendarDays },
    { href: "/admin/audit", label: "변경 로그", icon: History },
    { href: "/admin/settings", label: "환경설정", icon: Settings, superOnly: true, also: ["/admin/storage", "/admin/system-logs"] },
    // 개선 제안은 상단 바(휴대폰은 이름 메뉴)에 있어 패널에서 뺀다 — 메뉴 찾기로는 찾힌다(2026-10-21 본부 이예지 재요청 H)
    { href: "/admin/suggestions", label: "개선 제안", icon: Lightbulb, hidden: true },
    // 운영 도구 넷은 「개발자」 한 메뉴의 탭으로 묶어 맨 아래 옅게(재요청 H)
    { href: "/admin/emoticons", label: "개발자", icon: Wrench, dim: true, tabs: [
      { href: "/admin/emoticons", label: "이모티콘 관리" },
      { href: "/admin/bot", label: "봇 브리핑" },
      { href: "/admin/api-keys", label: "API 키" },
      { href: "/admin/test-api", label: "API 테스트" },
    ] },
  ] },
];

const pathOf = (href: string) => href.split("?")[0];
/** 대분류의 첫 화면 — 레일을 누르면 여기로 바로 간다(재요청 A: 패널만 바뀌고 본문은 그대로면 「안 눌렸다」고 느낀다) */
export const groupHome = (g: NavGroup) => g.href ?? g.items.find((it) => !it.hidden && !it.superOnly)?.href ?? "/admin/dashboard";
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
