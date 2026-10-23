"use client";

// 직원 왼쪽 메뉴 — 관리자와 같은 레일 + 흰 패널(2026-10-21 본부 시안 R8, 옛 한 줄 메뉴 · 파랑 「E」 · 파랑 선택 대신). 메뉴 정의는 mode-nav
//  · 「내 출퇴근」 = 관리자 · 원장은 늘, 직원은 본부가 「본인 출퇴근 기록 열람(웹)」을 켠 경우에만(권한 설정 #39)
//  · 「결재(원장대행)」 = 원장대행으로 지정된 직원에게만(2026-10-07) — 원장 · 관리자는 각자 모드의 결재함을 쓴다
import { useEffect, useMemo, useState } from "react";
import { RailSidebar } from "./RailSidebar";
import { EMPLOYEE_NAV } from "./mode-nav";

export function SharedSidebar({ role }: { role?: string }) {
  const [delegateBranches, setDelegateBranches] = useState<string[]>([]);
  const [selfAttendance, setSelfAttendance] = useState(false);
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
  const staff = role === "ADMIN" || role === "MANAGER";
  const nav = useMemo(() => EMPLOYEE_NAV.map((g) => ({
    ...g,
    items: g.items
      .filter((it) => !it.needs || staff || selfAttendance)
      .filter((it) => !it.delegateOnly || delegateBranches.length > 0)
      .map((it) => (it.delegateOnly ? { ...it, label: `결재(원장대행 · ${delegateBranches.join(", ")})` } : it)),
  })).filter((g) => g.href || g.items.some((it) => !it.hidden)), [staff, selfAttendance, delegateBranches]);
  return <RailSidebar nav={nav} letter="E" home="/dashboard" system="직원 시스템" />;
}
