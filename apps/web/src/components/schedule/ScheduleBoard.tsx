"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { format, isToday as isTodayFn } from "date-fns";
import { ko } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LeaveChips, WeekTotalCell, empNoText, type RangeLeaves } from "@/components/schedule/WeekExtras";
import type { WeekHours } from "@/components/schedule/WeekHours";
import {
  type ViewLayout, type ViewUnit, type WeekStart,
  LAYOUT_LABEL, UNIT_LABEL, VIEW_LAYOUTS, VIEW_UNITS, compactTime, daysOf, fmtHours, isViewLayout, isViewUnit,
  netMinutes, rangeOf, rangeTitle, shiftAnchor, timeAxis, timeToMin, ymd,
} from "@/lib/schedule-view";

/**
 * 근무일정 표 공용(2026-10-12 QA #71 보기 전환·목록형) — 본부 근무일정과 원장 팀 근무일정이 같이 쓴다.
 *  · useScheduleView: 보기 단위(일·주·월)·모양(달력형·목록형)·기준 날짜. 단위·모양은 이 브라우저에 기억
 *  · <ScheduleViewBar>: ◀ 오늘 ▶ 제목 + 단위·모양 전환
 *  · <ScheduleBoard>: 달력형 — 일(시간축 띠), 주(요일 칸), 월(날짜 칸 + 월 합계) / 목록형 — 날짜·직원별 표
 *  · 칸·일정을 누르는 동작(onEmptyCell/onSchedule)은 부르는 쪽이 정한다(원장은 추가·고치기, 본부는 보기만)
 */
export type BoardEmployee = { id: string; name: string; empNo?: number | null; branch: string | null; jobGroup?: string | null; position?: string | null; department?: string | null };
export type BoardSchedule = { id: string; userId: string; date: string; startTime: string; endTime: string; branch: string | null; type: string; note?: string | null };

const UNIT_KEY = "schedule.unit", LAYOUT_KEY = "schedule.layout";
const readStored = <T,>(key: string, ok: (v: unknown) => v is T, fallback: T): T => {
  try { const v = window.localStorage.getItem(key); return ok(v) ? v : fallback; } catch { return fallback; }
};
// 이 브라우저에 기억하는 선택(useShowLeave 와 같은 방식) — 서버 렌더는 기본값, 화면에서는 저장값
const choiceSubs = new Set<() => void>();
const subscribeChoice = (cb: () => void) => { choiceSubs.add(cb); return () => { choiceSubs.delete(cb); }; };
function usePersistedChoice<T extends string>(key: string, ok: (v: unknown) => v is T, fallback: T): [T, (v: T) => void] {
  const [unsaved, setUnsaved] = useState<T | null>(null);   // 저장 못 하는 환경이면 이번 화면에서만
  const stored = useSyncExternalStore(subscribeChoice, () => readStored(key, ok, fallback), () => fallback);
  const set = (v: T) => {
    try { window.localStorage.setItem(key, v); setUnsaved(null); } catch { setUnsaved(v); }
    choiceSubs.forEach((cb) => cb());
  };
  return [unsaved ?? stored, set];
}

export function useScheduleView(weekStartsOn: WeekStart = 1) {
  const [unit, setUnit] = usePersistedChoice<ViewUnit>(UNIT_KEY, isViewUnit, "week");
  const [layout, setLayout] = usePersistedChoice<ViewLayout>(LAYOUT_KEY, isViewLayout, "grid");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const range = useMemo(() => rangeOf(anchor, unit, weekStartsOn), [anchor, unit, weekStartsOn]);
  const startYmd = ymd(range.start), endYmd = ymd(range.end);
  return {
    unit, setUnit, layout, setLayout, anchor, setAnchor, range, startYmd, endYmd,
    prev: () => setAnchor((a) => shiftAnchor(a, unit, -1)),
    next: () => setAnchor((a) => shiftAnchor(a, unit, 1)),
    today: () => setAnchor(new Date()),
    /** 주 보기일 때 그 주 월요일(49시간 합계용) — 다른 보기면 빈 문자열 */
    weekMonday: unit === "week" && weekStartsOn === 1 ? startYmd : "",
  };
}

type View = ReturnType<typeof useScheduleView>;

function Segmented<T extends string>({ value, options, label, onChange }: { value: T; options: T[]; label: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-md border bg-white p-0.5 text-xs">
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o}
          className={`px-2.5 py-1 rounded ${value === o ? "bg-gray-900 text-white font-semibold" : "text-gray-600 hover:bg-gray-100"}`}
          onClick={() => onChange(o)}>
          {label(o)}
        </button>
      ))}
    </div>
  );
}

export function ScheduleViewBar({ view, right }: { view: View; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={view.prev} aria-label="이전"><ChevronLeft size={16} /></Button>
        <Button variant="ghost" size="sm" onClick={view.today}>오늘</Button>
        <Button variant="ghost" size="sm" onClick={view.next} aria-label="다음"><ChevronRight size={16} /></Button>
        <span className="text-lg font-semibold ml-2">{rangeTitle(view.range, view.unit)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={view.unit} options={VIEW_UNITS} label={(u) => UNIT_LABEL[u]} onChange={view.setUnit} />
        <Segmented value={view.layout} options={VIEW_LAYOUTS} label={(l) => LAYOUT_LABEL[l]} onChange={view.setLayout} />
        {right}
      </div>
    </div>
  );
}

// ── 표 ──
type BoardProps = {
  view: View;
  employees: BoardEmployee[];
  schedules: BoardSchedule[];
  loading: boolean;
  holidayMap: Map<string, string>;
  leaves: RangeLeaves | null;
  weekHours: WeekHours | null;
  branchColor: (b: string | null | undefined) => string | undefined;
  onEmptyCell?: (userId: string, date: string) => void;
  onSchedule?: (s: BoardSchedule, emp: BoardEmployee) => void;
};

const TYPE_LABEL: Record<string, string> = { work: "근무", off: "휴무", holiday: "공휴일" };
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;

export function ScheduleBoard(props: BoardProps) {
  const { view, loading } = props;
  if (loading) return <div className="p-8 text-center text-gray-500">근무 일정을 불러오는 중...</div>;
  if (view.layout === "list") return <ListView {...props} />;
  if (view.unit === "day") return <DayView {...props} />;
  if (view.unit === "month") return <MonthView {...props} />;
  return <WeekView {...props} />;
}

/** userId → date → 일정(같은 사람·같은 날은 하나) */
function useByUserDate(schedules: BoardSchedule[]) {
  return useMemo(() => {
    const m = new Map<string, Map<string, BoardSchedule[]>>();
    for (const s of schedules) {
      let u = m.get(s.userId); if (!u) { u = new Map(); m.set(s.userId, u); }
      const l = u.get(s.date); if (l) l.push(s); else u.set(s.date, [s]);
    }
    return m;
  }, [schedules]);
}

function dayHeaderInfo(day: Date, holidayMap: Map<string, string>) {
  const key = ymd(day);
  const dow = day.getDay();
  const holidayName = holidayMap.get(key);
  return { key, today: isTodayFn(day), red: dow === 0 || dow === 6 || !!holidayName, holidayName };
}

function EmployeeCell({ emp, branchColor, width = "w-48" }: { emp: BoardEmployee; branchColor: BoardProps["branchColor"]; width?: string }) {
  const c = branchColor(emp.branch);
  return (
    <div className={`${width} border-r border-l-4 p-3 flex-shrink-0 bg-gray-50`} style={{ borderLeftColor: c ?? "transparent" }}>
      <div className="font-medium text-gray-900">
        {emp.name}
        {emp.empNo != null && <span className="ml-1.5 text-xs font-normal text-gray-400" title="사번">{empNoText(emp.empNo)}</span>}
      </div>
      <div className="text-xs text-gray-600">
        {emp.jobGroup || emp.position}
        {emp.branch && <span className={c ? "font-medium" : "text-blue-600"} style={{ color: c }}> · {emp.branch}</span>}
      </div>
    </div>
  );
}

function ScheduleChip({ s, color, onClick }: { s: BoardSchedule; color: string | undefined; onClick?: () => void }) {
  const clickable = !!onClick;
  return (
    <div className={`p-2 bg-blue-100 rounded text-xs ${clickable ? "cursor-pointer hover:ring-2 hover:ring-blue-300" : ""}`}
      style={{ borderLeft: `4px solid ${color ?? "transparent"}` }}
      role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      onClick={onClick}>
      <div className="font-medium text-blue-900">{s.startTime} - {s.endTime}</div>
      <Badge variant="outline" className="mt-1 text-xs">{typeLabel(s.type)}</Badge>
      {s.note && <div className="mt-1 text-[11px] text-gray-600 truncate" title={s.note}>{s.note}</div>}
    </div>
  );
}

function EmptyCell({ onClick, minH = "min-h-[90px]" }: { onClick?: () => void; minH?: string }) {
  if (!onClick) return <div className="text-xs text-gray-400">-</div>;
  return (
    <button type="button" className={`w-full h-full ${minH} text-xs text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded`} onClick={onClick}>+ 추가</button>
  );
}

const NoEmployees = () => <div className="p-8 text-center text-gray-500">표시할 직원이 없습니다.</div>;

// ── 주 보기 ──
function WeekView({ view, employees, schedules, holidayMap, leaves, weekHours, branchColor, onEmptyCell, onSchedule }: BoardProps) {
  const days = daysOf(view.range);
  const by = useByUserDate(schedules);
  const showTotal = !!view.weekMonday;
  return (
    <div className="min-w-full">
      <div className="flex border-b sticky top-0 bg-gray-50">
        <div className="w-48 border-r p-3 flex-shrink-0 bg-gray-50 font-medium">직원</div>
        <div className="flex flex-1">
          {days.map((day) => {
            const h = dayHeaderInfo(day, holidayMap);
            return (
              <div key={h.key} className={`flex-1 min-w-[150px] border-r p-3 text-center font-medium ${h.today ? "bg-blue-50" : h.red ? "bg-red-50" : "bg-white"}`}>
                <div className={h.today ? "text-blue-600" : h.red ? "text-red-600" : ""}>{format(day, "d일(EEE)", { locale: ko })}</div>
                {h.holidayName && <div className="text-[11px] font-normal text-red-500 mt-0.5">{h.holidayName}</div>}
              </div>
            );
          })}
        </div>
        {showTotal && <div className="w-28 flex-shrink-0 p-3 bg-gray-50 font-medium text-sm" title="이번 주 근로시간(휴게 제외)">주간 합계</div>}
      </div>
      {employees.length === 0 ? <NoEmployees /> : employees.map((emp) => (
        <div key={emp.id} className="flex border-b">
          <EmployeeCell emp={emp} branchColor={branchColor} />
          <div className="flex flex-1">
            {days.map((day) => {
              const key = ymd(day);
              const list = by.get(emp.id)?.get(key) ?? [];
              return (
                <div key={key} className="flex-1 min-w-[150px] border-r p-3 min-h-[120px]">
                  <LeaveChips data={leaves} userId={emp.id} date={key} />
                  {list.length === 0 ? <EmptyCell onClick={onEmptyCell ? () => onEmptyCell(emp.id, key) : undefined} /> : (
                    <div className="space-y-2">
                      {list.map((s) => <ScheduleChip key={s.id} s={s} color={branchColor(s.branch ?? emp.branch)} onClick={onSchedule ? () => onSchedule(s, emp) : undefined} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {showTotal && <WeekTotalCell data={weekHours} userId={emp.id} />}
        </div>
      ))}
    </div>
  );
}

// ── 월 보기 — 날짜 칸이 좁아 시간은 「10~19」처럼, 합계는 화면에서 센 일정 근로시간(휴게 제외) ──
function MonthView({ view, employees, schedules, holidayMap, leaves, branchColor, onEmptyCell, onSchedule }: BoardProps) {
  const days = daysOf(view.range);
  const by = useByUserDate(schedules);
  const totals = useMemo(() => {
    const t = new Map<string, number>();
    for (const s of schedules) if (s.type === "work") t.set(s.userId, (t.get(s.userId) ?? 0) + netMinutes(s.startTime, s.endTime));
    return t;
  }, [schedules]);
  return (
    <div className="min-w-full text-xs">
      <div className="flex border-b sticky top-0 bg-gray-50">
        <div className="w-40 border-r p-2 flex-shrink-0 bg-gray-50 font-medium text-sm sticky left-0 z-10">직원</div>
        <div className="flex flex-1">
          {days.map((day) => {
            const h = dayHeaderInfo(day, holidayMap);
            return (
              <div key={h.key} title={h.holidayName} className={`flex-1 min-w-[46px] border-r py-1.5 text-center ${h.today ? "bg-blue-50" : h.red ? "bg-red-50" : "bg-white"}`}>
                <div className={`font-semibold ${h.today ? "text-blue-600" : h.red ? "text-red-600" : "text-gray-800"}`}>{day.getDate()}</div>
                <div className={`text-[10px] ${h.red ? "text-red-400" : "text-gray-400"}`}>{format(day, "EEEEE", { locale: ko })}</div>
              </div>
            );
          })}
        </div>
        <div className="w-20 flex-shrink-0 p-2 bg-gray-50 font-medium text-center" title="이 달 근무일정 근로시간(휴게 제외) — 화면에 보이는 일정 기준">월 합계</div>
      </div>
      {employees.length === 0 ? <NoEmployees /> : employees.map((emp) => (
        <div key={emp.id} className="flex border-b">
          <EmployeeCell emp={emp} branchColor={branchColor} width="w-40 sticky left-0 z-10" />
          <div className="flex flex-1">
            {days.map((day) => {
              const key = ymd(day);
              const list = by.get(emp.id)?.get(key) ?? [];
              const h = dayHeaderInfo(day, holidayMap);
              return (
                <div key={key} className={`flex-1 min-w-[46px] border-r p-0.5 min-h-[52px] ${h.red ? "bg-red-50/40" : ""}`}>
                  <LeaveChips data={leaves} userId={emp.id} date={key} compact />
                  {list.length === 0 ? (
                    onEmptyCell ? <button type="button" aria-label={`${emp.name} ${key} 일정 추가`} className="w-full h-full min-h-[40px] rounded text-gray-200 hover:text-blue-500 hover:bg-blue-50" onClick={() => onEmptyCell(emp.id, key)}>+</button> : null
                  ) : list.map((s) => {
                    const clickable = !!onSchedule;
                    const label = s.type === "work" ? `${compactTime(s.startTime)}~${compactTime(s.endTime)}` : typeLabel(s.type);
                    return (
                      <div key={s.id} title={`${s.startTime} - ${s.endTime} ${typeLabel(s.type)}${s.note ? ` · ${s.note}` : ""}`}
                        className={`px-1 py-1 rounded text-[11px] leading-4 text-center font-medium ${s.type === "work" ? "bg-blue-100 text-blue-900" : "bg-gray-100 text-gray-600"} ${clickable ? "cursor-pointer hover:ring-2 hover:ring-blue-300" : ""}`}
                        style={{ borderLeft: `3px solid ${branchColor(s.branch ?? emp.branch) ?? "transparent"}` }}
                        role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
                        onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSchedule(s, emp); } } : undefined}
                        onClick={clickable ? () => onSchedule(s, emp) : undefined}>
                        {label}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="w-20 flex-shrink-0 p-2 bg-gray-50 text-center text-gray-700 font-medium">{fmtHours(totals.get(emp.id) ?? 0)}</div>
        </div>
      ))}
    </div>
  );
}

// ── 일 보기 — 시간축 위에 근무 띠. 누가 언제 있는지 한눈에 ──
function DayView({ view, employees, schedules, holidayMap, leaves, branchColor, onEmptyCell, onSchedule }: BoardProps) {
  const key = ymd(view.range.start);
  const by = useByUserDate(schedules);
  const todays = useMemo(() => schedules.filter((s) => s.date === key && s.type === "work"), [schedules, key]);
  const { fromH, toH } = timeAxis(todays);
  const hours = Array.from({ length: toH - fromH }, (_, i) => fromH + i);
  const span = (toH - fromH) * 60;
  const pct = (min: number) => `${Math.min(100, Math.max(0, ((min - fromH * 60) / span) * 100))}%`;
  const h = dayHeaderInfo(view.range.start, holidayMap);
  return (
    <div className="min-w-full">
      <div className="flex border-b sticky top-0 bg-gray-50">
        <div className="w-48 border-r p-3 flex-shrink-0 bg-gray-50 font-medium">직원</div>
        <div className={`flex-1 relative min-w-[600px] ${h.today ? "bg-blue-50" : h.red ? "bg-red-50" : "bg-white"}`}>
          <div className="flex h-full">
            {hours.map((hh) => (
              <div key={hh} className="flex-1 border-r py-3 text-center text-xs text-gray-500">{hh}시</div>
            ))}
          </div>
          {h.holidayName && <div className="absolute right-2 top-1 text-[11px] text-red-500">{h.holidayName}</div>}
        </div>
      </div>
      {employees.length === 0 ? <NoEmployees /> : employees.map((emp) => {
        const list = by.get(emp.id)?.get(key) ?? [];
        const works = list.filter((s) => s.type === "work" && timeToMin(s.startTime) != null && timeToMin(s.endTime) != null);
        const others = list.filter((s) => !works.includes(s));
        const leaveList = leaves?.leaves[emp.id]?.[key] ?? [];
        return (
          <div key={emp.id} className="flex border-b">
            <EmployeeCell emp={emp} branchColor={branchColor} />
            <div className="flex-1 relative min-w-[600px] min-h-[64px]">
              <div className="absolute inset-0 flex">
                {hours.map((hh) => <div key={hh} className="flex-1 border-r border-gray-100" />)}
              </div>
              {/* 일정이 없으면 추가 버튼 — 휴가가 있는 날도 주·월 보기처럼 넣을 수 있다(반차 뒤 근무 등, #71 검증 3). 휴가 칩은 그 위에 */}
              {list.length === 0 && onEmptyCell && (
                <button type="button" className={`absolute inset-x-1 bottom-1 rounded text-xs text-gray-300 hover:text-blue-500 hover:bg-blue-50 ${leaveList.length ? "top-8" : "top-1"}`}
                  onClick={() => onEmptyCell(emp.id, key)}>+ 추가</button>
              )}
              <div className="absolute left-2 top-2 flex gap-1 z-10">
                {leaveList.map((l, i) => <span key={i} className="px-2 py-0.5 rounded bg-green-100 border border-green-300 text-[11px] font-medium text-green-800">{l.label}</span>)}
                {others.map((s) => (
                  <span key={s.id} className={`px-2 py-0.5 rounded bg-gray-100 border text-[11px] text-gray-600 ${onSchedule ? "cursor-pointer hover:ring-2 hover:ring-blue-300" : ""}`}
                    role={onSchedule ? "button" : undefined} tabIndex={onSchedule ? 0 : undefined}
                    onKeyDown={onSchedule ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSchedule(s, emp); } } : undefined}
                    onClick={onSchedule ? () => onSchedule(s, emp) : undefined}>{typeLabel(s.type)}</span>
                ))}
              </div>
              {works.map((s) => {
                const sm = timeToMin(s.startTime)!, em = timeToMin(s.endTime)!;
                const clickable = !!onSchedule;
                return (
                  <div key={s.id} title={`${s.startTime} - ${s.endTime}${s.note ? ` · ${s.note}` : ""}`}
                    className={`absolute top-6 h-8 rounded bg-blue-100 text-blue-900 text-xs font-medium flex items-center px-2 overflow-hidden whitespace-nowrap ${clickable ? "cursor-pointer hover:ring-2 hover:ring-blue-300" : ""}`}
                    style={{ left: pct(sm), width: `calc(${pct(Math.max(em, sm + 30))} - ${pct(sm)})`, borderLeft: `4px solid ${branchColor(s.branch ?? emp.branch) ?? "transparent"}` }}
                    role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSchedule(s, emp); } } : undefined}
                    onClick={clickable ? () => onSchedule(s, emp) : undefined}>
                    {s.startTime} - {s.endTime}{s.note ? ` · ${s.note}` : ""}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 목록형 — 날짜순, 같은 날은 직원 순서대로. 일정이나 휴가가 있는 날만 ──
function ListView({ view, employees, schedules, holidayMap, leaves, branchColor, onSchedule }: BoardProps) {
  const days = daysOf(view.range);
  const by = useByUserDate(schedules);
  const rows = useMemo(() => {
    const out: { key: string; day: Date; emp: BoardEmployee; s: BoardSchedule | null; leave: string[] }[] = [];
    for (const day of days) {
      const key = ymd(day);
      for (const emp of employees) {
        const list = by.get(emp.id)?.get(key) ?? [];
        const leave = (leaves?.leaves[emp.id]?.[key] ?? []).map((l) => l.label);
        if (list.length === 0 && leave.length === 0) continue;
        if (list.length === 0) out.push({ key, day, emp, s: null, leave });
        for (const s of list) out.push({ key, day, emp, s, leave });
      }
    }
    return out;
  }, [days, employees, by, leaves]);
  const schedCount = rows.filter((r) => r.s).length, leaveCount = rows.filter((r) => r.leave.length).length;
  if (employees.length === 0) return <NoEmployees />;
  return (
    <div>
      <div className="px-4 py-2 text-xs text-gray-500 border-b bg-gray-50">
        {rangeTitle(view.range, view.unit)} · 일정 {schedCount}건{leaves ? ` · 휴가 ${leaveCount}건` : ""} · 직원 {employees.length}명
      </div>
      {rows.length === 0 ? <div className="p-8 text-center text-gray-500">이 기간에 일정이 없습니다.</div> : (
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white border-b z-10">
            <tr className="text-left text-xs text-gray-500">
              <th className="px-4 py-2.5 font-medium w-36">날짜</th>
              <th className="px-3 py-2.5 font-medium w-40">직원</th>
              <th className="px-3 py-2.5 font-medium w-28">지점</th>
              <th className="px-3 py-2.5 font-medium w-24">직무</th>
              <th className="px-3 py-2.5 font-medium w-32">근무시간</th>
              <th className="px-3 py-2.5 font-medium w-20">유형</th>
              <th className="px-3 py-2.5 font-medium w-32">휴가</th>
              <th className="px-3 py-2.5 font-medium">메모</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const h = dayHeaderInfo(r.day, holidayMap);
              const c = branchColor(r.s?.branch ?? r.emp.branch);
              const clickable = !!(onSchedule && r.s);
              return (
                <tr key={`${r.key}-${r.emp.id}-${r.s?.id ?? "leave"}`}
                  className={`border-b last:border-0 ${i % 2 ? "bg-gray-50/40" : ""} ${clickable ? "cursor-pointer hover:bg-blue-50/60 focus:bg-blue-50/60 outline-none" : ""}`}
                  role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSchedule!(r.s!, r.emp); } } : undefined}
                  onClick={clickable ? () => onSchedule!(r.s!, r.emp) : undefined}>
                  <td className={`px-4 py-2 whitespace-nowrap ${h.red ? "text-red-600" : "text-gray-800"}`}>
                    {format(r.day, "M월 d일 (EEE)", { locale: ko })}
                    {h.holidayName && <span className="ml-1 text-[11px] text-red-400">{h.holidayName}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-block w-1.5 h-4 rounded-sm align-middle mr-2" style={{ backgroundColor: c ?? "#e5e7eb" }} />
                    <span className="font-medium text-gray-900">{r.emp.name}</span>
                    {r.emp.empNo != null && <span className="ml-1.5 text-xs text-gray-400">{empNoText(r.emp.empNo)}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{r.emp.branch ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{r.emp.jobGroup || r.emp.position || "-"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-800">{r.s && r.s.type === "work" ? `${r.s.startTime} - ${r.s.endTime}` : "-"}</td>
                  <td className="px-3 py-2 text-xs">{r.s ? <Badge variant="outline" className="text-xs">{typeLabel(r.s.type)}</Badge> : <span className="text-gray-300">-</span>}</td>
                  <td className="px-3 py-2 text-xs text-green-800">{r.leave.join(", ") || <span className="text-gray-300">-</span>}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 truncate max-w-[240px]" title={r.s?.note ?? undefined}>{r.s?.note ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
