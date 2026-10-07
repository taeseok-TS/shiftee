"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { TemplatePicker } from "@/components/schedule/TemplatePicker";
import { showWeekWarnings } from "@/components/schedule/WeekHours";

/**
 * 원장 팀 근무일정 관리 창(2026-10-07 QA #18 #12) — 일정 추가·고치기·지우기, 일괄 생성.
 * 서버 규칙: 원장은 담당 지점 직원·원장과 본인 일정을 바꿀 수 있다(본인 변경은 본부에 알림),
 * 일괄 생성은 이미 일정이 있는 날·휴가인 날을 건너뛴다. 주 49시간을 넘으면 경고만.
 */
export type Emp = { id: string; name: string; branch: string | null };
export type EditTarget = { id?: string; userId: string; date: string; startTime: string; endTime: string } | null;

export function ScheduleEditDialog({ target, employees, onClose, onSaved }: {
  target: EditTarget; employees: Emp[]; onClose: () => void; onSaved: () => void;
}) {
  // 부르는 쪽이 대상마다 key 를 바꿔 새로 띄운다 — 처음 값만 받으면 된다
  const [form, setForm] = useState(() => ({ userId: target?.userId ?? "", date: target?.date ?? "", startTime: target?.startTime ?? "10:00", endTime: target?.endTime ?? "19:00" }));
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  const editing = !!target.id;
  const emp = employees.find((e) => e.id === form.userId);

  const save = async () => {
    if (!form.userId || !form.date) { toast.error("직원과 날짜를 골라 주세요."); return; }
    setBusy(true);
    try {
      const res = editing
        ? await fetch(`/api/schedule/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startTime: form.startTime, endTime: form.endTime, type: "WORK" }) })
        : await fetch("/api/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, type: "WORK" }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "저장하지 못했습니다."); return; }
      toast.success(editing ? "고쳤습니다." : "추가했습니다.");
      showWeekWarnings(d.warnings);
      onSaved();
      onClose();
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!target.id || !window.confirm("이 근무일정을 지울까요? 그날 주말·공휴일이면 출근이 막힙니다.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/schedule/${target.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "지우지 못했습니다."); return; }
      toast.success("지웠습니다.");
      onSaved();
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? "근무일정 고치기" : "근무일정 추가"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="text-xs text-gray-500">직원</span>
            <select className="w-full h-9 rounded-md border px-2" value={form.userId} disabled={editing}
              onChange={(e) => setForm({ ...form, userId: e.target.value })}>
              <option value="">직원 선택</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.branch ? ` (${e.branch})` : ""}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-gray-500">날짜</span>
            <Input type="date" value={form.date} disabled={editing} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <div className="space-y-1">
            <span className="text-xs text-gray-500">근무일정 템플릿</span>
            <TemplatePicker branch={emp?.branch ?? null} onPick={(st, et) => setForm((f) => ({ ...f, startTime: st, endTime: et }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><span className="text-xs text-gray-500">시작</span><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></label>
            <label className="space-y-1"><span className="text-xs text-gray-500">종료</span><Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></label>
          </div>
          <div className="flex justify-between pt-1">
            {editing ? <Button variant="ghost" className="text-red-600" disabled={busy} onClick={remove}>지우기</Button> : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>닫기</Button>
              <Button disabled={busy} onClick={save}>{busy ? "저장 중…" : "저장"}</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export function ScheduleBulkDialog({ open, employees, onClose, onSaved }: {
  open: boolean; employees: Emp[]; onClose: () => void; onSaved: () => void;
}) {
  const [userIds, setUserIds] = useState<string[]>([]);
  const [range, setRange] = useState({ startDate: "", endDate: "" });
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [time, setTime] = useState({ startTime: "10:00", endTime: "19:00" });
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const submit = async () => {
    if (!userIds.length) { toast.error("직원을 1명 이상 골라 주세요."); return; }
    if (!range.startDate || !range.endDate) { toast.error("기간을 넣어 주세요."); return; }
    if (!weekdays.length) { toast.error("요일을 골라 주세요."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/schedule/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds, ...range, weekdays, ...time, type: "WORK" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "만들지 못했습니다."); return; }
      const skipped = [d.skippedExisting ? `일정 있는 날 ${d.skippedExisting}건` : "", d.skippedLeave ? `휴가인 날 ${d.skippedLeave}건` : ""].filter(Boolean).join(", ");
      toast.success(`${d.count}개 일정을 만들었습니다${skipped ? ` · 건너뜀: ${skipped}` : ""}`);
      showWeekWarnings(d.warnings);
      onSaved();
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>근무일정 일괄 생성</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">직원 ({userIds.length}명)</span>
              <button className="text-xs text-blue-600" onClick={() => setUserIds(userIds.length === employees.length ? [] : employees.map((e) => e.id))}>
                {userIds.length === employees.length ? "모두 해제" : "모두 선택"}
              </button>
            </div>
            <div className="mt-1 max-h-36 overflow-auto border rounded p-2 grid grid-cols-2 gap-1">
              {employees.map((e) => (
                <label key={e.id} className="flex items-center gap-1 text-xs cursor-pointer">
                  <input type="checkbox" checked={userIds.includes(e.id)}
                    onChange={() => setUserIds((u) => (u.includes(e.id) ? u.filter((x) => x !== e.id) : [...u, e.id]))} />
                  {e.name}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><span className="text-xs text-gray-500">시작일</span><Input type="date" value={range.startDate} onChange={(e) => setRange({ ...range, startDate: e.target.value })} /></label>
            <label className="space-y-1"><span className="text-xs text-gray-500">종료일</span><Input type="date" value={range.endDate} onChange={(e) => setRange({ ...range, endDate: e.target.value })} /></label>
          </div>
          <div className="flex gap-1">
            {WEEK.map((w, i) => (
              <button key={w} onClick={() => setWeekdays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]))}
                className={`w-9 h-8 rounded border text-xs ${weekdays.includes(i) ? "bg-blue-600 text-white border-blue-600" : "text-gray-600"}`}>{w}</button>
            ))}
          </div>
          <div className="space-y-1">
            <span className="text-xs text-gray-500">근무일정 템플릿 (범용형)</span>
            <TemplatePicker onPick={(st, et) => setTime({ startTime: st, endTime: et })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><span className="text-xs text-gray-500">시작</span><Input type="time" value={time.startTime} onChange={(e) => setTime({ ...time, startTime: e.target.value })} /></label>
            <label className="space-y-1"><span className="text-xs text-gray-500">종료</span><Input type="time" value={time.endTime} onChange={(e) => setTime({ ...time, endTime: e.target.value })} /></label>
          </div>
          <p className="text-xs text-gray-400">이미 일정이 있는 날과 휴가(반차 포함)인 날은 건너뜁니다.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>닫기</Button>
            <Button disabled={busy} onClick={submit}>{busy ? "만드는 중…" : "만들기"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
