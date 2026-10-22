"use client";
// 출퇴근 누락 보정 창 — 관리자 대시보드(R9)와 근태 › 출퇴근 현황(R10) 「확인 필요」가 같이 쓴다.
// 사람이 시각·사유를 넣고 저장한다(본부 10/22 답장 8: 출퇴근 기록은 근로감독 대비 자료라 임의 값이 저절로 들어가면 안 된다).
// 일정 시각은 기본값으로 미리 채워 두기만 한다. 저장은 출퇴근 현황의 수정과 같은 길(PATCH /api/attendance/[id]) —
// 수정 이력(원래 시각 · 바꾼 시각 · 사유 · 고친 사람 실명)과 변경 로그가 함께 남는다.
import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Btn } from "@/components/kit";

export type MissingAttendance = {
  id: string;
  name: string;
  email?: string;
  branch?: string | null;
  date: string;
  type: string;            // 「출근 누락」·「퇴근 누락」 (#219-5)
  mode?: "in" | "out";     // 빠진 쪽 — 문구 비교 대신 이 값으로 가른다
  fillAt?: string | null;  // 일정 기준 시각(서버가 계산, #219-4) — 기본값으로만 쓴다
  fillLabel?: string | null;
  pendingRequest?: boolean; // 그날 직원이 올린 출퇴근 요청이 결재 대기 — 보정 대신 결재함에서
};

export const fillModeOf = (m: MissingAttendance) => m.mode ?? (m.type === "출근 누락" ? "in" : "out");
// 보정 날짜 = 그 근무일(한국 날짜). 일정 기준 시각은 늘 근무일 안(23:59 까지)이다 — 자정 넘긴 퇴근은 창의 「다음 날」로 넣는다
export const fillDayOf = (m: MissingAttendance) => (m.fillAt ? new Date(new Date(m.fillAt).getTime() + 9 * 3600_000).toISOString().slice(0, 10) : m.date.slice(0, 10));
const nextYmd = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
const kstHHMM = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(11, 16);   // 브라우저 시간대와 상관없이 한국 시각
const HHMM = /^[0-2][0-9]:[0-5][0-9]$/;

/** 열 때마다 새로 그리도록 부르는 쪽이 key={target.id} 를 준다 — 입력칸 기본값을 그 건으로 다시 채운다 */
export default function MissingFixDialog({ target, onClose, onSaved }: { target: MissingAttendance | null; onClose: () => void; onSaved: () => void }) {
  const preset = target?.fillAt ? kstHHMM(target.fillAt) : "";
  const [time, setTime] = useState(preset);
  // 사유는 비워 둔다 — 사람이 실제 사정을 적게(검증 4: 미리 채워 두면 「저장」만 눌러 옛 자동 보정과 같아졌다)
  const [reason, setReason] = useState("");
  const [nextDay, setNextDay] = useState(false);   // 퇴근이 자정을 넘긴 경우
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!target) return;
    if (!HHMM.test(time)) { toast.error("시각을 넣어 주세요."); return; }
    if (!reason.trim()) { toast.error("수정 사유를 넣어 주세요."); return; }
    const out = fillModeOf(target) === "out";
    const day = out && nextDay ? nextYmd(fillDayOf(target)) : fillDayOf(target);
    // 미리 넣은 값(일정 · 근태 규칙 · 보정 시간 기준)을 그대로 저장하면 사유에 그렇게 적는다 — 수정 이력에서 「사람이 넣은 실제 시각」과 구분되게(검증 4)
    const why = reason.trim() + (preset && time === preset && !nextDay ? ` (미리 넣은 값 ${preset} 그대로)` : "");
    setSaving(true);
    try {
      const res = await fetch(`/api/attendance/${target.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        // missingFix — 서버가 그날 결재 대기 중인 출퇴근 요청이 있으면 막는다(화면을 연 뒤 직원이 요청을 올린 경우, 검증 5)
        body: JSON.stringify({ [out ? "clockOut" : "clockIn"]: `${day}T${time}:00+09:00`, reason: why, missingFix: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "저장하지 못했습니다."); return; }
      toast.success(`${out ? "퇴근" : "출근"} 시각을 저장했습니다. 수정 이력에 남았습니다.`);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>출퇴근 누락 보정</DialogTitle></DialogHeader>
        {target && (
          <div className="space-y-4">
            <div className="rounded-lg bg-gray-50 p-3 text-sm">
              <p className="font-medium">{target.name}{target.branch ? <span className="font-normal text-gray-500"> · {target.branch}</span> : null}</p>
              <p className="text-xs text-gray-500">{format(new Date(target.date), "yyyy년 M월 d일")} · {target.type}</p>
            </div>
            {target.pendingRequest ? (
              <p className="text-sm text-gray-700">직원이 올린 출퇴근 요청이 결재 대기 중입니다. 보정 대신 <b>결재 › 결재함</b>에서 처리해 주세요.</p>
            ) : (
              <div className="space-y-3 text-sm text-gray-700">
                <div className="block">
                  <span className="mb-1 block font-medium">{fillModeOf(target) === "out" ? "퇴근 시각" : "출근 시각"} <span className="text-xs font-normal text-gray-500">({(fillModeOf(target) === "out" && nextDay ? nextYmd(fillDayOf(target)) : fillDayOf(target)).slice(5).replace("-", "/")})</span></span>
                  <span className="flex items-center gap-3">
                    <Input type="time" aria-label="시각" value={time} onChange={(e) => setTime(e.target.value)} className="w-36" />
                    {fillModeOf(target) === "out" && (
                      <label className="flex items-center gap-1.5 text-xs text-gray-600">
                        <input type="checkbox" checked={nextDay} onChange={(e) => setNextDay(e.target.checked)} className="accent-indigo-600" />다음 날(자정 넘김)
                      </label>
                    )}
                  </span>
                  {target.fillLabel && <span className="mt-1 block text-xs text-gray-500">미리 넣은 값: {target.fillLabel} — 실제 시각으로 고쳐 주세요(그대로 저장하면 사유에 「미리 넣은 값 그대로」가 남습니다)</span>}
                </div>
                <label className="block">
                  <span className="mb-1 block font-medium">수정 사유</span>
                  <Input value={reason} maxLength={280} placeholder="예: 퇴근 버튼 누락 — 원장 확인 22:10" onChange={(e) => setReason(e.target.value)} />
                </label>
                <p className="text-xs text-gray-500">저장하면 수정 이력과 변경 로그에 고친 사람 · 시각 · 값이 남습니다.</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Btn onClick={onClose} disabled={saving}>닫기</Btn>
              {!target.pendingRequest && <Btn kind="primary" onClick={save} disabled={saving || !time || !reason.trim()}>{saving ? "저장 중..." : "저장"}</Btn>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
