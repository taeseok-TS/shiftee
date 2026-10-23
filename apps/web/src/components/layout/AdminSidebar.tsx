"use client";

// 관리자 왼쪽 메뉴 — 레일 + 흰 패널(RailSidebar). 메뉴 정의는 admin-nav, 메인 관리자 전용 · 「연봉 보기」 권한 메뉴만 여기서 거른다
import { useMemo } from "react";
import { RailSidebar } from "./RailSidebar";
import { ADMIN_NAV } from "./admin-nav";

export function AdminSidebar({ isSuperAdmin = false, canViewSalary = false }: { isSuperAdmin?: boolean; canViewSalary?: boolean }) {
  const nav = useMemo(() => ADMIN_NAV.map((g) => ({ ...g, items: g.items.filter((it) => (!it.superOnly || isSuperAdmin) && (!it.salaryOnly || canViewSalary)) })), [isSuperAdmin, canViewSalary]);
  return <RailSidebar nav={nav} letter="A" home="/admin/dashboard" system="관리자 시스템" />;
}
