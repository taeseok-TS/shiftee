"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Trash2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameMonth, isToday } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

type Ev = { id: string; title: string; description: string | null; startDate: string; endDate: string; branch: string | null; color: string; canEdit: boolean };
const COLORS: Record<string, string> = { indigo: "bg-indigo-500", blue: "bg-blue-500", green: "bg-green-500", red: "bg-red-500", amber: "bg-amber-500" };
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export default function WorkCalendarPage() {
  const [cursor, setCursor] = useState(new Date());
  const [events, setEvents] = useState<Ev[]>([]);
  const [role, setRole] = useState("EMPLOYEE");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", startDate: "", endDate: "", branch: "__ALL__", color: "indigo" });
  const [saving, setSaving] = useState(false);

  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;

  const fetchEvents = useCallback(async () => {
    const res = await fetch(`/api/work/calendar?year=${year}&month=${month}`);
    if (res.ok) setEvents((await res.json()).events || []);
  }, [year, month]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);
  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => setRole(d.user?.role || "EMPLOYEE")).catch(() => {});
    fetch("/api/branches").then(r => r.ok ? r.json() : { branches: [] }).then(d => setBranches(d.branches || [])).catch(() => {});
  }, []);

  const days = useMemo(() => eachDayOfInterval({ start: startOfMonth(cursor), end: endOfMonth(cursor) }), [cursor]);
  const startPad = getDay(startOfMonth(cursor));

  function eventsOn(day: Date) {
    const d = format(day, "yyyy-MM-dd");
    return events.filter((e) => format(new Date(e.startDate), "yyyy-MM-dd") <= d && d <= format(new Date(e.endDate), "yyyy-MM-dd"));
  }

  async function save() {
    if (!form.title.trim() || !form.startDate) { toast.error("제목과 시작일을 입력해주세요."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/work/calendar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, branch: form.branch === "__ALL__" ? null : form.branch, endDate: form.endDate || form.startDate }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "등록 실패"); return; }
      toast.success("일정이 등록되었습니다.");
      setOpen(false);
      setForm({ title: "", description: "", startDate: "", endDate: "", branch: "__ALL__", color: "indigo" });
      fetchEvents();
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/work/calendar/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제 실패"); return; }
    toast.success("삭제되었습니다."); fetchEvents();
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarDays size={22} className="text-indigo-500" />캘린더 <span className="text-sm font-normal text-gray-400">회사·지점 전체 일정</span></h1>
        {role !== "EMPLOYEE" && (
          <Button onClick={() => setOpen(true)} className="gap-1 bg-indigo-500 hover:bg-indigo-600"><Plus size={16} />일정 등록</Button>
        )}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" onClick={() => setCursor(new Date(year, month - 2, 1))}><ChevronLeft size={18} /></Button>
        <span className="text-lg font-semibold">{year}년 {month}월</span>
        <Button variant="ghost" size="icon" onClick={() => setCursor(new Date(year, month, 1))}><ChevronRight size={18} /></Button>
        <Button variant="ghost" size="sm" onClick={() => setCursor(new Date())}>오늘</Button>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="grid grid-cols-7 border-b">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={`text-center text-sm font-semibold py-2 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-gray-600"}`}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: startPad }).map((_, i) => <div key={`p${i}`} className="min-h-[110px] border-b border-r bg-gray-50/40" />)}
          {days.map((day) => {
            const evs = eventsOn(day);
            const dow = getDay(day);
            return (
              <div key={day.toISOString()} className={`min-h-[110px] border-b border-r p-1.5 ${isToday(day) ? "bg-indigo-50/50" : ""}`}>
                <div className={`text-xs font-medium mb-1 ${dow === 0 ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-gray-600"}`}>{day.getDate()}</div>
                <div className="space-y-1">
                  {evs.map((e) => (
                    <div key={e.id + day.toISOString()} className="group relative">
                      <div className={`text-[11px] text-white rounded px-1.5 py-0.5 truncate ${COLORS[e.color] || COLORS.indigo}`} title={e.title}>
                        {e.branch ? `[${e.branch}] ` : ""}{e.title}
                      </div>
                      {e.canEdit && format(new Date(e.startDate), "yyyy-MM-dd") === format(day, "yyyy-MM-dd") && (
                        <button onClick={() => remove(e.id)} className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 bg-white border rounded-full p-0.5 text-red-500"><Trash2 size={10} /></button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-3">※ 회사 전체(전사) 또는 지점 공통 일정만 표시됩니다. 개인 근무일정·휴가와는 별개입니다.</p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>전체 일정 등록</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="일정 제목" value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} />
            <Textarea placeholder="설명 (선택)" rows={3} value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500">시작일</label><Input type="date" value={form.startDate} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500">종료일</label><Input type="date" value={form.endDate} onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">대상</label>
                {role === "ADMIN" ? (
                  <Select value={form.branch} onValueChange={(v) => setForm(f => ({ ...f, branch: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__ALL__">전사 공통</SelectItem>
                      {branches.map((b) => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="text-sm py-2 text-gray-600">내 지점 일정으로 등록됩니다</div>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500">색상</label>
                <Select value={form.color} onValueChange={(v) => setForm(f => ({ ...f, color: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(COLORS).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
              <Button onClick={save} disabled={saving}>{saving ? "등록 중..." : "등록"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
