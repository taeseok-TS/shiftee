"use client";

import { useEffect, useMemo, useState } from "react";
import { LEAVE_CATALOG, LEAVE_GROUPS, LEAVE_LABELS, applyLiveCatalog, registerExtraLeaveTypes, setHiddenLeaveTypes, type LeaveTypeInfo } from "@/lib/leave-catalog";

// 화면용 휴가 유형 기준표(2026-10-12 #216-1) — 기본 유형으로 먼저 그리고, GET /api/leave/types 로 본부가 만든 유형·숨김을 받아 덮는다.
// 이름표는 lib/leave-catalog 의 LEAVE_LABELS **객체 자체**를 채운다(복사본이 아니라) — 그래서 `= LEAVE_LABELS` 로 참조하는 화면은 다시 그려질 때 새 이름을 쓴다.
let fetched: Promise<LeaveTypeInfo[] | null> | null = null;
let cached: LeaveTypeInfo[] | null = null;
async function load(): Promise<LeaveTypeInfo[] | null> {
  if (cached) return cached;
  if (!fetched) fetched = fetch("/api/leave/types", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d?.all) return null;
    const all = (d.all as Array<Record<string, unknown>>).map((t) => ({
      code: String(t.code), label: String(t.label), group: t.group as LeaveTypeInfo["group"], unit: t.unit as LeaveTypeInfo["unit"],
      paidHours: Number(t.paidHours), deducts: !!t.deducts, attachRequired: (t.attachRequired as string | null) ?? undefined,
      notice: (t.notice as string | null) ?? undefined, selectable: !!t.selectable, custom: !!t.custom,
    }));
    Object.assign(LEAVE_LABELS, d.labels || {});
    applyLiveCatalog(all);
    // leaveInfo(code) 로 조회하는 화면(첨부 필수·안내 문구)도 본부 유형·숨김을 보게(485880f 검증 F1)
    registerExtraLeaveTypes(all.filter((t) => t.custom));
    setHiddenLeaveTypes(all.filter((t) => !t.custom && !t.selectable && LEAVE_CATALOG.find((b) => b.code === t.code)?.selectable).map((t) => t.code));
    cached = all;
    return all;
  }).catch(() => null).finally(() => { fetched = null; });
  return fetched;
}
/** 본부가 유형을 바꾼 뒤 다시 받게 */
export function resetLeaveCatalogCache(): void { cached = null; }

export function useLeaveCatalog() {
  const [catalog, setCatalog] = useState<LeaveTypeInfo[]>(cached ?? LEAVE_CATALOG);
  useEffect(() => {
    let stop = false;
    load().then((all) => { if (!stop && all) setCatalog(all); });
    return () => { stop = true; };
  }, []);
  const singleDay = useMemo(() => new Set(catalog.filter((t) => t.unit !== "FULL").map((t) => t.code)), [catalog]);
  const fixedDays = useMemo<Record<string, number>>(() => Object.fromEntries(catalog.filter((t) => t.unit !== "FULL").map((t) => [t.code, t.unit === "HALF" ? 0.5 : 0.25])), [catalog]);
  const nonDeduct = useMemo(() => new Set(catalog.filter((t) => !t.deducts).map((t) => t.code)), [catalog]);
  const labels = useMemo<Record<string, string>>(() => ({ ...LEAVE_LABELS, ...Object.fromEntries(catalog.map((t) => [t.code, t.label])) }), [catalog]);
  return { catalog, labels, singleDay, fixedDays, nonDeduct, groups: LEAVE_GROUPS };
}
