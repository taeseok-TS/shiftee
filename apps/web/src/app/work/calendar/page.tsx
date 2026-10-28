"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Trash2, Share2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, eachDayOfInterval, getDay, isSameMonth, isToday } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import CalendarNotePanel from "./CalendarNotePanel";

type Ev = { id: string; title: string; description: string | null; startDate: string; endDate: string; startTime?: string | null; endTime?: string | null; branch: string | null; managersOnly?: boolean; color: string; canEdit: boolean };
const COLORS: Record<string, string> = { indigo: "bg-indigo-500", blue: "bg-blue-500", green: "bg-green-500", red: "bg-red-500", amber: "bg-amber-500" };
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const EMPTY_FORM = { title: "", description: "", startDate: "", endDate: "", startTime: "", endTime: "", branch: "__ALL__", color: "indigo" };
// 칸에 보일 시각 — 「10:00」 또는 「10:00~11:30」(#221). 종일이면 빈 문자열
const timeLabel = (e: { startTime?: string | null; endTime?: string | null }) => (e.startTime ? (e.endTime ? `${e.startTime}~${e.endTime}` : e.startTime) : "");

export default function WorkCalendarPage() {
  const [cursor, setCursor] = useState(new Date());
  const [events, setEvents] = useState<Ev[]>([]);
  // 권한을 받아 오기 전(null)에는 등록·편집 창을 열지 않는다 — 기본값을 직원으로 두면 관리자가 「우리 지점」 화면으로 보내 전사 일정이 되던 틈(검증 지적)
  const [role, setRole] = useState<string | null>(null);
  const [myBranch, setMyBranch] = useState<string | null>(null); // 「지점에 공유」 중복 검사용 — 내 대표 지점(서버가 공유를 넣는 지점)
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  // 보기 — 월간 / 주간(시각이 들어간 일정을 한 주씩 크게, 2026-10-20 디렉터). 주는 달력과 같이 일요일 시작
  const [view, setView] = useState<"month" | "week">("month");
  const weekStart = startOfWeek(cursor);
  const weekEnd = endOfWeek(cursor);
  // 가져올 달·해 — 주간이 두 달(두 해)에 걸치면 둘 다
  const monthsKey = view === "week"
    ? Array.from(new Set([format(weekStart, "yyyy-M"), format(weekEnd, "yyyy-M")])).join(",")
    : `${year}-${month}`;
  const yearsKey = view === "week"
    ? Array.from(new Set([weekStart.getFullYear(), weekEnd.getFullYear()])).join(",")
    : String(year);

  const fetchSeq = useRef(0); // 빨리 넘길 때 늦게 온 옛 응답이 덮어쓰지 않게
  const fetchEvents = useCallback(async () => {
    const seq = ++fetchSeq.current;
    const lists = await Promise.all(monthsKey.split(",").map(async (k) => {
      const [y, m] = k.split("-");
      const res = await fetch(`/api/work/calendar?year=${y}&month=${m}`);
      return res.ok ? ((await res.json()).events as Ev[]) || [] : null;
    }));
    if (seq !== fetchSeq.current || lists.some((l) => l === null)) return;
    const byId = new Map<string, Ev>();
    for (const l of lists) for (const e of l ?? []) byId.set(e.id, e); // 두 달에 걸친 일정은 한 번만
    setEvents(Array.from(byId.values()));
  }, [monthsKey]);

  // 공휴일 (읽기 전용 표시 — 관리는 관리자 > 공휴일 관리에서)
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    Promise.all(yearsKey.split(",").map((y) => fetch(`/api/holidays?year=${y}`).then((r) => (r.ok ? r.json() : { holidays: [] }))))
      .then((ds) => setHolidays(new Map(ds.flatMap((d) => (d.holidays || []).map((h: { date: string; name: string }) => [h.date, h.name] as [string, string])))))
      .catch(() => {});
  }, [yearsKey]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);
  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => { setRole(d.user?.role ?? null); setMyBranch(d.user?.branch ?? null); }).catch(() => {});
    fetch("/api/branches").then(r => r.ok ? r.json() : { branches: [] }).then(d => setBranches(d.branches || [])).catch(() => {});
  }, []);

  const days = useMemo(() => eachDayOfInterval({ start: startOfMonth(cursor), end: endOfMonth(cursor) }), [cursor]);
  const weekDays = useMemo(() => eachDayOfInterval({ start: startOfWeek(cursor), end: endOfWeek(cursor) }), [cursor]);
  const startPad = getDay(startOfMonth(cursor));

  // 상단 필터: 전체 / 전사 / 지점 / 원장
  const [viewFilter, setViewFilter] = useState<"all" | "company" | "branch" | "managers">("all");
  const hasManagerEvents = events.some((e) => e.managersOnly);
  const visibleEvents = useMemo(() => {
    if (viewFilter === "company") return events.filter((e) => !e.branch && !e.managersOnly);
    if (viewFilter === "branch") return events.filter((e) => !!e.branch);
    if (viewFilter === "managers") return events.filter((e) => e.managersOnly);
    return events;
  }, [events, viewFilter]);

  function eventsOn(day: Date) {
    const d = format(day, "yyyy-MM-dd");
    // 종일 일정 먼저, 시각 있는 일정은 이른 순(#221)
    return visibleEvents
      .filter((e) => format(new Date(e.startDate), "yyyy-MM-dd") <= d && d <= format(new Date(e.endDate), "yyyy-MM-dd"))
      .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  }

  // 편집 모드 (일정 더블클릭)
  const [editId, setEditId] = useState<string | null>(null);
  function openEdit(e: Ev) {
    if (!role) return;
    setForm({
      title: e.title,
      description: e.description || "",
      startDate: format(new Date(e.startDate), "yyyy-MM-dd"),
      endDate: format(new Date(e.endDate), "yyyy-MM-dd"),
      startTime: e.startTime || "",
      endTime: e.endTime || "",
      branch: e.managersOnly ? "__MGR__" : e.branch || "__ALL__",
      color: e.color || "indigo",
    });
    setEditId(e.id);
    setOpen(true);
  }

  async function save() {
    if (!form.title.trim() || !form.startDate) { toast.error("제목과 시작일을 입력해주세요."); return; }
    setSaving(true);
    try {
      const res = await fetch(editId ? `/api/work/calendar/${editId}` : "/api/work/calendar", {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          branch: form.branch === "__ALL__" || form.branch === "__MGR__" ? null : form.branch,
          managersOnly: form.branch === "__MGR__",
          endDate: form.endDate || form.startDate,
          endTime: form.startTime ? form.endTime : "", // 시작 시각을 지우면 끝 시각도 함께 비운다
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || (editId ? "수정 실패" : "등록 실패")); return; }
      toast.success(editId ? "일정이 수정되었습니다." : "일정이 등록되었습니다.");
      setOpen(false);
      setEditId(null);
      setForm(EMPTY_FORM);
      fetchEvents();
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/work/calendar/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제 실패"); return; }
    toast.success("삭제되었습니다."); fetchEvents();
  }

  // 원장 전용(👑) 일정을 우리 지점 일정으로 복사 — 지점 구성원이 본다(#225). 지점은 서버가 원장의 대표 지점으로 넣는다
  const sharingRef = useRef(false); // 두 번 빠르게 눌러 2건 생기지 않게(검증 지적)
  async function shareToBranch(e: Ev) {
    if (sharingRef.current) return;
    if (!myBranch) { toast.error("소속 지점이 없어 공유할 수 없습니다."); return; } // 지점 없는 원장이 보내면 전사 일정이 되어 버린다
    const sd = format(new Date(e.startDate), "yyyy-MM-dd");
    const ed = format(new Date(e.endDate), "yyyy-MM-dd");
    // 겸직 지점 일정도 events 에 섞여 오므로 내 대표 지점 것만 본다
    if (events.some((x) => x.branch === myBranch && !x.managersOnly && x.title === e.title && format(new Date(x.startDate), "yyyy-MM-dd") === sd && (x.startTime ?? null) === (e.startTime ?? null))) {
      toast.info("이미 지점에 공유된 일정입니다."); return;
    }
    sharingRef.current = true;
    try {
      const res = await fetch("/api/work/calendar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: e.title, description: e.description || "", startDate: sd, endDate: ed, startTime: e.startTime || "", endTime: e.endTime || "", branch: null, managersOnly: false, color: e.color }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "공유 실패"); return; }
      toast.success("우리 지점 일정으로 공유했습니다."); await fetchEvents();
    } finally { sharingRef.current = false; }
  }
  const canShare = (e: Ev) => !!e.managersOnly && role === "MANAGER";

  return (
    // 넓은 화면에서 양옆이 남지 않게 최대폭을 넓혔다(#224, 1280 → 1760)
    <div className="p-8 max-w-[1760px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarDays size={22} className="text-indigo-500" />캘린더 <span className="text-sm font-normal text-gray-400">회사·지점 전체 일정</span></h1>
        <Button onClick={() => setOpen(true)} disabled={!role} className="gap-1 bg-indigo-500 hover:bg-indigo-600"><Plus size={16} />일정 등록</Button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        {/* 월간·주간 전환 */}
        <div className="flex rounded-lg border bg-white p-0.5">
          {([{ v: "month", label: "월간" }, { v: "week", label: "주간" }] as const).map((o) => (
            <button key={o.v} onClick={() => setView(o.v)}
              className={`text-xs px-3 py-1 rounded-md ${view === o.v ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}>
              {o.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon" onClick={() => setCursor(view === "week" ? addDays(cursor, -7) : new Date(year, month - 2, 1))}><ChevronLeft size={18} /></Button>
        <span className="text-lg font-semibold">
          {view === "week"
            ? `${weekStart.getFullYear()}년 ${weekStart.getMonth() + 1}월 ${weekStart.getDate()}일 ~ ${isSameMonth(weekStart, weekEnd) ? "" : `${weekEnd.getMonth() + 1}월 `}${weekEnd.getDate()}일`
            : `${year}년 ${month}월`}
        </span>
        <Button variant="ghost" size="icon" onClick={() => setCursor(view === "week" ? addDays(cursor, 7) : new Date(year, month, 1))}><ChevronRight size={18} /></Button>
        <Button variant="ghost" size="sm" onClick={() => setCursor(new Date())}>오늘</Button>
        {/* 일정 종류 필터 */}
        <div className="flex gap-1.5 ml-2">
          {([
            { v: "all", label: "전체" },
            { v: "company", label: "전사" },
            { v: "branch", label: "지점" },
            ...(hasManagerEvents ? [{ v: "managers", label: "👑 원장" }] : []),
          ] as { v: typeof viewFilter; label: string }[]).map((f) => (
            <button key={f.v} onClick={() => setViewFilter(f.v)}
              className={`text-xs rounded-full px-3 py-1 border ${viewFilter === f.v ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
      {view === "week" ? (
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="grid grid-cols-7">
          {weekDays.map((day) => {
            const evs = eventsOn(day);
            const dow = getDay(day);
            const ds = format(day, "yyyy-MM-dd");
            const holidayName = holidays.get(ds);
            return (
              <div
                key={ds}
                className={`min-h-[480px] border-r last:border-r-0 flex flex-col cursor-pointer hover:bg-indigo-50/70 transition-colors ${isToday(day) ? "bg-indigo-50/50" : holidayName ? "bg-red-50/40" : ""}`}
                title="클릭: 이 날짜로 일정 등록"
                onClick={() => {
                  if (!role) return; // 권한을 받기 전에는 열지 않는다
                  setForm(f => ({ ...f, startDate: ds, endDate: ds }));
                  setOpen(true);
                }}
              >
                <div className={`text-center border-b py-2 ${dow === 0 || holidayName ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-gray-700"}`}>
                  <div className="text-xs font-semibold">{WEEKDAYS[dow]}</div>
                  <div className={`text-lg font-bold leading-tight ${isToday(day) ? "text-indigo-600" : ""}`}>{day.getDate()}</div>
                  {holidayName && <div className="text-[10px] text-red-400 truncate px-1">{holidayName}</div>}
                </div>
                <div className="p-1.5 space-y-1.5">
                  {evs.map((e) => {
                    const first = format(new Date(e.startDate), "yyyy-MM-dd") === ds;
                    return (
                      <div key={e.id + ds} className="group relative">
                        <div
                          className={`text-xs text-white rounded-md px-2 py-1.5 ${COLORS[e.color] || COLORS.indigo} ${e.canEdit ? "cursor-pointer" : ""}`}
                          title={e.canEdit ? "더블클릭: 편집" : undefined}
                          onClick={(ev) => ev.stopPropagation()}
                          onDoubleClick={(ev) => { ev.stopPropagation(); if (e.canEdit) openEdit(e); }}
                        >
                          <div className="font-semibold text-[11px] opacity-90">{first ? timeLabel(e) || "종일" : "이어짐"}</div>
                          <div className="break-words leading-snug">{e.managersOnly ? "👑 " : e.branch ? `[${e.branch}] ` : ""}{e.title}</div>
                          {e.description && <div className="text-[11px] opacity-80 mt-0.5 line-clamp-3 whitespace-pre-wrap break-words">{e.description}</div>}
                        </div>
                        {(e.canEdit || canShare(e)) && first && (
                          <div className="absolute -top-1 -right-1 flex gap-0.5 opacity-0 group-hover:opacity-100" onClick={(ev) => ev.stopPropagation()}>
                            {canShare(e) && <button onClick={(ev) => { ev.stopPropagation(); shareToBranch(e); }} title="지점에 공유 — 우리 지점 일정으로 복사해 구성원이 보게" className="bg-white border rounded-full p-0.5 text-indigo-600"><Share2 size={10} /></button>}
                            {e.canEdit && <button onClick={(ev) => { ev.stopPropagation(); remove(e.id); }} title="삭제" className="bg-white border rounded-full p-0.5 text-red-500"><Trash2 size={10} /></button>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      ) : (
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="grid grid-cols-7 border-b">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={`text-center text-sm font-semibold py-2 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-gray-600"}`}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {/* 칸 높이 110 → 150(#224) — 시각 붙은 일정이 두 줄까지 보이게 */}
          {Array.from({ length: startPad }).map((_, i) => <div key={`p${i}`} className="min-h-[150px] border-b border-r bg-gray-50/40" />)}
          {days.map((day) => {
            const evs = eventsOn(day);
            const dow = getDay(day);
            const holidayName = holidays.get(format(day, "yyyy-MM-dd"));
            return (
              <div
                key={day.toISOString()}
                className={`min-h-[150px] border-b border-r p-1.5 cursor-pointer hover:bg-indigo-50/70 transition-colors ${isToday(day) ? "bg-indigo-50/50" : holidayName ? "bg-red-50/40" : ""}`}
                title="클릭: 이 날짜로 일정 등록"
                onClick={() => {
                  // 빈 공간 클릭 → 그 날짜가 채워진 등록 다이얼로그 (개선 제안 2026-08-24)
                  // 일정 칩 클릭은 각자 stopPropagation 하므로 여기 안 옴. 직원도 자기 지점 일정은 등록한다(2026-10-20)
                  if (!role) return; // 권한을 받기 전에는 열지 않는다
                  const d = format(day, "yyyy-MM-dd");
                  setForm(f => ({ ...f, startDate: d, endDate: d }));
                  setOpen(true);
                }}
              >
                <div className={`text-xs font-medium mb-1 ${dow === 0 || holidayName ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-gray-600"}`}>
                  {day.getDate()}
                  {holidayName && <span className="ml-1 font-normal text-[10px] text-red-400">{holidayName}</span>}
                </div>
                <div className="space-y-1">
                  {evs.map((e) => (
                    <div key={e.id + day.toISOString()} className="group relative">
                      <div
                        className={`text-[11px] text-white rounded px-1.5 py-0.5 line-clamp-2 break-words leading-snug ${COLORS[e.color] || COLORS.indigo} ${e.canEdit ? "cursor-pointer" : ""}`}
                        title={`${timeLabel(e) ? timeLabel(e) + " " : ""}${e.title}${e.canEdit ? " (더블클릭: 편집)" : ""}`}
                        onClick={(ev) => ev.stopPropagation()}
                        onDoubleClick={(ev) => { ev.stopPropagation(); if (e.canEdit) openEdit(e); }}
                      >
                        {e.startTime && format(new Date(e.startDate), "yyyy-MM-dd") === format(day, "yyyy-MM-dd") && <span className="font-semibold mr-1">{e.startTime}</span>}
                        {e.managersOnly ? "👑 " : e.branch ? `[${e.branch}] ` : ""}{e.title}
                      </div>
                      {(e.canEdit || canShare(e)) && format(new Date(e.startDate), "yyyy-MM-dd") === format(day, "yyyy-MM-dd") && (
                        <div className="absolute -top-1 -right-1 flex gap-0.5 opacity-0 group-hover:opacity-100" onClick={(ev) => ev.stopPropagation()}>
                          {canShare(e) && <button onClick={(ev) => { ev.stopPropagation(); shareToBranch(e); }} title="지점에 공유 — 우리 지점 일정으로 복사해 구성원이 보게" className="bg-white border rounded-full p-0.5 text-indigo-600"><Share2 size={10} /></button>}
                          {e.canEdit && <button onClick={(ev) => { ev.stopPropagation(); remove(e.id); }} title="삭제" className="bg-white border rounded-full p-0.5 text-red-500"><Trash2 size={10} /></button>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}
      {/* 이달의 지점 공유(#222) — 지점·달마다 하나, 원장·관리자가 쓰고 구성원이 본다 */}
      <CalendarNotePanel key={`${year}-${month}`} ym={`${year}-${String(month).padStart(2, "0")}`} />
      </div>

      <p className="text-xs text-gray-400 mt-3">※ 회사 전체(전사)와 우리 지점 일정만 표시됩니다. 지점 일정은 그 지점 구성원만 봅니다. 개인 근무일정·휴가와는 별개입니다.</p>

      <Dialog open={open && !!role} onOpenChange={(v) => { setOpen(v); if (!v) { setEditId(null); setForm(EMPTY_FORM); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editId ? "일정 편집" : "일정 등록"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="일정 제목" value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} />
            <Textarea placeholder="설명 (선택)" rows={3} value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500">시작일</label><Input type="date" max="9999-12-31" value={form.startDate} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500">종료일</label><Input type="date" max="9999-12-31" value={form.endDate} onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            {/* 시각(선택, #221) — 비우면 종일 */}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500">시작 시각 <span className="text-gray-400">(선택 · 비우면 종일)</span></label><Input type="time" step={300} value={form.startTime} onChange={(e) => setForm(f => ({ ...f, startTime: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500">끝 시각 <span className="text-gray-400">(선택)</span></label><Input type="time" step={300} value={form.endTime} disabled={!form.startTime} onChange={(e) => setForm(f => ({ ...f, endTime: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">대상</label>
                {role === "EMPLOYEE" ? (
                  // 직원 — 자기 지점 고정(다른 지점에는 안 보임)
                  <div className="h-9 flex items-center px-3 border rounded-md text-sm text-gray-700 bg-gray-50">우리 지점 (지점 구성원만 보임)</div>
                ) : role === "ADMIN" ? (
                  <Select value={form.branch} onValueChange={(v) => setForm(f => ({ ...f, branch: v }))}>
                    <SelectTrigger><SelectValue>{form.branch === "__ALL__" ? "전사 공통" : form.branch === "__MGR__" ? "👑 원장 전용 (원장·관리자만 보임)" : form.branch}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__ALL__">전사 공통</SelectItem>
                      <SelectItem value="__MGR__">👑 원장 전용 (원장·관리자만 보임)</SelectItem>
                      {branches.map((b) => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={form.branch === "__MGR__" ? "__MGR__" : "__ALL__"} onValueChange={(v) => setForm(f => ({ ...f, branch: v }))}>
                    <SelectTrigger><SelectValue>{form.branch === "__MGR__" ? "👑 원장 전용 (원장·관리자만 보임)" : "내 지점"}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__ALL__">내 지점</SelectItem>
                      <SelectItem value="__MGR__">👑 원장 전용 (원장·관리자만 보임)</SelectItem>
                    </SelectContent>
                  </Select>
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
              <Button variant="outline" onClick={() => { setOpen(false); setEditId(null); setForm(EMPTY_FORM); }}>취소</Button>
              <Button onClick={save} disabled={saving}>{saving ? "저장 중..." : editId ? "수정" : "등록"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
