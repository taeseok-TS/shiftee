// 원장 · 직원 모드 메뉴(2026-10-21 본부 시안 R8 — 관리자와 같은 레일 + 흰 패널). 대분류 순서는 세 모드 모두
// 대시보드 · 근태 · 결재 · 전자계약 · 휴가 · 인사 · 설정, 그 모드에서 안 쓰는 대분류만 뺀다. 옛 주소는 그대로(알림 · 즐겨찾기 링크가 안 깨지게).
// 원장 모드는 「팀」이라는 말을 쓰지 않는다 — 모두 「지점」.
import {
  LayoutDashboard, Clock, CheckCircle, FileSignature, UmbrellaOff, Users, SlidersHorizontal,
  Calendar, BarChart3, Settings, Inbox, Lightbulb, User,
} from "lucide-react";
import type { NavGroup } from "./admin-nav";

export const MANAGER_NAV: NavGroup[] = [
  { key: "dashboard", title: "대시보드", icon: LayoutDashboard, href: "/manager/dashboard", items: [] },
  { key: "attendance", title: "근태", icon: Clock, items: [
    { href: "/manager/team-attendance", label: "지점 출퇴근기록", icon: Clock, needs: "manager.viewAttendance" },
    { href: "/manager/team-schedule", label: "지점 근무일정", icon: Calendar },
    { href: "/manager/work-report", label: "근로시간 리포트", icon: BarChart3, needs: "manager.viewAttendance" },
  ] },
  { key: "approval", title: "결재", icon: CheckCircle, items: [
    // 원장 차례인 지점 휴가 · 근무일정 · 휴가 취소 · 출퇴근 요청(옛 「팀 휴가」 결재 화면). 처리한 요청은 그 화면 · 메뉴 찾기로
    { href: "/manager/team-leave", label: "결재함", icon: CheckCircle, countKey: "leaveInbox",
      find: [
        { href: "/manager/team-leave?tab=schedule", label: "근무일정" },
        { href: "/manager/team-leave?tab=cancel", label: "휴가 취소" },
        { href: "/manager/team-leave?tab=attendance", label: "출퇴근 요청" },
        { href: "/requests?who=decided", label: "처리한 요청" },
      ] },
  ] },
  { key: "contract", title: "전자계약", icon: FileSignature, items: [
    { href: "/manager/team-contracts", label: "지점 계약서", icon: FileSignature, countKey: "contractSign" },
  ] },
  { key: "leave", title: "휴가", icon: UmbrellaOff, items: [
    // 지점 직원 휴가 내역 — 결재 화면의 「휴가 내역」 탭(쿼리 메뉴 — 쿼리가 같을 때 이 메뉴가 켜진다)
    { href: "/manager/team-leave?tab=history", label: "지점 휴가", icon: UmbrellaOff, also: ["/manager/leave-ledger"] },
  ] },
  { key: "hr", title: "인사", icon: Users, items: [
    { href: "/manager/team-employees", label: "지점 직원", icon: Users },
  ] },
  { key: "settings", title: "설정", icon: SlidersHorizontal, items: [
    { href: "/manager/settings", label: "환경설정", icon: Settings },
  ] },
];

export const EMPLOYEE_NAV: NavGroup[] = [
  { key: "dashboard", title: "대시보드", icon: LayoutDashboard, href: "/dashboard", items: [] },
  { key: "attendance", title: "근태", icon: Clock, items: [
    // 직원은 본부가 「본인 출퇴근 기록 열람(웹)」을 켠 경우에만(권한 설정 #39) — 관리자 · 원장은 늘
    { href: "/attendance", label: "내 출퇴근", icon: Clock, needs: "employee.viewOwnAttendance" },
    { href: "/schedule", label: "근무일정", icon: Calendar },
  ] },
  { key: "approval", title: "결재", icon: CheckCircle, items: [
    { href: "/requests", label: "내 요청", icon: Inbox },
    // 원장대행으로 지정된 직원에게만(2026-10-07)
    { href: "/approvals", label: "결재(원장대행)", icon: CheckCircle, countKey: "leaveInbox", delegateOnly: true },
  ] },
  { key: "contract", title: "전자계약", icon: FileSignature, items: [
    { href: "/contracts", label: "내 계약서", icon: FileSignature, countKey: "mySign" },
  ] },
  { key: "leave", title: "휴가", icon: UmbrellaOff, items: [
    { href: "/leave", label: "내 휴가", icon: UmbrellaOff },
  ] },
  { key: "settings", title: "설정", icon: SlidersHorizontal, items: [
    { href: "/settings", label: "환경설정", icon: Settings },
    // 패널에서는 뺀다 — 개선 제안은 상단 바, 내 정보는 상단 바 이름(R8 4-2). 메뉴 찾기 · 주소 맞춤에만
    { href: "/suggestions", label: "개선 제안", icon: Lightbulb, hidden: true },
    { href: "/profile", label: "내 정보", icon: User, hidden: true },
  ] },
];
