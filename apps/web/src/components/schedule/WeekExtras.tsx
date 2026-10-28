"use client";

import { useEffect, useState } from "react";
import { week52Of, type WeekHours } from "@/components/schedule/WeekHours";

/**
 * 근무일정 주간 표 공용(2026-10-07 QA 묶음 5-다) — 관리자 근무일정 표와 원장 팀 일정 표가 같이 쓴다.
 *  · #61 useRangeLeaves: 기간의 휴가(승인 · 결재 대기)와 결재 대기 근무 변경 — 표(ScheduleBoard)가 칸에 그린다
 *  · #74 useBranchColors: 지점마다 색 — 지점이 만들어진 순서로 배정(새 지점은 다음 색, 이름을 바꿔도 그대로.
 *    지점을 비활성화하면 그 뒤에 만든 지점 색이 한 칸씩 당겨진다)
 *  · #40 empNoText: 사번 5자리
 */

export const empNoText = (n: number | null | undefined) => (n == null ? "" : String(n).padStart(5, "0"));

// ── #61 휴가 표시 ──
// unit: FULL 하루 · HALF 반차 · QUARTER 반반차(2026-10-23 ■0-5 — 하루 휴가인 날은 표가 근무 대신 휴가만 그린다). 옛 응답(unit 없음)은 하루로 본다
export type DayLeave = { type: string; label: string; unit?: string };
/** 결재 대기 근무 변경 요청 한 날(■4 점선 테두리) — kind: CREATE · UPDATE · DELETE */
export type PendingSchedule = { startTime: string | null; endTime: string | null; kind: string };
export type RangeLeaves = {
  from: string; to: string;
  leaves: Record<string, Record<string, DayLeave[]>>;                       // 승인된 휴가
  pendingLeaves?: Record<string, Record<string, DayLeave[]>>;               // 결재 대기 휴가
  pendingSchedules?: Record<string, Record<string, PendingSchedule>>;       // 결재 대기 근무 변경
};

/** 기간(start~end, yyyy-MM-dd, 62일까지)에 걸친 휴가(승인 · 결재 대기)와 결재 대기 근무 변경 — 일·주·월 보기(#71)가 같은 훅을 쓴다 */
export function useRangeLeaves(start: string, end: string, enabled: boolean, reloadKey = 0) {
  const [data, setData] = useState<RangeLeaves | null>(null);
  useEffect(() => {
    if (!enabled || !start || !end) return;
    let alive = true;
    fetch(`/api/schedule/week-leaves?start=${start}&end=${end}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [start, end, enabled, reloadKey]);
  return enabled && data && data.from === start && data.to === end ? data : null;   // 다른 기간 응답은 쓰지 않는다
}

// ── #74 지점 색 ──
// 회색 바탕 위 작은 글씨로도 읽히게 진한 색만(WCAG AA 4.5:1 이상)
const PALETTE = [
  "#1d4ed8", "#b91c1c", "#15803d", "#b45309", "#6d28d9", "#0e7490", "#be185d", "#4d7c0f", "#c2410c", "#4338ca",
  "#0f766e", "#9f1239", "#854d0e", "#7e22ce", "#0369a1", "#065f46", "#a21caf", "#475569", "#57534e", "#1e3a8a",
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
// 주 근무시간 숫자는 본부만(2026-10-23 ■0-11) — 서버가 숨기면(hoursHidden) 숫자 대신 「52시간 안 / 넘음」만

export function WeekTotalCell({ data, userId }: { data: WeekHours | null; userId: string }) {
  if (!data) return null;
  const wh = data.hours[userId];
  // 숫자를 숨긴 응답(원장)이면 일정 기준 「주 52시간 안 / 넘음」만
  if (data.hoursHidden) {
    const w = week52Of(wh);
    if (!w) return null;
    return (
      <div className={`flex h-full flex-col justify-center px-3 text-[12px] leading-snug ${w === "OVER_52" ? "bg-[#fff1f2] font-semibold text-[#be123c]" : "text-[#475569]"}`}
        title="이번 주 일정 기준(휴게 제외)">
        {w === "OVER_52" ? "52시간 넘음" : "52시간 안"}
      </div>
    );
  }
  const h = (m: number) => { const t = Math.round(m); return `${Math.floor(t / 60)}시간${t % 60 ? ` ${t % 60}분` : ""}`; };   // 「18시간 20분」(18.3h 대신 — 이예지 10/28 디자인 ④)
  const over = !!wh && (wh.sched > data.limitMin || wh.actual > data.limitMin);
  return (
    <div className={`flex h-full flex-col justify-center px-3 text-[12px] leading-snug ${over ? "bg-[#fff1f2] font-semibold text-[#be123c]" : "text-[#475569]"}`}
      title="이번 주 근로시간(휴게 제외) — 49시간을 넘으면 빨간색">
      <div>일정 {h(wh?.sched ?? 0)}</div>
      {!data.actualHidden && <div>실제 {h(wh?.actual ?? 0)}</div>}
      {over && <div>49시간 초과</div>}
    </div>
  );
}
