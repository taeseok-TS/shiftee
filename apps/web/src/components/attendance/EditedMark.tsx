"use client";

import { useEffect, useRef, useState } from "react";
import type { AttendanceEditView } from "@/lib/attendance-edit";

/**
 * 출퇴근 목록의 「수정됨」 표시(2026-10-16 이예지 QA #219-15).
 * 마우스를 올리면 이력 전체가 보이고, 누르면 원래 시각·사유·수정/승인자가 펼쳐진다(휴대폰은 눌러서).
 * 데이터는 서버가 만든 요약(lib/attendance-edit attendanceEditViews) — 여기서는 보이기만 한다.
 * 본부 출퇴근 관리(/admin/attendance)·출퇴근기록 보드(본부·원장)·내 출퇴근이 같은 컴포넌트를 쓴다.
 */
export default function EditedMark({ edit }: { edit?: AttendanceEditView | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  // 펼친 상자는 바깥을 누르면 닫힌다(UI 드롭다운 규칙)
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!edit) return null;
  return (
    <span ref={box} className="relative inline-block align-middle">
      <button type="button" onClick={() => setOpen((o) => !o)} title={edit.lines.join("\n")}
        className="ml-1 rounded border border-[#fde68a] bg-[#fffbeb] px-1.5 py-0.5 text-[12px] font-medium text-[#b45309] hover:bg-[#fef3c7] whitespace-nowrap">
        수정됨{edit.count > 1 ? ` ${edit.count}` : ""}
      </button>
      {open && (
        <span className="absolute left-0 top-full z-30 mt-1 block w-72 max-w-[80vw] rounded-md border bg-white p-2.5 text-left text-xs font-normal text-gray-700 shadow-lg whitespace-normal">
          {edit.inChanged && <span className="block">원래 출근: <b>{edit.origIn}</b></span>}
          {edit.outChanged && <span className="block">원래 퇴근: <b>{edit.origOut}</b></span>}
          <span className="block">수정 사유: {edit.reason}</span>
          <span className="block">수정·승인자: {edit.by}</span>
          <span className="mt-1.5 block border-t pt-1.5 text-[12px] text-gray-500">
            {edit.lines.map((l, i) => <span key={i} className="block">{l}</span>)}
          </span>
        </span>
      )}
    </span>
  );
}

/** 엑셀 열 — 수정 여부·원래 출근·원래 퇴근·수정 사유·수정·승인자. 바뀌지 않은 칸은 비운다 */
export function editExcelColumns(edit?: AttendanceEditView | null): Record<string, string> {
  return {
    "수정 여부": edit ? `수정됨(${edit.count}회)` : "",
    "원래 출근": edit?.inChanged ? edit.origIn ?? "" : "",
    "원래 퇴근": edit?.outChanged ? edit.origOut ?? "" : "",
    "수정 사유": edit?.reason ?? "",
    "수정·승인자": edit?.by ?? "",
  };
}
