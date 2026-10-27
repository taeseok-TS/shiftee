"use client";

import { useMemo, useState } from "react";
import { format, isToday as isTodayFn } from "date-fns";
import { ko } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Btn, StatusPill } from "@/components/kit";
import { WeekTotalCell, empNoText, type DayLeave, type RangeLeaves } from "@/components/schedule/WeekExtras";
import type { WeekHours } from "@/components/schedule/WeekHours";
import { useUserPrefs } from "@/components/prefs/useUserPrefs";
import { ViewSettingsMenu } from "@/components/schedule/ScheduleControls";
import {
  type DateRange, type SchedulePrefs, type ShowKey, type ViewLayout, type ViewUnit,
  LAYOUT_LABEL, SCHEDULE_PREFS_DEFAULT, VIEW_LAYOUTS, VIEW_UNITS, cleanSchedulePrefs, compactTime, daysOf, fmtHours,
  netMinutes, rangeOf, shiftAnchor, timeAxis, timeToMin, ymd,
} from "@/lib/schedule-view";

/**
 * 근무일정 표 공용(2026-10-12 QA #71 보기 전환·목록형) — 본부 근무일정과 원장 지점 근무일정이 같이 쓴다.
 *  · useScheduleView: 보기 단위(하루·1주·한 달)·모양(달력형·목록형)·기준 날짜 + 정렬·표시 항목(#73). 사람마다 서버에 저장
 *  · <ScheduleViewBar>: ‹ 기간 › 오늘 + 단위·모양 전환
 *  · <ScheduleBoard>: 달력형 — 하루(시간축 띠), 1주(띠 표), 한 달(날짜 칸) / 목록형 — 날짜·직원별 표
 *  · 칸·일정을 누르는 동작(onEmptyCell/onSchedule)은 부르는 쪽이 정한다
 *
 * 2026-10-23 오픈 전 ■0-5 · ■3(시안 R18) · ■4
 *  · 하루 휴가(연차 등)인 날은 근무 시간 대신 휴가만. 반차는 「반차 18–22」처럼 일하는 시간까지
 *  · 1주 보기: 같은 근무가 이어지면 띠 하나(3칸 이상 「13:00–22:00」, 2칸 이하 「13–22」), 띠 안에서도 날짜마다 눌림.
 *    기본 근무 = 연회색 면, 시간 변경 = 흰 바탕 + 인디고 테두리, 휴가 = 연파랑 면, 주말 · 공휴일 근무 = 연보라 면,
 *    결재 대기(휴가 · 근무 변경) = 같은 색 점선 테두리. 칩 왼쪽 세로 막대 · 이름 칸 왼쪽 지점 막대는 뺐다
 *  · 「기본 근무」는 따로 정해 둔 값이 없어 **그 사람이 이 기간 평일에 가장 많이 한 시간**으로 본다
 *  · 지점은 묶음 제목에 한 번(「평촌 11명」), 맨 아래 줄은 날짜별 근무 · 휴가 인원(반차는 근무로 셈)
 *  · 한 주 = 월~일(설정의 「한 주의 시작 요일」은 쓰지 않는다), 토 · 일 · 공휴일은 회색 글자 + 옅은 칸
 *  · 주 근무시간 열은 서버가 숫자를 숨기면(원장) 「52시간 안 / 넘음」만 보인다. 한 달 합계 열은 hoursHidden 이면 그리지 않는다
 */
export type BoardEmployee = { id: string; name: string; empNo?: number | null; branch: string | null; jobGroup?: string | null; position?: string | null; department?: string | null; hireDate?: string | null; isTest?: boolean };
type Show = Record<ShowKey, boolean>;
export type BoardSchedule = { id: string; userId: string; date: string; startTime: string; endTime: string; branch: string | null; type: string; note?: string | null };

const WEEK_START = 1 as const;   // 한 주 = 월~일(■4)

/** 보기 단위·모양·정렬·표시 — 사람마다 저장(#73). 기준 날짜는 화면마다. 한 주는 늘 월~일(■4) */
export function useScheduleView() {
  const [prefs, setPrefs] = useUserPrefs<SchedulePrefs>("schedule", SCHEDULE_PREFS_DEFAULT, cleanSchedulePrefs);
  const { unit, layout } = prefs;
  const weekStart = WEEK_START;
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const range = useMemo(() => rangeOf(anchor, unit, WEEK_START), [anchor, unit]);
  const startYmd = ymd(range.start), endYmd = ymd(range.end);
  return {
    prefs, setPrefs, show: prefs.show, weekStart,
    unit, setUnit: (u: ViewUnit) => setPrefs({ unit: u }), layout, setLayout: (l: ViewLayout) => setPrefs({ layout: l }),
    anchor, setAnchor, range, startYmd, endYmd,
    prev: () => setAnchor((a) => shiftAnchor(a, unit, -1)),
    next: () => setAnchor((a) => shiftAnchor(a, unit, 1)),
    today: () => setAnchor(new Date()),
    /** 1주 보기일 때 그 주 월요일(법정 49시간 합계용) — 아니면 빈 문자열 */
    weekMonday: unit === "week" ? startYmd : "",
  };
}

type View = ReturnType<typeof useScheduleView>;

const UNIT_TEXT: Record<ViewUnit, string> = { day: "하루", week: "1주", month: "한 달" };

/** 기간 제목 — 「2026년 10월 26일 (월) – 11월 1일 (일)」 · 「2026년 10월」 · 「2026년 10월 26일 (월)」 */
export function viewTitle(range: DateRange, unit: ViewUnit): string {
  const f = (d: Date, p: string) => format(d, p, { locale: ko });
  if (unit === "day") return f(range.start, "yyyy년 M월 d일 (EEE)");
  if (unit === "month") return f(range.start, "yyyy년 M월");
  const sameYear = range.start.getFullYear() === range.end.getFullYear();
  const sameMonth = sameYear && range.start.getMonth() === range.end.getMonth();
  return `${f(range.start, "yyyy년 M월 d일 (EEE)")} – ${f(range.end, sameMonth ? "d일 (EEE)" : sameYear ? "M월 d일 (EEE)" : "yyyy년 M월 d일 (EEE)")}`;
}

function Segmented<T extends string>({ value, options, label, onChange, name }: { value: T; options: T[]; label: (v: T) => string; onChange: (v: T) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="inline-flex overflow-hidden rounded-[10px] border border-[#e2e8f0] bg-white">
      {options.map((o, i) => (
        <button key={o} type="button" role="radio" aria-checked={value === o}
          className={`min-h-9 px-3.5 text-[13px] font-semibold ${i ? "border-l border-[#e2e8f0]" : ""} ${value === o ? "bg-[#eef2ff] text-[#4f46e5]" : "text-[#475569] hover:bg-[#f8fafc]"}`}
          onClick={() => onChange(o)}>
          {label(o)}
        </button>
      ))}
    </div>
  );
}

const NAV_BTN = "grid h-11 w-11 place-items-center rounded-[9px] border border-[#e2e8f0] bg-white text-[#475569] hover:bg-[#f8fafc] md:h-9 md:w-9";

export function ScheduleViewBar({ view, right, hideShow }: { view: View; right?: React.ReactNode; hideShow?: ShowKey[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="flex items-center gap-1.5">
        <button type="button" className={NAV_BTN} onClick={view.prev} aria-label="이전 기간"><ChevronLeft size={15} /></button>
        <b className="whitespace-nowrap px-1.5 text-[15px] font-bold tabular-nums text-[#0f172a]">{viewTitle(view.range, view.unit)}</b>
        <button type="button" className={NAV_BTN} onClick={view.next} aria-label="다음 기간"><ChevronRight size={15} /></button>
        <Btn className="ml-1 min-h-9" onClick={view.today}>오늘</Btn>
      </div>
      <Segmented name="보기 단위" value={view.unit} options={VIEW_UNITS} label={(u) => UNIT_TEXT[u]} onChange={view.setUnit} />
      <Segmented name="보기 모양" value={view.layout} options={VIEW_LAYOUTS} label={(l) => LAYOUT_LABEL[l]} onChange={view.setLayout} />
      <ViewSettingsMenu prefs={view.prefs} onChange={view.setPrefs} hideShow={["leave", ...(hideShow ?? [])]} />
      {right}
    </div>
  );
}

/** 범례 — 표가 실제로 칠하는 모양과 같게 */
export function ScheduleLegend({ className = "" }: { className?: string }) {
  const i = "mr-1.5 inline-block h-4 w-[26px] rounded-[5px] align-[-3px]";
  return (
    <div className={`flex flex-wrap items-center gap-x-[18px] gap-y-1.5 text-[13px] text-[#475569] ${className}`}>
      <span><i className={`${i} border border-[#cbd5e1] bg-[#eef1f6]`} />기본 근무</span>
      <span><i className={`${i} border-[1.5px] border-[#818cf8] bg-white`} />시간 변경</span>
      <span><i className={`${i} bg-[#dbeafe]`} />휴가</span>
      <span><i className={`${i} bg-[#ede9fe]`} />주말 근무</span>
      <span><i className={`${i} border-[1.5px] border-dashed border-[#60a5fa] bg-white`} />결재 대기(점선)</span>
      <span><i className={`${i} border border-[#e2e8f0] bg-[#f8fafc]`} />휴무</span>
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
  /** 근무시간 숫자(한 달 합계 열)를 그리지 않는다 — 원장 화면(■0-11 근무시간은 본부만) */
  hoursHidden?: boolean;
  onEmptyCell?: (userId: string, date: string) => void;
  onSchedule?: (s: BoardSchedule, emp: BoardEmployee) => void;
};

const TYPE_LABEL: Record<string, string> = { work: "근무", off: "휴무", holiday: "공휴일" };
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;
/** 메모의 이관 흔적은 화면에서 뺀다(■3 · ■4 — 기록에는 그대로) */
export const cleanNote = (n?: string | null) => (n ?? "").replace(/\[\s*시프티\s*이관\s*\]\s*/g, "").replace(/^시프티\s*이관\s*[·:-]?\s*/, "").trim();

export function ScheduleBoard(props: BoardProps) {
  const { view, loading } = props;
  if (loading) return <div className="p-8 text-center text-[14px] text-[#596578]">근무일정을 불러오는 중…</div>;
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

type DayInfo = { key: string; day: Date; dow: number; off: boolean; today: boolean; holidayName?: string; weekStart: boolean };
function dayInfos(days: Date[], holidayMap: Map<string, string>): DayInfo[] {
  return days.map((day, i) => {
    const key = ymd(day), dow = day.getDay(), holidayName = holidayMap.get(key);
    return { key, day, dow, off: dow === 0 || dow === 6 || !!holidayName, today: isTodayFn(day), holidayName, weekStart: i > 0 && dow === 1 };
  });
}

/** 사람별 「기본 근무」 — 이 기간 평일(공휴일 빼고)에 가장 많이 한 시간(같으면 먼저 나온 것) */
function useBaseTimes(schedules: BoardSchedule[], holidayMap: Map<string, string>) {
  return useMemo(() => {
    const cnt = new Map<string, Map<string, number>>();
    for (const s of schedules) {
      if (s.type !== "work") continue;
      const [y, m, d] = s.date.split("-").map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      if (dow === 0 || dow === 6 || holidayMap.has(s.date)) continue;
      let u = cnt.get(s.userId); if (!u) { u = new Map(); cnt.set(s.userId, u); }
      const k = `${s.startTime}-${s.endTime}`;
      u.set(k, (u.get(k) ?? 0) + 1);
    }
    const out = new Map<string, string>();
    for (const [uid, m] of cnt) {
      let best = "", n = 0;
      for (const [k, c] of m) if (c > n) { best = k; n = c; }
      out.set(uid, best);
    }
    return out;
  }, [schedules, holidayMap]);
}

// ── 칸 하나의 모양 ──
type Kind = "base" | "chg" | "wk" | "vac" | "half" | "vacp" | "chgp" | "wkp" | "off" | "empty";
type DayCell = {
  date: string; kind: Kind; merge: string; s: BoardSchedule | null;
  text: string;      // 한 칸일 때 글자
  long?: string;     // 3칸 이상 띠일 때 글자(시간 「13:00–22:00」)
  leaveLabel?: string;
  title: string;
  work: boolean;     // 맨 아래 「근무」 인원에 셈(반차 포함)
  leave: boolean;    // 맨 아래 「휴가」 인원에 셈(하루 휴가)
};
const KIND_CLS: Record<Kind, string> = {
  base: "bg-[#eef1f6] text-[#334155] font-semibold",
  chg: "bg-white border-[1.5px] border-[#818cf8] text-[#3730a3] font-bold",
  wk: "bg-[#ede9fe] text-[#5b21b6] font-bold",
  vac: "bg-[#dbeafe] text-[#1e40af] font-bold",
  half: "bg-[#dbeafe] text-[#1e40af] font-bold text-[12px]",
  vacp: "bg-[#f8fbff] border-[1.5px] border-dashed border-[#60a5fa] text-[#1e40af] font-bold",
  chgp: "bg-white border-[1.5px] border-dashed border-[#818cf8] text-[#3730a3] font-bold",
  wkp: "bg-[#fbfaff] border-[1.5px] border-dashed border-[#a78bfa] text-[#5b21b6] font-bold text-[12px]",
  off: "bg-[#f8fafc] border border-[#e2e8f0] text-[#64748b] font-medium",
  empty: "",
};
const isFull = (l: DayLeave) => !l.unit || l.unit === "FULL";
const shortLeave = (l: DayLeave) => (l.unit === "HALF" ? "반차" : l.unit === "QUARTER" ? "반반차" : l.label);
const dash = (a: string, b: string) => `${a}–${b}`;
const shortTime = (st: string, et: string) => dash(compactTime(st), compactTime(et));

function buildCell(empId: string, info: DayInfo, list: BoardSchedule[], leaves: RangeLeaves | null, baseKey: string | undefined, show: Show): DayCell {
  const date = info.key;
  const s = list[0] ?? null;
  const appr = leaves?.leaves[empId]?.[date] ?? [];
  const pend = leaves?.pendingLeaves?.[empId]?.[date] ?? [];
  const ps = leaves?.pendingSchedules?.[empId]?.[date];
  const work = !!s && s.type === "work";
  const note = cleanNote(s?.note);
  const sTitle = s ? `${s.type === "work" ? dash(s.startTime, s.endTime) : typeLabel(s.type)}${note ? ` · ${note}` : ""}` : "";
  const base = { date, s };

  const full = appr.find(isFull);
  if (full) {
    const label = appr.filter(isFull).map((l) => l.label).join("·");
    return { ...base, kind: "vac", merge: `vac|${label}`, text: label, leaveLabel: label, title: `${label}${s ? ` (일정 ${sTitle})` : ""}`, work: false, leave: true };
  }
  const pFull = pend.find(isFull);
  if (pFull) {
    return { ...base, kind: "vacp", merge: `vacp|${pFull.label}`, text: `${pFull.label} · 결재 대기`, leaveLabel: pFull.label, title: `${pFull.label} 결재 대기${s ? ` (일정 ${sTitle})` : ""}`, work, leave: false };
  }
  if (ps) {
    if (ps.kind === "DELETE") return { ...base, kind: "chgp", merge: "del", text: "삭제 요청", title: `일정 삭제 요청 · 결재 대기${s ? ` (지금 ${sTitle})` : ""}`, work, leave: false };
    const st = ps.startTime ?? s?.startTime ?? "", et = ps.endTime ?? s?.endTime ?? "";
    return { ...base, kind: info.off ? "wkp" : "chgp", merge: `p|${st}|${et}`, text: show.time ? shortTime(st, et) : "근무", long: show.time ? dash(st, et) : "근무",
      // 결재 대기 근무 변경은 아직 확정 전 — 인원은 지금 확정된 일정대로 센다(삭제 요청 · 휴가 결재 대기와 같게)
      title: `근무 변경 ${dash(st, et)} · 결재 대기${s ? ` (지금 ${sTitle})` : ""}`, work, leave: false };
  }
  const half = appr[0] ?? pend[0];
  if (half) {
    const pending = !appr.length;
    const t = work && show.time ? ` ${shortTime(s!.startTime, s!.endTime)}` : "";
    return { ...base, kind: pending ? "vacp" : "half", merge: `half|${half.type}|${s?.startTime}|${s?.endTime}|${pending}`, text: `${shortLeave(half)}${t}${pending ? " · 결재 대기" : ""}`,
      title: `${half.label}${pending ? " 결재 대기" : ""}${s ? ` · 일정 ${sTitle}` : ""}`, work, leave: false };
  }
  if (s) {
    if (s.type !== "work") return { ...base, kind: "off", merge: `off|${s.type}`, text: typeLabel(s.type), title: sTitle, work: false, leave: false };
    const k = `${s.startTime}-${s.endTime}`;
    const kind: Kind = info.off ? "wk" : baseKey && k !== baseKey ? "chg" : "base";
    return { ...base, kind, merge: `${kind}|${k}`, text: show.time ? shortTime(s.startTime, s.endTime) : "근무", long: show.time ? dash(s.startTime, s.endTime) : "근무", title: sTitle, work: true, leave: false };
  }
  return { ...base, kind: "empty", merge: "", text: "", title: "", work: false, leave: false };
}

/** 띠 글자 — 시간은 3칸 이상이면 「13:00–22:00」, 휴가는 「연차 3일」 */
function bandText(cells: DayCell[]): string {
  const c = cells[0], n = cells.length;
  if (c.kind === "vac") return n > 1 ? `${c.leaveLabel} ${n}일` : c.text;
  if (c.kind === "vacp" && c.merge.startsWith("vacp|")) return n > 1 ? `${c.leaveLabel} ${n}일 · 결재 대기` : c.text;
  if (n >= 3 && c.long) return c.long;
  return c.text;
}

/** 같은 모양이 이어지는 칸을 띠로 — 월요일에서 끊는다(한 주 = 월~일) */
function toBands(cells: DayCell[], infos: DayInfo[]): { i: number; cells: DayCell[] }[] {
  const out: { i: number; cells: DayCell[] }[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.kind === "empty") continue;
    const last = out[out.length - 1];
    if (last && last.i + last.cells.length === i && last.cells[0].merge === c.merge && !infos[i].weekStart) last.cells.push(c);
    else out.push({ i, cells: [c] });
  }
  return out;
}

const groupByBranch = (list: BoardEmployee[]) => {
  const m = new Map<string, BoardEmployee[]>();
  for (const e of list) { const k = e.branch ?? ""; const a = m.get(k); if (a) a.push(e); else m.set(k, [e]); }
  return [...m.entries()].sort(([a], [b]) => (a ? (b ? a.localeCompare(b, "ko") : -1) : 1));
};

const jobOf = (e: BoardEmployee) => e.jobGroup || e.position || "";
const NoEmployees = () => <div className="p-8 text-center text-[14px] text-[#596578]">표시할 직원이 없습니다.</div>;

function WhoCell({ emp, show, className = "" }: { emp: BoardEmployee; show: Show; className?: string }) {
  return (
    <div className={`sticky left-0 z-10 flex min-w-0 flex-col justify-center bg-white pl-6 pr-3 ${className}`}>
      <b className="truncate text-[14.5px] font-bold text-[#0f172a]">
        {emp.name}
        {show.empNo && emp.empNo != null && <span className="ml-1.5 text-[12px] font-normal text-[#94a3b8]" title="사번">{empNoText(emp.empNo)}</span>}
      </b>
      {show.subline && jobOf(emp) && <span className="truncate text-[12.5px] font-semibold text-[#475569]">{jobOf(emp)}</span>}
    </div>
  );
}

function AddButton({ label, onClick, className = "" }: { label: string; onClick: () => void; className?: string }) {
  // PC(마우스)는 칸에 올렸을 때, 태블릿 · 폰(터치)은 늘 보인다(■3 시안 R18 ④)
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className={`absolute inset-x-[3px] top-1/2 h-[34px] -translate-y-1/2 rounded-lg border-[1.5px] border-dashed border-[#a5b4fc] bg-white text-[13px] font-semibold text-[#4f46e5] opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${className}`}>
      + 추가
    </button>
  );
}

// ── 1주 보기(시안 R18) ──
function WeekView({ view, employees, schedules, holidayMap, leaves, weekHours, hoursHidden, onEmptyCell, onSchedule }: BoardProps) {
  const infos = dayInfos(daysOf(view.range), holidayMap);
  const by = useByUserDate(schedules);
  const baseTimes = useBaseTimes(schedules, holidayMap);
  const show = view.show;
  // 주 합계 열 — 숫자를 숨긴 응답(원장)이면 셀이 「52시간 안 / 넘음」만 그린다(WeekTotalCell). hoursHidden prop 은 한 달 합계 열용
  void hoursHidden;
  const hoursOk = show.total && !!weekHours;
  const cols = `minmax(150px,196px) repeat(${infos.length}, minmax(84px, 1fr))${hoursOk ? " 104px" : ""}`;
  const groups = groupByBranch(employees);
  const workCnt = infos.map(() => 0), leaveCnt = infos.map(() => 0);
  const rows = new Map<string, DayCell[]>();
  for (const emp of employees) {
    const cells = infos.map((x) => buildCell(emp.id, x, by.get(emp.id)?.get(x.key) ?? [], leaves, baseTimes.get(emp.id), show));
    cells.forEach((c, i) => { if (c.work) workCnt[i]++; if (c.leave) leaveCnt[i]++; });
    rows.set(emp.id, cells);
  }
  const dayCls = (x: DayInfo) => `${x.weekStart ? "border-l border-[#e2e8f0]" : ""} ${x.today ? "bg-[#f7f8ff]" : x.off ? "bg-[#fafbfc]" : ""}`;
  if (employees.length === 0) return <NoEmployees />;
  return (
    <div className="w-max min-w-full text-[13px]">
      <div className="sticky top-0 z-20 grid border-b border-[#eef1f5] bg-[#fafbfd]" style={{ gridTemplateColumns: cols }}>
        <div className="sticky left-0 z-10 flex items-center bg-[#fafbfd] pl-6 text-[13px] font-semibold text-[#596578]">직원</div>
        {infos.map((x) => (
          <div key={x.key} className={`px-0.5 pb-[9px] pt-2.5 text-center leading-tight ${x.weekStart ? "border-l border-[#e2e8f0]" : ""}`} title={x.holidayName}>
            <b className={`mx-auto mb-px block h-7 w-7 rounded-full text-[15px] font-bold leading-7 tabular-nums ${x.today ? "bg-[#4f46e5] text-white" : x.off ? "text-[#64748b]" : "text-[#0f172a]"}`}>{x.day.getDate()}</b>
            <span className="text-[12px] text-[#596578]">{format(x.day, "EEE", { locale: ko })}</span>
            {x.holidayName && <span className="block truncate px-1 text-[11px] text-[#64748b]">{x.holidayName}</span>}
          </div>
        ))}
        {hoursOk && <div className="flex items-center justify-center text-[12.5px] font-semibold text-[#596578]" title="이번 주 근로시간(휴게 제외) — 49시간을 넘으면 빨간색">주간 합계</div>}
      </div>
      {groups.map(([branch, list]) => (
        <div key={branch || "-"}>
          <div className="flex items-center gap-2 border-b border-[#eef1f5] bg-white px-6 py-[11px] text-[14px] font-bold text-[#0f172a]">
            <span className="sticky left-6">{branch || "지점 없음"} <span className="ml-1 text-[13px] font-medium text-[#596578]">{list.length}명</span></span>
          </div>
          {list.map((emp) => {
            const cells = rows.get(emp.id)!;
            return (
              <div key={emp.id} className="grid border-b border-[#f1f5f9]" style={{ gridTemplateColumns: cols }}>
                <WhoCell emp={emp} show={show} className="h-[54px]" />
                {infos.map((x, i) => (
                  <div key={x.key} className={`group relative h-[54px] ${dayCls(x)}`} style={{ gridRow: 1, gridColumn: i + 2 }}>
                    {cells[i].kind === "empty" && onEmptyCell && (
                      <AddButton label={`${emp.name} ${format(x.day, "M월 d일 (EEE)", { locale: ko })} 일정 추가`} onClick={() => onEmptyCell(emp.id, x.key)} />
                    )}
                  </div>
                ))}
                {toBands(cells, infos).map((b) => (
                  <Band key={b.i} band={b.cells} emp={emp} onSchedule={onSchedule} onEmptyCell={onEmptyCell} style={{ gridRow: 1, gridColumn: `${b.i + 2} / span ${b.cells.length}` }} />
                ))}
                {hoursOk && <div style={{ gridRow: 1, gridColumn: infos.length + 2 }}><WeekTotalCell data={weekHours} userId={emp.id} /></div>}
              </div>
            );
          })}
        </div>
      ))}
      <div className="grid border-t border-[#e2e8f0] bg-[#fafbfd]" style={{ gridTemplateColumns: cols }}>
        <div className="sticky left-0 z-10 flex items-center bg-[#fafbfd] pl-6 text-[13px] font-semibold text-[#475569]">근무 · 휴가 인원</div>
        {infos.map((x, i) => (
          <div key={x.key} className={`pb-2.5 pt-[9px] text-center text-[12.5px] leading-snug text-[#596578] ${x.weekStart ? "border-l border-[#e2e8f0]" : ""}`}>
            <b className="block text-[14px] tabular-nums text-[#0f172a]">{workCnt[i] || "–"}</b>
            {leaveCnt[i] ? <span className="text-[#1e40af]">휴가 {leaveCnt[i]}</span> : <span>&nbsp;</span>}
          </div>
        ))}
        {hoursOk && <div />}
      </div>
    </div>
  );
}

/** 띠 하나 — 글자는 가운데 한 번, 누르는 자리는 날짜마다 */
function Band({ band, emp, onSchedule, onEmptyCell, style }: { band: DayCell[]; emp: BoardEmployee; onSchedule?: BoardProps["onSchedule"]; onEmptyCell?: BoardProps["onEmptyCell"]; style: React.CSSProperties }) {
  const c = band[0];
  const text = bandText(band);
  return (
    <div className={`relative z-[1] mx-[3px] h-[34px] self-center overflow-hidden rounded-lg text-[13px] tabular-nums ${KIND_CLS[c.kind]}`} style={style} title={band.length > 1 ? text : c.title}>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-1.5"><span className="truncate whitespace-nowrap">{text}</span></span>
      <div className="relative flex h-full">
        {band.map((cell) => {
          const s = cell.s;
          if (s && onSchedule) return (
            <button key={cell.date} type="button" aria-label={`${emp.name} ${cell.date} ${cell.title}`} title={cell.title}
              className="h-full flex-1 hover:bg-[#0f172a]/[.04] focus-visible:outline-2 focus-visible:outline-[#4f46e5]"
              onClick={() => onSchedule(s, emp)} />
          );
          // 휴가(반차 · 하루 · 결재 대기)만 있고 일정이 없는 날 — 근무를 넣을 수 있다(#71 반차 뒤 근무)
          if (!s && onEmptyCell) return (
            <button key={cell.date} type="button" aria-label={`${emp.name} ${cell.date} ${cell.title} · 일정 추가`} title={`${cell.title} · 눌러서 일정 추가`}
              className="group/add relative h-full flex-1 focus-visible:outline-2 focus-visible:outline-[#4f46e5]"
              onClick={() => onEmptyCell(emp.id, cell.date)}>
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-[1.5px] border-dashed border-[#a5b4fc] bg-white text-[13px] font-semibold text-[#4f46e5] opacity-0 transition-opacity group-hover/add:opacity-100 group-focus-visible/add:opacity-100">+ 추가</span>
              <span className="pointer-events-none absolute right-1 top-0 hidden text-[13px] font-bold text-[#4f46e5] [@media(hover:none)]:block" aria-hidden>+</span>
            </button>
          );
          return <span key={cell.date} className="flex-1" title={cell.title} />;
        })}
      </div>
    </div>
  );
}

// ── 한 달 보기 — 날짜 칸이 좁아 시간은 「10–19」처럼, 합계는 화면에서 센 일정 근로시간(휴게 제외) ──
/** 사람별 일정 근로시간 합(분, 휴게 제외) — 화면에 보이는 일정 기준 */
function useScheduledTotals(schedules: BoardSchedule[]) {
  return useMemo(() => {
    const t = new Map<string, number>();
    for (const s of schedules) if (s.type === "work") t.set(s.userId, (t.get(s.userId) ?? 0) + netMinutes(s.startTime, s.endTime));
    return t;
  }, [schedules]);
}

function MonthView({ view, employees, schedules, holidayMap, leaves, hoursHidden, onEmptyCell, onSchedule }: BoardProps) {
  const infos = dayInfos(daysOf(view.range), holidayMap);
  const by = useByUserDate(schedules);
  const baseTimes = useBaseTimes(schedules, holidayMap);
  const show = view.show;
  const totals = useScheduledTotals(schedules);
  const showTotal = show.total && !hoursHidden;
  const cols = `160px repeat(${infos.length}, minmax(46px, 1fr))${showTotal ? " 72px" : ""}`;
  if (employees.length === 0) return <NoEmployees />;
  return (
    <div className="w-max min-w-full text-[12px]">
      <div className="sticky top-0 z-20 grid border-b border-[#eef1f5] bg-[#fafbfd]" style={{ gridTemplateColumns: cols }}>
        <div className="sticky left-0 z-10 flex items-center bg-[#fafbfd] pl-6 text-[13px] font-semibold text-[#596578]">직원</div>
        {infos.map((x) => (
          <div key={x.key} title={x.holidayName} className={`py-1.5 text-center leading-tight ${x.weekStart ? "border-l border-[#e2e8f0]" : ""} ${x.off ? "bg-[#fafbfc]" : ""}`}>
            <b className={`mx-auto block h-6 w-6 rounded-full text-[13px] font-bold leading-6 tabular-nums ${x.today ? "bg-[#4f46e5] text-white" : x.off ? "text-[#64748b]" : "text-[#0f172a]"}`}>{x.day.getDate()}</b>
            <span className="text-[11px] text-[#596578]">{format(x.day, "EEEEE", { locale: ko })}</span>
          </div>
        ))}
        {showTotal && <div className="flex items-center justify-center text-[12.5px] font-semibold text-[#596578]" title="이 달 근무일정 근로시간(휴게 제외) — 화면에 보이는 일정 기준">월 합계</div>}
      </div>
      {employees.map((emp) => (
        <div key={emp.id} className="grid border-b border-[#f1f5f9]" style={{ gridTemplateColumns: cols }}>
          <WhoCell emp={emp} show={show} className="min-h-[48px]" />
          {infos.map((x) => {
            const c = buildCell(emp.id, x, by.get(emp.id)?.get(x.key) ?? [], leaves, baseTimes.get(emp.id), show);
            const s = c.s;
            // 일정 없이 휴가만 있는 칸 — 누르면 일정 추가(#71)
            const addHere = !s && onEmptyCell ? () => onEmptyCell(emp.id, x.key) : undefined;
            const act = s && onSchedule ? () => onSchedule(s, emp) : addHere;
            const label = c.kind === "vac" ? (c.leaveLabel ?? "").slice(0, 2) : c.kind === "vacp" && c.merge.startsWith("vacp|") ? (c.leaveLabel ?? "").slice(0, 2)
              : c.kind === "half" || (c.kind === "vacp" && c.merge.startsWith("half|")) ? c.text.split(" ")[0] : c.text;
            return (
              <div key={x.key} className={`group relative flex min-h-[48px] items-center px-0.5 ${x.weekStart ? "border-l border-[#e2e8f0]" : ""} ${x.today ? "bg-[#f7f8ff]" : x.off ? "bg-[#fafbfc]" : ""}`}>
                {c.kind === "empty" ? (
                  onEmptyCell ? <button type="button" aria-label={`${emp.name} ${x.key} 일정 추가`} onClick={() => onEmptyCell(emp.id, x.key)}
                    className="h-[30px] w-full rounded-md text-[14px] font-semibold text-[#4f46e5] opacity-0 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-40">+</button> : null
                ) : (
                  <div title={addHere ? `${c.title} · 눌러서 일정 추가` : c.title}
                    aria-label={addHere ? `${emp.name} ${x.key} ${c.title} · 일정 추가` : undefined}
                    className={`relative flex h-[30px] w-full items-center justify-center overflow-hidden whitespace-nowrap rounded-md px-0.5 text-[11px] leading-4 ${KIND_CLS[c.kind]} ${act ? "cursor-pointer hover:ring-2 hover:ring-[#c7d2fe]" : ""}`}
                    role={act ? "button" : undefined} tabIndex={act ? 0 : undefined}
                    onKeyDown={act ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } } : undefined}
                    onClick={act}>
                    {label}
                    {addHere && <span className="pointer-events-none absolute right-0.5 top-0 text-[11px] font-bold leading-3 text-[#4f46e5] opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100" aria-hidden>+</span>}
                  </div>
                )}
              </div>
            );
          })}
          {showTotal && <div className="flex items-center justify-center bg-[#fafbfd] text-[12.5px] font-semibold text-[#475569]">{fmtHours(totals.get(emp.id) ?? 0)}</div>}
        </div>
      ))}
    </div>
  );
}

// ── 하루 보기 — 시간축 위에 근무 띠. 누가 언제 있는지 한눈에 ──
function DayView({ view, employees, schedules, holidayMap, leaves, onEmptyCell, onSchedule }: BoardProps) {
  const key = ymd(view.range.start);
  const by = useByUserDate(schedules);
  const baseTimes = useBaseTimes(schedules, holidayMap);
  const todays = useMemo(() => schedules.filter((s) => s.date === key && s.type === "work"), [schedules, key]);
  const { fromH, toH } = timeAxis(todays);
  const hours = Array.from({ length: toH - fromH }, (_, i) => fromH + i);
  const span = (toH - fromH) * 60;
  const pct = (min: number) => `${Math.min(100, Math.max(0, ((min - fromH * 60) / span) * 100))}%`;
  const info = dayInfos([view.range.start], holidayMap)[0];
  const show = view.show;
  if (employees.length === 0) return <NoEmployees />;
  return (
    <div className="w-max min-w-full">
      <div className="sticky top-0 z-20 flex border-b border-[#eef1f5] bg-[#fafbfd]">
        <div className="sticky left-0 z-10 flex w-48 flex-shrink-0 items-center bg-[#fafbfd] pl-6 text-[13px] font-semibold text-[#596578]">직원</div>
        <div className={`relative min-w-[600px] flex-1 ${info.off ? "bg-[#fafbfc]" : ""}`}>
          <div className="flex h-full">
            {hours.map((hh) => (
              <div key={hh} className="flex-1 border-r border-[#f1f5f9] py-3 text-center text-[12px] text-[#596578]">{hh}시</div>
            ))}
          </div>
          {info.holidayName && <div className="absolute right-2 top-1 text-[11px] text-[#64748b]">{info.holidayName}</div>}
        </div>
      </div>
      {employees.map((emp) => {
        const list = by.get(emp.id)?.get(key) ?? [];
        const c = buildCell(emp.id, info, list, leaves, baseTimes.get(emp.id), show);
        const fullLeave = c.kind === "vac";   // 하루 휴가인 날은 근무 띠를 그리지 않는다(■0-5)
        const works = fullLeave ? [] : list.filter((s) => s.type === "work" && timeToMin(s.startTime) != null && timeToMin(s.endTime) != null);
        const others = list.filter((s) => s.type !== "work");
        const chips: { text: string; cls: string }[] = [];
        if (c.kind === "vac" || c.kind === "vacp" || c.kind === "half") chips.push({ text: c.kind === "half" ? (c.text.split(" ")[0]) : c.text, cls: KIND_CLS[c.kind] });
        if (c.kind === "chgp" || c.kind === "wkp") chips.push({ text: `${c.text} · 결재 대기`, cls: KIND_CLS[c.kind] });
        const workKind: Kind = c.kind === "chg" || c.kind === "wk" || c.kind === "base" ? c.kind : "base";
        return (
          <div key={emp.id} className="flex border-b border-[#f1f5f9]">
            <WhoCell emp={emp} show={show} className="w-48 flex-shrink-0" />
            <div className="group relative min-h-[64px] min-w-[600px] flex-1">
              <div className="absolute inset-0 flex">
                {hours.map((hh) => <div key={hh} className="flex-1 border-r border-[#f8fafc]" />)}
              </div>
              {/* 일정이 없으면 추가 — 휴가가 있는 날도 넣을 수 있다(반차 뒤 근무 등, #71 검증 3). 휴가 칩은 그 위에 */}
              {list.length === 0 && onEmptyCell && !fullLeave && (
                <button type="button" onClick={() => onEmptyCell(emp.id, key)}
                  className={`absolute inset-x-1 bottom-1 rounded-lg border-[1.5px] border-dashed border-[#a5b4fc] bg-white text-[13px] font-semibold text-[#4f46e5] opacity-0 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${chips.length ? "top-8" : "top-1"}`}>+ 추가</button>
              )}
              <div className="absolute left-2 top-2 z-10 flex gap-1">
                {chips.map((ch, i) => <span key={i} className={`rounded-md px-2 py-0.5 text-[12px] ${ch.cls}`}>{ch.text}</span>)}
                {others.map((s) => (
                  <span key={s.id} className={`rounded-md px-2 py-0.5 text-[12px] ${KIND_CLS.off} ${onSchedule ? "cursor-pointer hover:ring-2 hover:ring-[#c7d2fe]" : ""}`}
                    role={onSchedule ? "button" : undefined} tabIndex={onSchedule ? 0 : undefined}
                    onKeyDown={onSchedule ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSchedule(s, emp); } } : undefined}
                    onClick={onSchedule ? () => onSchedule(s, emp) : undefined}>{typeLabel(s.type)}</span>
                ))}
                {fullLeave && list[0] && onSchedule && (
                  <button type="button" className="rounded-md px-2 py-0.5 text-[12px] text-[#4f46e5] hover:underline" onClick={() => onSchedule(list[0], emp)}>일정 보기</button>
                )}
              </div>
              {works.map((s) => {
                const sm = timeToMin(s.startTime)!, em = timeToMin(s.endTime)!;
                const clickable = !!onSchedule;
                const note = cleanNote(s.note);
                return (
                  <div key={s.id} title={`${dash(s.startTime, s.endTime)}${note ? ` · ${note}` : ""}`}
                    className={`absolute top-7 flex h-8 items-center overflow-hidden whitespace-nowrap rounded-lg px-2 text-[12.5px] tabular-nums ${KIND_CLS[workKind]} ${clickable ? "cursor-pointer hover:ring-2 hover:ring-[#c7d2fe]" : ""}`}
                    style={{ left: pct(sm), width: `calc(${pct(Math.max(em, sm + 30))} - ${pct(sm)})` }}
                    role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSchedule!(s, emp); } } : undefined}
                    onClick={clickable ? () => onSchedule!(s, emp) : undefined}>
                    {show.time ? dash(s.startTime, s.endTime) : "근무"}{show.note && note ? ` · ${note}` : ""}
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

// ── 목록형 — 날짜순, 같은 날은 직원 순서대로. 일정 · 휴가 · 결재 대기가 있는 날만 ──
function ListView({ view, employees, schedules, holidayMap, leaves, onSchedule }: BoardProps) {
  const infos = useMemo(() => dayInfos(daysOf(view.range), holidayMap), [view.range, holidayMap]);
  const by = useByUserDate(schedules);
  const show = view.show;
  const rows = useMemo(() => {
    const out: { info: DayInfo; emp: BoardEmployee; s: BoardSchedule | null; leave: string[]; fullLeave: boolean; pending: string | null }[] = [];
    for (const info of infos) {
      for (const emp of employees) {
        const list = by.get(emp.id)?.get(info.key) ?? [];
        const appr = leaves?.leaves[emp.id]?.[info.key] ?? [];
        const pend = leaves?.pendingLeaves?.[emp.id]?.[info.key] ?? [];
        const ps = leaves?.pendingSchedules?.[emp.id]?.[info.key];
        const leave = appr.map((l) => l.label);
        const fullLeave = appr.some(isFull);
        const pending = [
          ...pend.map((l) => l.label),
          ...(ps ? [ps.kind === "DELETE" ? "일정 삭제" : `근무 변경 ${dash(ps.startTime ?? "", ps.endTime ?? "")}`] : []),
        ].join(", ") || null;
        if (list.length === 0 && leave.length === 0 && !pending) continue;
        if (list.length === 0) out.push({ info, emp, s: null, leave, fullLeave, pending });
        for (const s of list) out.push({ info, emp, s, leave, fullLeave, pending });
      }
    }
    return out;
  }, [infos, employees, by, leaves]);
  const schedCount = rows.filter((r) => r.s && !r.fullLeave).length, leaveCount = rows.filter((r) => r.leave.length).length, pendCount = rows.filter((r) => r.pending).length;
  if (employees.length === 0) return <NoEmployees />;
  return (
    <div>
      <div className="border-b border-[#eef1f5] bg-[#fafbfd] px-6 py-2 text-[13px] text-[#596578]">
        {viewTitle(view.range, view.unit)} · 일정 {schedCount}건{leaves ? ` · 휴가 ${leaveCount}건` : ""}{pendCount ? ` · 결재 대기 ${pendCount}건` : ""} · 직원 {employees.length}명
      </div>
      {rows.length === 0 ? <div className="p-8 text-center text-[14px] text-[#596578]">이 기간에 일정이 없습니다.</div> : (
        <table className="w-full text-[14px]">
          <thead className="sticky top-0 z-10 border-b border-[#eef1f5] bg-white">
            <tr className="text-left text-[13px] text-[#596578]">
              <th className="w-36 px-6 py-2.5 font-semibold">날짜</th>
              <th className="w-40 px-3 py-2.5 font-semibold">직원</th>
              {show.subline && <th className="w-28 px-3 py-2.5 font-semibold">지점</th>}
              {show.subline && <th className="w-24 px-3 py-2.5 font-semibold">직무</th>}
              {show.time && <th className="w-32 px-3 py-2.5 font-semibold">근무 시간</th>}
              {show.typeBadge && <th className="w-24 px-3 py-2.5 font-semibold">유형</th>}
              <th className="w-40 px-3 py-2.5 font-semibold">휴가</th>
              {show.note && <th className="px-3 py-2.5 font-semibold">메모</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const clickable = !!(onSchedule && r.s);
              const note = cleanNote(r.s?.note);
              return (
                <tr key={`${r.info.key}-${r.emp.id}-${r.s?.id ?? "x"}`}
                  className={`border-b border-[#f1f5f9] last:border-0 ${clickable ? "cursor-pointer outline-none hover:bg-[#f8faff] focus:bg-[#f8faff]" : ""}`}
                  role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSchedule!(r.s!, r.emp); } } : undefined}
                  onClick={clickable ? () => onSchedule!(r.s!, r.emp) : undefined}>
                  <td className={`whitespace-nowrap px-6 py-2 ${r.info.off ? "text-[#64748b]" : "text-[#0f172a]"}`}>
                    {format(r.info.day, "M월 d일 (EEE)", { locale: ko })}
                    {r.info.holidayName && <span className="ml-1 text-[11px] text-[#64748b]">{r.info.holidayName}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-[#0f172a]">{r.emp.name}</span>
                    {show.empNo && r.emp.empNo != null && <span className="ml-1.5 text-[12px] text-[#94a3b8]">{empNoText(r.emp.empNo)}</span>}
                  </td>
                  {show.subline && <td className="px-3 py-2 text-[13px] text-[#475569]">{r.emp.branch ?? "-"}</td>}
                  {show.subline && <td className="px-3 py-2 text-[13px] text-[#475569]">{jobOf(r.emp) || "-"}</td>}
                  {show.time && <td className="px-3 py-2 text-[13px] tabular-nums text-[#0f172a]">{r.s && r.s.type === "work" && !r.fullLeave ? dash(r.s.startTime, r.s.endTime) : "-"}</td>}
                  {show.typeBadge && <td className="px-3 py-2 text-[13px] text-[#475569]">{r.fullLeave ? "휴가" : r.s ? typeLabel(r.s.type) : "-"}</td>}
                  <td className="px-3 py-2 text-[13px]">
                    {r.leave.length > 0 && <span className="text-[#1d4ed8]">{r.leave.join(", ")}</span>}
                    {r.pending && <span className={r.leave.length ? "ml-1.5" : ""}><StatusPill tone="wait">승인 대기</StatusPill> <span className="text-[#596578]">{r.pending}</span></span>}
                    {!r.leave.length && !r.pending && <span className="text-[#cbd5e1]">-</span>}
                  </td>
                  {show.note && <td className="max-w-[240px] truncate px-3 py-2 text-[13px] text-[#596578]" title={note || undefined}>{note}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
