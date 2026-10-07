"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * 주 49시간(#38) 화면 공용 — 관리자 근무일정 주간 표와 원장 팀 일정 표가 같이 쓴다.
 *  · useWeekHours(월요일): 그 주 사람별 근로시간(분, 휴게 제외). 주를 빠르게 넘겨도 늦게 온 옛 주 응답이 덮지 않는다
 *  · <WeekHoursLine>: 「주 일정 Xh · 실제 Yh」, 49시간을 넘으면 빨간색
 *  · showWeekWarnings: 저장 응답의 경고를 토스트로 — 많으면 앞 3건 + 「외 N건」
 */
type WeekHours = { monday: string; limitMin: number; hours: Record<string, { sched: number; actual: number }> };

export function useWeekHours(monday: string, reloadKey = 0) {
  const [data, setData] = useState<WeekHours | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/schedule/weekly-hours?week=${monday}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [monday, reloadKey]);
  return data && data.monday === monday ? data : null;   // 다른 주 응답은 쓰지 않는다
}

export function WeekHoursLine({ data, userId }: { data: WeekHours | null; userId: string }) {
  const wh = data?.hours[userId];
  if (!data || !wh || (!wh.sched && !wh.actual)) return null;
  const h = (m: number) => `${Math.round(m / 6) / 10}h`;
  const over = wh.sched > data.limitMin || wh.actual > data.limitMin;
  return (
    <div className={`text-[11px] mt-0.5 ${over ? "text-red-600 font-semibold" : "text-gray-500"}`}
      title="이번 주 근로시간(휴게 제외) — 49시간을 넘으면 빨간색">
      주 일정 {h(wh.sched)} · 실제 {h(wh.actual)}{over ? " ⚠49h 초과" : ""}
    </div>
  );
}

export function showWeekWarnings(warnings: unknown, duration = 10000) {
  const list = Array.isArray(warnings) ? (warnings as string[]) : [];
  for (const w of list.slice(0, 3)) toast.warning(w, { duration });
  if (list.length > 3) toast.warning(`그 밖에 ${list.length - 3}건이 주 49시간을 넘습니다. 근무일정 표의 빨간 표시를 확인해 주세요.`, { duration });
}
