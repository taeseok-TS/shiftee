"use client";
// 주말 근무 엑셀(본부, #86) — 출퇴근 현황 알약 탭 「주말 근무 엑셀」(R10). 전에는 출퇴근기록 화면 위 한 줄이었다.
// 기본 기간은 날짜와 상관없이 늘 전월 20일 ~ 당월 19일(KST, 2026-10-14 QA 확정 — 20일 전이면 전전월 기간을 보여 줘 헷갈렸다)
import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Box, btnClass, inputClass } from "@/components/kit";

export default function WeekendExportBox() {
  const [wk, setWk] = useState(() => {
    const k = new Date(Date.now() + 9 * 3600_000);
    const start = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() - 1, 20));
    const end = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 19));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  });
  return (
    <Box icon={<FileSpreadsheet />} tone="sl" title="주말 근무 엑셀" sub="토 · 일 · 공휴일 · 원장 포함 · 본부 양식(직영 재직자 급여 자료)">
      <div className="flex flex-wrap items-center gap-2.5 px-6 py-5">
        <input type="date" className={inputClass} value={wk.from} onChange={(e) => setWk((w) => ({ ...w, from: e.target.value }))} aria-label="시작일" />
        <span className="text-[#596578]">~</span>
        <input type="date" className={inputClass} value={wk.to} onChange={(e) => setWk((w) => ({ ...w, to: e.target.value }))} aria-label="종료일" />
        <a className={btnClass("secondary")} href={`/api/attendance/weekend-export?from=${wk.from}&to=${wk.to}`}
          onClick={(e) => {
            const days = (new Date(wk.to).getTime() - new Date(wk.from).getTime()) / 86400_000;
            if (!wk.from || !wk.to || days < 0) { e.preventDefault(); toast.error("기간을 확인해 주세요."); }
            else if (days > 93) { e.preventDefault(); toast.error("한 번에 3개월까지 받을 수 있습니다."); }
          }}>
          <Download size={14} />받기
        </a>
        <span className="text-[12.5px] text-[#596578]">기본 기간: 전월 20일 ~ 당월 19일</span>
      </div>
    </Box>
  );
}
