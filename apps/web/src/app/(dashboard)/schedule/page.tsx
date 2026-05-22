"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronLeft, ChevronRight, CalendarDays, Layers, Plus,
  Search, Users, X,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isToday, addMonths, subMonths, isSameMonth,
} from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

/* ── 타입 ── */
type DayData = {
  date: string;
  work: number; off: number; holiday: number;
  checkedIn: number; late: number; earlyLeave: number; absent: number; leave: number;
};
type EmpRow = {
  id: string; name: string; department: string; position: string;
  scheduleType: string | null; startTime: string | null; endTime: string | null;
  clockIn: string | null; clockOut: string | null;
  leaveType: string | null; status: string; scheduleId: string | null;
};
type DaySummary = {
  total: number; checkedIn: number; late: number; earlyLeave: number;
  absent: number; leave: number; notYet: number; off: number;
};
type Employee = { id: string; name: string; department: string | null };

/* ── 상태 설정 ── */
const STATUS_CFG: Record<string, { label: string; badge: string; dot: string }> = {
  NORMAL:      { label: "정상",    badge: "bg-green-100 text-green-700 border-green-200",   dot: "bg-green-500" },
  LATE:        { label: "지각",    badge: "bg-orange-100 text-orange-700 border-orange-200", dot: "bg-orange-500" },
  EARLY_LEAVE: { label: "조퇴",    badge: "bg-purple-100 text-purple-700 border-purple-200", dot: "bg-purple-500" },
  ABSENT:      { label: "결근",    badge: "bg-red-100 text-red-700 border-red-200",         dot: "bg-red-500" },
  LEAVE:       { label: "휴가",    badge: "bg-blue-100 text-blue-700 border-blue-200",      dot: "bg-blue-500" },
  OFF:         { label: "휴무",    badge: "bg-gray-100 text-gray-500 border-gray-200",      dot: "bg-gray-400" },
  HOLIDAY:     { label: "공휴일",  badge: "bg-red-50 text-red-500 border-red-200",          dot: "bg-red-400" },
  NOT_YET:     { label: "미등록",  badge: "bg-slate-100 text-slate-500 border-slate-200",   dot: "bg-slate-400" },
  NO_SCHEDULE: { label: "일정없음", badge: "bg-gray-50 text-gray-400 border-gray-100",      dot: "bg-gray-300" },
};

const LEAVE_LABEL: Record<string, string> = {
  ANNUAL: "연차", HALF_AM: "오전반차", HALF_PM: "오후반차", SICK: "병가", SPECIAL: "특별휴가",
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const TYPE_CFG: Record<string, string> = {
  WORK: "근무", OFF: "휴무", HOLIDAY: "공휴일",
};

const defaultForm = { userId: "", date: "", startTime: "09:00", endTime: "18:00", type: "WORK", note: "" };
const defaultBulk = { userIds: [] as string[], startDate: "", endDate: "", weekdays: [1,2,3,4,5] as number[], startTime: "09:00", endTime: "18:00", type: "WORK" };

export default function SchedulePage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [monthData,   setMonthData]   = useState<DayData[]>([]);
  const [totalEmp,    setTotalEmp]    = useState(0);
  const [employees,   setEmployees]   = useState<Employee[]>([]);
  const [role,        setRole]        = useState("EMPLOYEE");

  /* 날짜 상세 다이얼로그 */
  const [dayOpen,     setDayOpen]     = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [dayRows,     setDayRows]     = useState<EmpRow[]>([]);
  const [daySummary,  setDaySummary]  = useState<DaySummary | null>(null);
  const [dayLoading,  setDayLoading]  = useState(false);

  /* 상세 필터 */
  const [search,      setSearch]      = useState("");
  const [filterDept,  setFilterDept]  = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  /* 일정 등록 다이얼로그 */
  const [addOpen,   setAddOpen]   = useState(false);
  const [addForm,   setAddForm]   = useState(defaultForm);
  const [bulkOpen,  setBulkOpen]  = useState(false);
  const [bulk,      setBulk]      = useState(defaultBulk);
  const [bulkLoading, setBulkLoading] = useState(false);

  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const isAdmin = role !== "EMPLOYEE";

  /* ── 월별 집계 로드 ── */
  const fetchMonth = useCallback(async () => {
    const res  = await fetch(`/api/schedule?year=${year}&month=${month}`);
    const data = await res.json();
    setMonthData(data.monthData  || []);
    setTotalEmp(data.totalEmployees || 0);
  }, [year, month]);

  useEffect(() => {
    fetchMonth();
    fetch("/api/auth/me").then(r => r.json()).then(d => setRole(d.user?.role || "EMPLOYEE"));
    fetch("/api/employees").then(r => r.json()).then(d => setEmployees(d.employees || [])).catch(() => {});
  }, [fetchMonth]);

  /* ── 날짜 클릭 → 상세 로드 ── */
  async function openDay(dateStr: string) {
    setSelectedDay(dateStr);
    setSearch(""); setFilterDept("all"); setFilterStatus("all");
    setDayOpen(true);
    setDayLoading(true);
    try {
      const res  = await fetch(`/api/schedule/day?date=${dateStr}`);
      const data = await res.json();
      setDayRows(data.employees || []);
      setDaySummary(data.summary || null);
    } finally { setDayLoading(false); }
  }

  /* ── 캘린더 데이터 ── */
  const days     = eachDayOfInterval({ start: startOfMonth(currentDate), end: endOfMonth(currentDate) });
  const startPad = getDay(startOfMonth(currentDate));

  const dayMap = useMemo(() => {
    const m: Record<string, DayData> = {};
    monthData.forEach(d => { m[d.date] = d; });
    return m;
  }, [monthData]);

  /* ── 상세 필터 적용 ── */
  const departments = useMemo(() =>
    [...new Set(dayRows.map(r => r.department))].sort(), [dayRows]);

  const filteredRows = useMemo(() => dayRows.filter(r => {
    const matchSearch = !search || r.name.includes(search) || r.department.includes(search);
    const matchDept   = filterDept   === "all" || r.department === filterDept;
    const matchStatus = filterStatus === "all" || r.status === filterStatus;
    return matchSearch && matchDept && matchStatus;
  }), [dayRows, search, filterDept, filterStatus]);

  /* ── 단일 일정 등록 ── */
  async function handleAddSave(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.userId || !addForm.date) { toast.error("직원과 날짜를 선택해주세요."); return; }
    const res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(addForm),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("일정이 등록되었습니다.");
    setAddOpen(false);
    setAddForm(defaultForm);
    fetchMonth();
    if (dayOpen && selectedDay === addForm.date) openDay(selectedDay);
  }

  /* ── 일정 삭제 ── */
  async function handleDeleteSchedule(scheduleId: string) {
    const res = await fetch(`/api/schedule/${scheduleId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제 실패"); return; }
    toast.success("일정이 삭제되었습니다.");
    fetchMonth();
    openDay(selectedDay);
  }

  /* ── 일괄 등록 ── */
  function setBulkThisMonth() {
    setBulk(b => ({
      ...b,
      startDate: format(startOfMonth(currentDate), "yyyy-MM-dd"),
      endDate:   format(endOfMonth(currentDate),   "yyyy-MM-dd"),
    }));
  }

  async function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bulk.userIds.length) { toast.error("직원을 1명 이상 선택해주세요."); return; }
    if (!bulk.startDate || !bulk.endDate) { toast.error("기간을 설정해주세요."); return; }
    if (!bulk.weekdays.length) { toast.error("요일을 선택해주세요."); return; }
    setBulkLoading(true);
    try {
      const res  = await fetch("/api/schedule/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bulk),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      toast.success(`${data.count}개 일정 등록 완료 (${data.days}일 × ${bulk.userIds.length}명)`);
      setBulkOpen(false);
      setBulk(defaultBulk);
      fetchMonth();
    } finally { setBulkLoading(false); }
  }

  return (
    <div className="space-y-5">
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">근무일정</h1>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => { setBulkThisMonth(); setBulkOpen(true); }}>
              <Layers size={15} />일괄 등록
            </Button>
            <Button className="gap-2" onClick={() => { setAddForm(defaultForm); setAddOpen(true); }}>
              <Plus size={15} />일정 등록
            </Button>
          </div>
        )}
      </div>

      {/* ── 캘린더 카드 ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-gray-800">
              <CalendarDays size={18} className="text-blue-600" />
              {year}년 {month}월
              <span className="text-sm font-normal text-gray-400 ml-1">전체 {totalEmp}명</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(d => subMonths(d, 1))}>
                <ChevronLeft size={16} />
              </Button>
              <Button variant="ghost" size="sm" className="h-8 px-3 text-xs"
                onClick={() => setCurrentDate(new Date())}>오늘</Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(d => addMonths(d, 1))}>
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-3 pb-4">
          {/* 범례 */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 px-1">
            {[
              { dot: "bg-green-500",  label: "출근" },
              { dot: "bg-orange-500", label: "지각" },
              { dot: "bg-purple-500", label: "조퇴" },
              { dot: "bg-red-500",    label: "결근" },
              { dot: "bg-blue-500",   label: "휴가" },
            ].map(({ dot, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${dot}`} />
                <span className="text-xs text-gray-500">{label}</span>
              </div>
            ))}
          </div>

          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((d, i) => (
              <div key={d} className={`text-center text-xs font-semibold py-1.5
                ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-gray-400"}`}>{d}</div>
            ))}
          </div>

          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: startPad }).map((_, i) => (
              <div key={`pad-${i}`} className="min-h-[90px] bg-gray-50/40 rounded-lg" />
            ))}

            {days.map(day => {
              const dateStr = format(day, "yyyy-MM-dd");
              const d       = dayMap[dateStr];
              const dow     = getDay(day);
              const today   = isToday(day);
              const inMonth = isSameMonth(day, currentDate);

              // 표시할 집계 항목 (0 제외)
              const stats = d ? [
                { val: d.checkedIn,  dot: "bg-green-500",  label: "출근" },
                { val: d.late,       dot: "bg-orange-500", label: "지각" },
                { val: d.earlyLeave, dot: "bg-purple-500", label: "조퇴" },
                { val: d.absent,     dot: "bg-red-500",    label: "결근" },
                { val: d.leave,      dot: "bg-blue-500",   label: "휴가" },
              ].filter(s => s.val > 0) : [];

              return (
                <div
                  key={dateStr}
                  onClick={() => inMonth && openDay(dateStr)}
                  className={`min-h-[90px] rounded-lg p-1.5 border transition-all select-none
                    ${today
                      ? "border-blue-400 bg-blue-50/60"
                      : "border-transparent hover:border-gray-300 hover:bg-gray-50/70"}
                    ${dow === 0 ? "bg-red-50/30" : dow === 6 ? "bg-blue-50/20" : ""}
                    ${inMonth ? "cursor-pointer" : "opacity-0 pointer-events-none"}`}
                >
                  {/* 날짜 번호 */}
                  <p className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full mb-1
                    ${today
                      ? "bg-blue-600 text-white"
                      : dow === 0 ? "text-red-400" : dow === 6 ? "text-blue-400" : "text-gray-600"}`}>
                    {day.getDate()}
                  </p>

                  {/* 집계 배지 */}
                  <div className="space-y-0.5">
                    {stats.slice(0, 4).map(s => (
                      <div key={s.label} className="flex items-center gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
                        <span className="text-[10px] text-gray-600 leading-tight">
                          {s.label} <span className="font-semibold">{s.val}</span>
                        </span>
                      </div>
                    ))}
                    {stats.length === 0 && d && (d.work > 0 || d.off > 0) && (
                      <p className="text-[10px] text-gray-400">예정 {d.work}명</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════
          날짜 상세 다이얼로그
      ═══════════════════════════════════ */}
      <Dialog open={dayOpen} onOpenChange={setDayOpen}>
        <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col p-0 gap-0">
          {/* 헤더 */}
          <DialogHeader className="px-6 pt-5 pb-3 border-b flex-shrink-0">
            <DialogTitle className="text-base font-bold">
              {selectedDay && format(new Date(selectedDay), "yyyy년 MM월 dd일 (EEEE)", { locale: ko })}
            </DialogTitle>

            {/* 요약 행 */}
            {daySummary && (
              <div className="flex flex-wrap gap-3 mt-2">
                {[
                  { label: "전체",    val: daySummary.total,      dot: "bg-gray-400" },
                  { label: "출근",    val: daySummary.checkedIn,  dot: "bg-green-500" },
                  { label: "지각",    val: daySummary.late,       dot: "bg-orange-500" },
                  { label: "조퇴",    val: daySummary.earlyLeave, dot: "bg-purple-500" },
                  { label: "결근",    val: daySummary.absent,     dot: "bg-red-500" },
                  { label: "휴가",    val: daySummary.leave,      dot: "bg-blue-500" },
                  { label: "미입력",  val: daySummary.notYet,     dot: "bg-slate-400" },
                  { label: "휴무",    val: daySummary.off,        dot: "bg-gray-300" },
                ].filter(s => s.val > 0).map(s => (
                  <div key={s.label} className="flex items-center gap-1.5 text-sm">
                    <div className={`w-2 h-2 rounded-full ${s.dot}`} />
                    <span className="text-gray-500">{s.label}</span>
                    <span className="font-bold text-gray-900">{s.val}명</span>
                  </div>
                ))}
              </div>
            )}
          </DialogHeader>

          {/* 필터 행 */}
          <div className="px-6 py-3 border-b flex-shrink-0 flex flex-wrap gap-2 items-center bg-gray-50/50">
            {/* 검색 */}
            <div className="relative flex-1 min-w-40 max-w-52">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="이름·부서 검색"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm bg-white"
              />
            </div>

            {/* 부서 필터 */}
            <Select value={filterDept} onValueChange={v => v && setFilterDept(v)}>
              <SelectTrigger className="h-8 w-36 text-sm bg-white">
                <SelectValue placeholder="부서" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 부서</SelectItem>
                {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* 상태 필터 */}
            <Select value={filterStatus} onValueChange={v => v && setFilterStatus(v)}>
              <SelectTrigger className="h-8 w-36 text-sm bg-white">
                <SelectValue placeholder="상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                {Object.entries(STATUS_CFG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-xs text-gray-400 ml-auto">
              {filteredRows.length}명 표시 / 전체 {dayRows.length}명
            </span>
          </div>

          {/* 직원 목록 */}
          <div className="overflow-y-auto flex-1">
            {dayLoading ? (
              <div className="flex items-center justify-center py-20 text-gray-400">
                <Users size={32} className="animate-pulse" />
                <span className="ml-3">불러오는 중...</span>
              </div>
            ) : filteredRows.length === 0 ? (
              <p className="text-center py-16 text-gray-400 text-sm">조건에 맞는 직원이 없습니다.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white border-b z-10">
                  <tr className="text-left text-xs text-gray-500">
                    <th className="px-4 py-2.5 font-medium w-32">이름</th>
                    <th className="px-3 py-2.5 font-medium w-28">부서</th>
                    <th className="px-3 py-2.5 font-medium w-36">근무 예정</th>
                    <th className="px-3 py-2.5 font-medium w-20">출근</th>
                    <th className="px-3 py-2.5 font-medium w-20">퇴근</th>
                    <th className="px-3 py-2.5 font-medium w-24">상태</th>
                    {isAdmin && <th className="px-3 py-2.5 font-medium w-16"></th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r, idx) => {
                    const cfg = STATUS_CFG[r.status] ?? STATUS_CFG.NO_SCHEDULE;
                    return (
                      <tr key={r.id}
                        className={`border-b last:border-0 hover:bg-gray-50/70 transition-colors
                          ${idx % 2 === 0 ? "" : "bg-gray-50/30"}`}>
                        {/* 이름 */}
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-900">{r.name}</div>
                          <div className="text-xs text-gray-400">{r.position}</div>
                        </td>

                        {/* 부서 */}
                        <td className="px-3 py-2.5 text-gray-600 text-xs">{r.department}</td>

                        {/* 근무 예정 */}
                        <td className="px-3 py-2.5 text-xs text-gray-600">
                          {r.leaveType
                            ? <span className="text-blue-600">{LEAVE_LABEL[r.leaveType] ?? r.leaveType}</span>
                            : r.scheduleType === "WORK"
                              ? `${r.startTime} ~ ${r.endTime}`
                              : r.scheduleType
                                ? <span className="text-gray-400">{TYPE_CFG[r.scheduleType] ?? r.scheduleType}</span>
                                : <span className="text-gray-300">-</span>}
                        </td>

                        {/* 출근 */}
                        <td className="px-3 py-2.5 font-mono text-xs text-gray-700">
                          {r.clockIn ?? <span className="text-gray-300">-</span>}
                        </td>

                        {/* 퇴근 */}
                        <td className="px-3 py-2.5 font-mono text-xs text-gray-700">
                          {r.clockOut ?? <span className="text-gray-300">-</span>}
                        </td>

                        {/* 상태 뱃지 */}
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </span>
                        </td>

                        {/* 관리자: 일정 삭제 */}
                        {isAdmin && (
                          <td className="px-3 py-2.5">
                            {r.scheduleId && (
                              <Button
                                variant="ghost" size="icon"
                                className="h-6 w-6 text-gray-300 hover:text-red-400 hover:bg-red-50"
                                onClick={() => handleDeleteSchedule(r.scheduleId!)}
                              >
                                <X size={12} />
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* 하단 버튼 */}
          {isAdmin && (
            <div className="px-6 py-3 border-t flex-shrink-0 flex items-center gap-2 bg-gray-50/50">
              <Button size="sm" className="gap-1.5" onClick={() => {
                setAddForm({ ...defaultForm, date: selectedDay });
                setAddOpen(true);
              }}>
                <Plus size={13} />이 날 일정 등록
              </Button>
              <span className="text-xs text-gray-400">일정 등록 후 목록이 자동 갱신됩니다.</span>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════
          단일 일정 등록 다이얼로그
      ═══════════════════════════════════ */}
      <Dialog open={addOpen} onOpenChange={open => { if (!open) { setAddOpen(false); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>일정 등록</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddSave} className="space-y-4">
            <div className="space-y-2">
              <Label>직원 *</Label>
              <Select value={addForm.userId} onValueChange={v => v && setAddForm(f => ({ ...f, userId: v }))}>
                <SelectTrigger><SelectValue placeholder="직원 선택" /></SelectTrigger>
                <SelectContent>
                  {employees.map(emp => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name} <span className="text-gray-400">({emp.department})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>날짜 *</Label>
              <Input type="date" value={addForm.date} onChange={e => setAddForm(f => ({ ...f, date: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label>유형</Label>
              <Select value={addForm.type} onValueChange={v => v && setAddForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>출근</Label>
                <Input type="time" value={addForm.startTime} onChange={e => setAddForm(f => ({ ...f, startTime: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>퇴근</Label>
                <Input type="time" value={addForm.endTime} onChange={e => setAddForm(f => ({ ...f, endTime: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>취소</Button>
              <Button type="submit">등록</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════
          일괄 등록 다이얼로그
      ═══════════════════════════════════ */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>근무일정 일괄 등록</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleBulkSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>직원 선택 * <span className="text-gray-400 font-normal text-xs">(다중)</span></Label>
              <div className="max-h-40 overflow-y-auto border rounded-lg p-3 space-y-2">
                {employees.map(emp => (
                  <div key={emp.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`be-${emp.id}`}
                      checked={bulk.userIds.includes(emp.id)}
                      onCheckedChange={c => setBulk(b => ({
                        ...b,
                        userIds: c ? [...b.userIds, emp.id] : b.userIds.filter(id => id !== emp.id),
                      }))}
                    />
                    <label htmlFor={`be-${emp.id}`} className="text-sm cursor-pointer">
                      {emp.name} <span className="text-gray-400 text-xs">({emp.department})</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>기간 *</Label>
                <Button type="button" variant="ghost" size="sm" className="h-6 text-xs text-blue-600" onClick={setBulkThisMonth}>
                  이번 달
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={bulk.startDate} onChange={e => setBulk(b => ({ ...b, startDate: e.target.value }))} />
                <Input type="date" value={bulk.endDate}   onChange={e => setBulk(b => ({ ...b, endDate:   e.target.value }))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>요일 *</Label>
              <div className="flex gap-1.5">
                {WEEKDAYS.map((label, i) => (
                  <button key={i} type="button"
                    onClick={() => setBulk(b => ({
                      ...b,
                      weekdays: b.weekdays.includes(i) ? b.weekdays.filter(d => d !== i) : [...b.weekdays, i].sort(),
                    }))}
                    className={`w-9 h-9 rounded-full text-sm font-medium border transition-colors
                      ${bulk.weekdays.includes(i)
                        ? i===0 ? "bg-red-500 text-white border-red-500"
                          : i===6 ? "bg-blue-500 text-white border-blue-500"
                          : "bg-gray-800 text-white border-gray-800"
                        : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"}`}
                  >{label}</button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>출근 시간</Label>
                <Input type="time" value={bulk.startTime} onChange={e => setBulk(b => ({ ...b, startTime: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>퇴근 시간</Label>
                <Input type="time" value={bulk.endTime} onChange={e => setBulk(b => ({ ...b, endTime: e.target.value }))} />
              </div>
            </div>

            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              ⚠️ 선택한 직원·기간·요일의 기존 일정은 덮어씁니다.
            </p>

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>취소</Button>
              <Button type="submit" disabled={bulkLoading}>{bulkLoading ? "등록 중..." : "일괄 등록"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
