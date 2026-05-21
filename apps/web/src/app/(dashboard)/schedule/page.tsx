"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

type Schedule = {
  id: string;
  userId: string;
  date: string;
  startTime: string;
  endTime: string;
  type: string;
  note: string | null;
  user: { name: string; department: string | null };
};

type User = { id: string; name: string; department: string | null };

const typeConfig: Record<string, { label: string; color: string }> = {
  WORK: { label: "근무", color: "bg-blue-100 text-blue-700" },
  OFF: { label: "휴무", color: "bg-gray-100 text-gray-600" },
  HOLIDAY: { label: "공휴일", color: "bg-red-100 text-red-600" },
};

export default function SchedulePage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [employees, setEmployees] = useState<User[]>([]);
  const [role, setRole] = useState("EMPLOYEE");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ userId: "", date: "", startTime: "09:00", endTime: "18:00", type: "WORK", note: "" });

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  const fetchSchedules = useCallback(async () => {
    const res = await fetch(`/api/schedule?year=${year}&month=${month}`);
    const data = await res.json();
    setSchedules(data.schedules || []);
  }, [year, month]);

  useEffect(() => {
    fetchSchedules();
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      setRole(d.user?.role || "EMPLOYEE");
    });
    fetch("/api/employees").then(r => r.json()).then(d => setEmployees(d.employees || [])).catch(() => {});
  }, [fetchSchedules]);

  const days = eachDayOfInterval({ start: startOfMonth(currentDate), end: endOfMonth(currentDate) });
  const firstDayOfWeek = getDay(startOfMonth(currentDate)); // 0=일, 6=토

  function getSchedulesForDay(day: Date) {
    return schedules.filter(s => isSameDay(new Date(s.date), day));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("일정이 등록되었습니다.");
    setOpen(false);
    fetchSchedules();
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">근무일정</h1>
        {role !== "EMPLOYEE" && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus size={16} />일정 등록</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>근무일정 등록</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>직원</Label>
                  <Select value={form.userId} onValueChange={v => setForm(f => ({ ...f, userId: v }))}>
                    <SelectTrigger><SelectValue placeholder="직원 선택" /></SelectTrigger>
                    <SelectContent>
                      {employees.map(emp => (
                        <SelectItem key={emp.id} value={emp.id}>{emp.name} ({emp.department})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>날짜</Label>
                  <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>출근 시간</Label>
                    <Input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>퇴근 시간</Label>
                    <Input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>유형</Label>
                  <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(typeConfig).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>취소</Button>
                  <Button type="submit">등록</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar size={18} />
              {year}년 {month}월
            </CardTitle>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
                <ChevronLeft size={16} />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>오늘</Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 mb-2">
            {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
              <div key={d} className={`text-center text-sm font-medium py-2 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-gray-500"}`}>
                {d}
              </div>
            ))}
          </div>

          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200 rounded-lg overflow-hidden">
            {/* 첫 주 빈 칸 */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="bg-gray-50 min-h-[100px]" />
            ))}

            {days.map((day) => {
              const daySchedules = getSchedulesForDay(day);
              const dayOfWeek = getDay(day);
              return (
                <div
                  key={day.toISOString()}
                  className={`bg-white min-h-[100px] p-1.5 ${isToday(day) ? "ring-2 ring-blue-500 ring-inset" : ""}`}
                >
                  <p className={`text-sm font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full
                    ${isToday(day) ? "bg-blue-600 text-white" : dayOfWeek === 0 ? "text-red-500" : dayOfWeek === 6 ? "text-blue-500" : "text-gray-700"}`}>
                    {day.getDate()}
                  </p>
                  <div className="space-y-0.5">
                    {daySchedules.slice(0, 3).map(s => {
                      const cfg = typeConfig[s.type] || { label: s.type, color: "bg-gray-100 text-gray-600" };
                      return (
                        <div key={s.id} className={`text-xs px-1.5 py-0.5 rounded truncate ${cfg.color}`}>
                          {role !== "EMPLOYEE" ? s.user.name : ""} {s.startTime}~{s.endTime}
                        </div>
                      );
                    })}
                    {daySchedules.length > 3 && (
                      <p className="text-xs text-gray-400">+{daySchedules.length - 3}개</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 이번 달 일정 목록 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">이번 달 일정 목록</CardTitle>
        </CardHeader>
        <CardContent>
          {schedules.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">등록된 일정이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {schedules.map(s => {
                const cfg = typeConfig[s.type] || { label: s.type, color: "bg-gray-100 text-gray-600" };
                return (
                  <div key={s.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <Badge className={cfg.color}>{cfg.label}</Badge>
                      <div>
                        <p className="text-sm font-medium">{format(new Date(s.date), "MM월 dd일 (EEE)", { locale: ko })}</p>
                        {role !== "EMPLOYEE" && <p className="text-xs text-gray-400">{s.user.name} · {s.user.department}</p>}
                      </div>
                    </div>
                    <p className="text-sm text-gray-600">{s.startTime} ~ {s.endTime}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
