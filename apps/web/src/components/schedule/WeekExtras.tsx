"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * 근무일정 주간 표 공용(2026-10-07 QA 묶음 5-다) — 관리자 근무일정 표와 원장 팀 일정 표가 같이 쓴다.
 *  · #61 useWeekLeaves / <LeaveChips>: 그 주 승인된 휴가를 칸에 함께. 「휴가 표시」 켜기·끄기는 이 브라우저에 기억
 *  · #74 useBranchColors: 지점마다 색 — 지점이 만들어진 순서로 고정 배정(새 지점은 다음 색, 이름을 바꿔도 그대로)
 *  · #40 empNoText: 사번 5자리
 */

export const empNoText = (n: number | null | undefined) => (n == null ? "" : String(n).padStart(5, "0"));

// ── #61 휴가 표시 ──
type WeekLeaves = { monday: string; leaves: Record<string, Record<string, { type: string; label: string }[]>> };

const SHOW_LEAVE_KEY = "schedule.showLeave";
const showLeaveSubs = new Set<() => void>();
function readShowLeave(): boolean {
  try { return window.localStorage.getItem(SHOW_LEAVE_KEY) !== "0"; } catch { return true; }
}
/** 「휴가 표시」 — 기본 켜짐, 이 브라우저에 기억(저장 못 하는 환경이면 이번 화면에서만) */
export function useShowLeave(): [boolean, (v: boolean) => void] {
  const [fallback, setFallback] = useState<boolean | null>(null);
  const stored = useSyncExternalStore(
    (cb) => { showLeaveSubs.add(cb); return () => { showLeaveSubs.delete(cb); }; },
    readShowLeave,
    () => true,
  );
  const set = (v: boolean) => {
    try { window.localStorage.setItem(SHOW_LEAVE_KEY, v ? "1" : "0"); } catch { setFallback(v); }
    showLeaveSubs.forEach((cb) => cb());
  };
  return [fallback ?? stored, set];
}

export function useWeekLeaves(monday: string, enabled: boolean, reloadKey = 0) {
  const [data, setData] = useState<WeekLeaves | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch(`/api/schedule/week-leaves?week=${monday}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [monday, enabled, reloadKey]);
  return enabled && data && data.monday === monday ? data : null;   // 다른 주 응답은 쓰지 않는다
}

export function LeaveChips({ data, userId, date }: { data: WeekLeaves | null; userId: string; date: string }) {
  const list = data?.leaves[userId]?.[date];
  if (!list?.length) return null;
  return (
    <div className="space-y-1 mb-1">
      {list.map((l, i) => (
        <div key={i} className="px-2 py-1 rounded bg-green-100 border border-green-300 text-[11px] font-medium text-green-800">
          {l.label}
        </div>
      ))}
    </div>
  );
}

// ── #74 지점 색 ──
const PALETTE = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5",
  "#0d9488", "#be123c", "#ca8a04", "#9333ea", "#0284c7", "#c2410c", "#15803d", "#a21caf", "#475569", "#b45309",
];

/** 지점명 → 색. 지점이 만들어진 순서대로 팔레트를 돌린다(20개 넘으면 다시 처음부터) */
export function useBranchColors(): (branch: string | null | undefined) => string | undefined {
  const [map, setMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    fetch("/api/branches")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        const list: { name: string; createdAt?: string }[] = Array.isArray(d) ? d : d.branches ?? [];
        const sorted = [...list].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.name.localeCompare(b.name));
        setMap(new Map(sorted.map((b, i) => [b.name, PALETTE[i % PALETTE.length]])));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return (branch) => (branch ? map.get(branch) : undefined);
}

// ── #40 주간 합계 열 ──
type WeekHours = { monday: string; limitMin: number; hours: Record<string, { sched: number; actual: number }> };

export function WeekTotalCell({ data, userId }: { data: WeekHours | null; userId: string }) {
  const wh = data?.hours[userId];
  const h = (m: number) => `${Math.round(m / 6) / 10}h`;
  const over = !!data && !!wh && (wh.sched > data.limitMin || wh.actual > data.limitMin);
  return (
    <div className={`w-28 flex-shrink-0 p-3 text-xs ${over ? "bg-red-50 text-red-700 font-semibold" : "bg-gray-50 text-gray-700"}`}
      title="이번 주 근로시간(휴게 제외) — 49시간을 넘으면 빨간색">
      <div>일정 {h(wh?.sched ?? 0)}</div>
      <div className="mt-0.5">실제 {h(wh?.actual ?? 0)}</div>
      {over && <div className="mt-0.5">⚠49h 초과</div>}
    </div>
  );
}
