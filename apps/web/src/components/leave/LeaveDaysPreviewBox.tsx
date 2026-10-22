"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import type { LeaveDaysState } from "@/components/leave/useLeaveDaysPreview";

// 휴가 신청 창의 「신청 일수」 칸(2026-10-16 #219-10·11·12) — 직원·관리자 신청 창이 같이 쓴다.
// 일수·막힘은 서버 미리보기(useLeaveDaysPreview) 값 그대로. 보상휴가·대체휴일 잔여는 숫자 보기가 켜졌을 때만 보인다(#219-7·1).
export default function LeaveDaysPreviewBox({ state, fixed }: { state: LeaveDaysState; fixed: boolean }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2 text-sm text-gray-400">
        <span>신청 일수 확인 중…</span><Loader2 size={14} className="animate-spin" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-800">
        <AlertCircle size={15} className="mt-0.5 shrink-0" /><span>{state.error}</span>
      </div>
    );
  }
  const d = state.data;
  const grant = d.limit?.kind === "grant" && d.limit.remaining !== null ? d.limit : null;
  // 연도를 걸친 연차 — 날짜별로 그 해 연차에서 차감된다(2026-10-19 본부 답)
  const split = d.limit?.kind === "annual" && (d.limit.years?.length ?? 0) > 1 ? d.limit.years! : null;
  return (
    <div className="space-y-2">
      {d.days > 0 && (
        <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2 text-sm">
          <span className="text-gray-500">{fixed ? "신청 일수 (고정)" : "신청 일수 (근무일정·공휴일 반영 — 조사·출산휴가는 주말 포함)"}</span>
          <span className="font-bold text-gray-800">{d.days}일</span>
        </div>
      )}
      {split && (
        <div className="bg-amber-50 rounded-lg px-4 py-2 text-xs text-amber-800">
          연도를 걸친 휴가라 날짜별로 그 해 연차에서 차감됩니다 — {split.map((y) => `${y.year}년 ${y.days}일`).join(" · ")}
        </div>
      )}
      {grant && (
        <div className="flex items-center justify-between bg-blue-50 rounded-lg px-4 py-2 text-sm">
          <span className="text-blue-700">{grant.group} 잔여{grant.pending ? ` (결재 대기 ${grant.pending}일 제외)` : ""}</span>
          <span className="font-bold text-blue-800">{grant.available}일</span>
        </div>
      )}
      {d.blocked && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{d.reason}</span>
        </div>
      )}
    </div>
  );
}

/** 신청 버튼을 눌러도 되나 — 미리보기가 막았으면 안 된다. 미리보기가 실패했으면 서버가 다시 확인하므로 막지 않는다 */
export function previewAllowsSubmit(state: LeaveDaysState): boolean {
  if (state.status === "ok") return !state.data.blocked && state.data.days > 0;
  return state.status === "error";
}
