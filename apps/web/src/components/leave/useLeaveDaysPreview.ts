"use client";

import { useEffect, useState } from "react";

// 휴가 신청 창 「신청 일수」 미리보기(2026-10-16 #219-10·11·12) — 화면에서 일수를 따로 세지 않고 서버(GET /api/leave/days)가
// 신청 검사와 **같은 함수**(lib/leave-days 근무일정 기준 · lib/leave-limit 잔여 초과)로 센 값을 받는다.
// 종전 화면 계산(주말만 제외)은 공휴일을 빼지 않아 화면 「3일」·실제 차감 2일이 됐다. 직원 신청 창·관리자 신청 창이 같이 쓴다.
// 입력이 바뀔 때마다 0.3초 기다렸다가 부르고, 늦게 온 앞 요청 응답은 버린다.

export type LeaveDaysPreview = {
  days: number;
  blocked: boolean;              // 근무일 없음 · 잔여 초과 — 신청 버튼을 막는다
  code: "NO_WORKDAY" | "OVER_LIMIT" | null;
  reason: string | null;         // 막힌 이유(서버 문구 — 숫자 숨김이면 숫자 없음)
  balanceHidden: boolean;        // 잔여 숫자 숨김(#219-1)
  limit: { kind: "annual" | "grant"; year: number | null; group: string | null; remaining: number | null; pending: number | null; available: number | null } | null;
};
export type LeaveDaysState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: LeaveDaysPreview }
  | { status: "error"; error: string };

export function useLeaveDaysPreview(opts: { enabled: boolean; type: string; start: string; end: string; singleDay: boolean; userId?: string }): LeaveDaysState {
  const { enabled, type, start, singleDay, userId } = opts;
  const end = singleDay ? start : opts.end;
  const ready = enabled && !!type && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end;
  // 응답은 요청 열쇠(유형·기간·대상)와 함께 둔다 — 열쇠가 바뀌면 받기 전까지 「확인 중」으로 보인다(effect 안에서 바로 setState 하지 않게)
  const key = ready ? `${type}|${start}|${end}|${userId ?? ""}` : null;
  const [res, setRes] = useState<{ key: string; state: LeaveDaysState } | null>(null);

  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ type, start, end });
        if (userId) q.set("userId", userId);
        const r = await fetch(`/api/leave/days?${q}`, { signal: ctrl.signal, cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (ctrl.signal.aborted) return;
        if (!r.ok) { setRes({ key, state: { status: "error", error: d.error || "신청 일수를 확인하지 못했습니다." } }); return; }
        setRes({ key, state: { status: "ok", data: d as LeaveDaysPreview } });
      } catch {
        if (ctrl.signal.aborted) return;
        setRes({ key, state: { status: "error", error: "신청 일수를 확인하지 못했습니다. 잠시 뒤 다시 열어 주세요(신청하면 서버가 다시 확인합니다)." } });
      }
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [key, type, start, end, userId]);

  if (!key) return { status: "idle" };
  return res && res.key === key ? res.state : { status: "loading" };
}
