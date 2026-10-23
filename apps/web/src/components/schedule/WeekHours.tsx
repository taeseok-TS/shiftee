"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * 주 49시간(#38) 화면 공용 — 관리자 근무일정 주간 표와 원장 팀 일정 표가 같이 쓴다.
 *  · useWeekHours(월요일): 그 주 사람별 근로시간(분, 휴게 제외). 주를 빠르게 넘겨도 늦게 온 옛 주 응답이 덮지 않는다
 *  · <WeekHoursLine>: 「주 일정 Xh · 실제 Yh」, 49시간을 넘으면 빨간색
 *  · showWeekWarnings: 저장 응답의 경고를 토스트로 — 많으면 앞 3건 + 「외 N건」
 */
// hoursHidden: 주 근무시간 숫자는 본부만(2026-10-23 ■0-11) — 서버가 원장에게는 숫자를 0 으로 두고 이 값을 켠다.
// 그러면 숫자 대신 일정 기준 「주 52시간 안 · 넘음」만 그린다(week52 · over52)
export type Week52 = "IN_52" | "OVER_52";
export type WeekHours = {
  monday: string; limitMin: number; actualHidden?: boolean; hoursHidden?: boolean;
  hours: Record<string, { sched: number; actual: number; over49?: boolean; over52?: boolean; week52?: Week52 }>;
};

/** 숫자를 숨긴 응답에서 「52시간 넘음」인지 — week52 가 없으면 over52 로. 둘 다 없으면 null(그리지 않는다) */
export function week52Of(wh: { over52?: boolean; week52?: Week52 } | undefined): Week52 | null {
  if (!wh) return null;
  if (wh.week52) return wh.week52;
  if (wh.over52 != null) return wh.over52 ? "OVER_52" : "IN_52";
  return null;
}

/** 월요일이 빈 문자열이면(일·월 보기, #71) 부르지 않고 null */
export function useWeekHours(monday: string, reloadKey = 0) {
  const [data, setData] = useState<WeekHours | null>(null);
  useEffect(() => {
    if (!monday) return;
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
  const wh = data?.hours?.[userId];
  // 원장 — 숫자 없이 「주 52시간 안 / 넘음」만(넘으면 빨강)
  if (data?.hoursHidden) {
    const w = week52Of(wh);
    if (!w) return null;
    return (
      <div className={`text-[11px] mt-0.5 ${w === "OVER_52" ? "text-red-600 font-semibold" : "text-gray-500"}`} title="이번 주 일정 기준(휴게 제외)">
        {w === "OVER_52" ? "주 52시간 넘음" : "주 52시간 안"}
      </div>
    );
  }
  if (!data || !wh || (!wh.sched && !wh.actual)) return null;
  const h = (m: number) => `${Math.round(m / 6) / 10}h`;
  const over = wh.sched > data.limitMin || wh.actual > data.limitMin;
  return (
    <div className={`text-[11px] mt-0.5 ${over ? "text-red-600 font-semibold" : "text-gray-500"}`}
      title="이번 주 근로시간(휴게 제외) — 49시간을 넘으면 빨간색">
      주 일정 {h(wh.sched)}{data.actualHidden ? "" : ` · 실제 ${h(wh.actual)}`}{over ? " · 49h 초과" : ""}
    </div>
  );
}

// 숫자를 숨긴 사람(원장 · 직원)이 받는 서버 문구(lib/weekly-hours over49Warnings hideNumbers) — 「… 주 근무일정이 주 49시간을 넘습니다」.
// 이 사람들의 표는 숫자 없이 「주 52시간 안 · 넘음」만 그리고 빨강은 52시간을 넘을 때만이라, 49시간 경고에 「빨간 표시를 확인」이라
// 하면 표(「52시간 안」, 회색)와 어긋난다. 그래서 숫자 · 빨간 표시 말 없이 「49시간을 넘을 수 있습니다 — 본부가 확인합니다」로 바꿔 보여 준다.
const HIDDEN_49 = /\s*주 근무일정이 주 49시간을 넘습니다\s*$/;
export function showWeekWarnings(warnings: unknown, duration = 10000) {
  const list = Array.isArray(warnings) ? (warnings as unknown[]).filter((w): w is string => typeof w === "string") : [];
  const hidden = list.length > 0 && list.every((w) => HIDDEN_49.test(w));
  for (const w of list.slice(0, 3)) {
    toast.warning(HIDDEN_49.test(w) ? `${w.replace(HIDDEN_49, "")} 주 근무가 49시간을 넘을 수 있습니다 — 본부가 확인합니다` : w, { duration });
  }
  if (list.length > 3) {
    toast.warning(hidden
      ? `그 밖에 ${list.length - 3}건도 주 49시간을 넘을 수 있습니다 — 본부가 확인합니다`
      : `그 밖에 ${list.length - 3}건이 주 49시간을 넘습니다. 근무일정 표의 빨간 표시를 확인해 주세요.`, { duration });
  }
}
