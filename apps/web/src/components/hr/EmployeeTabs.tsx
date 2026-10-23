"use client";
// 인사 › 직원 머리 + 알약 탭 한 줄(2026-10-21 본부 시안 R14) — 옛 위 탭(관리 · 현황 · 입사일 대조 · 인원명부 연동)을 화면 안 알약 한 줄로.
// 네 화면(직원 · 직원 현황 · 입사일 대조 · 인원명부 연동)이 같이 쓰고, 탭은 각자 주소로 간다. 입사일 대조는 확인 필요 건수(빨강)
import { useEffect, useState, useSyncExternalStore } from "react";
import { PageHead, PillTabs, type PillTab } from "@/components/kit";

export type EmployeeTab = "list" | "stats" | "hire" | "sync";

/** 입사일 확인 필요 = 입사일 대조와 같은 기준(hireNeedsCheck). 재직자 중 입사일이 비었거나,
 *  포털 명부 입사일이 반영 대상(7월 이후 입사자 — portalEditable)이고 큐브티와 다르며 아직 확정(「유지」 등)하지 않은 사람. */
export type HireRow = { cubetee: string | null; portal: string | null; portalEditable: boolean | null; confirmed: string | null; resigned: boolean };
export const hireNeedsCheck = (r: HireRow) =>
  !r.resigned && (!r.cubetee || (!!r.portal && r.portalEditable !== false && r.portal !== r.cubetee && r.confirmed !== r.cubetee));

// 건수는 네 화면이 한 번 받은 값을 함께 쓴다 — /api/admin/hire-dates 는 바깥 명부를 통째로 읽어 무겁다(1분 동안 다시 묻지 않는다).
// 포털을 못 읽으면(portalError) 건수를 모른다(null — 숫자 칸은 「—」, 탭 건수는 없음)
let hireCount: number | null = null;
let hireAt = 0;
let hireBusy = false;
let hireAgain = false;   // 받는 중에 강제 새로 받기가 오면 끝난 뒤 한 번 더(반영 직후 옛 숫자로 끝나지 않게)
const subs = new Set<() => void>();
/** 대조표가 이미 받은 줄로 바로 채운다(같은 무거운 요청을 두 번 보내지 않게) */
export function setHireRows(rows: HireRow[] | null, portalError: string | null) {
  hireAt = Date.now();
  hireCount = rows && !portalError ? rows.filter(hireNeedsCheck).length : null;
  subs.forEach((f) => f());
}
export function refreshHireCount(force = false) {
  if (hireBusy) { if (force) hireAgain = true; return; }
  if (!force && Date.now() - hireAt < 60_000) return;
  hireBusy = true;
  fetch("/api/admin/hire-dates").then((r) => (r.ok ? r.json() : null)).then((d) => {
    setHireRows(d?.rows ?? null, d ? d.portalError ?? null : "불러오지 못함");
  }).catch(() => {}).finally(() => {
    hireBusy = false;
    if (hireAgain) { hireAgain = false; refreshHireCount(true); }
  });
}
function subscribe(f: () => void) { subs.add(f); refreshHireCount(); return () => { subs.delete(f); }; }
export function useHireCheckCount(): number | null {
  return useSyncExternalStore(subscribe, () => hireCount, () => null);
}

/** 메인(최고) 관리자인가 — 「입사일 대조」 · 「인원명부 연동」은 최고 관리자에게만(2026-10-23 본부 요청 ■3, 이관 작업용 화면).
 *  모르는 동안(받는 중 · 실패)은 false — 숨기는 쪽으로. 화면 자체는 각 layout 이 서버에서 다시 막는다 */
export function useIsSuperAdmin(): boolean {
  const [isSuper, setIsSuper] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setIsSuper(!!d?.user?.isSuperAdmin); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return isSuper;
}

export default function EmployeeTabs({ active, note, children }: { active: EmployeeTab; note?: React.ReactNode; children?: React.ReactNode }) {
  const hire = useHireCheckCount();
  const isSuper = useIsSuperAdmin();
  const tabs: PillTab[] = [
    { key: "list", label: "관리", href: "/admin/employees" },
    { key: "stats", label: "현황", href: "/admin/employee-stats" },
    ...(isSuper ? [
      { key: "hire", label: "입사일 대조", href: "/admin/hire-dates", count: hire, hot: true },
      { key: "sync", label: "인원명부 연동", href: "/admin/portal-sync" },
    ] : []),
  ];
  return (
    <>
      <PageHead crumb="인사 › 직원" title="직원" note={note}>{children}</PageHead>
      <PillTabs tabs={tabs} value={active} />
    </>
  );
}
