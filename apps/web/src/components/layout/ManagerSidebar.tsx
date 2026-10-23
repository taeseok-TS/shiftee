"use client";

// 원장 왼쪽 메뉴 — 관리자와 같은 레일 + 흰 패널(2026-10-21 본부 시안 R8, 옛 한 줄 메뉴 · 주황 「M」 · 주황 선택 대신). 메뉴 정의는 mode-nav
// 원장 권한 토글(#39)이 꺼진 메뉴는 숨긴다(실제 차단은 API 가 한다). 읽기 전엔 모두 보여 준다
import { useEffect, useMemo, useState } from "react";
import { RailSidebar } from "./RailSidebar";
import { MANAGER_NAV } from "./mode-nav";

export function ManagerSidebar() {
  const [perms, setPerms] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/me/permissions").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.permissions) setPerms(d.permissions); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const nav = useMemo(() => MANAGER_NAV.map((g) => ({ ...g, items: g.items.filter((it) => !it.needs || !perms || perms[it.needs] !== false) }))
    .filter((g) => g.href || g.items.length), [perms]);
  return <RailSidebar nav={nav} letter="M" home="/manager/dashboard" system="원장 관리 시스템" />;
}
