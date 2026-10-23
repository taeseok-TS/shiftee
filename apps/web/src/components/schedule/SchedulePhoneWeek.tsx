"use client";

import { useMemo, useSyncExternalStore } from "react";
import { CalendarDays, Clock } from "lucide-react";
import { Box, Btn, StatusPill } from "@/components/kit";
import type { BoardEmployee, BoardSchedule } from "@/components/schedule/ScheduleBoard";
import type { DayLeave, RangeLeaves } from "@/components/schedule/WeekExtras";
import { compactTime } from "@/lib/schedule-view";
import { fmtDayKo, fmtDayShort } from "@/lib/leave-period";

/**
 * 원장 「지점 근무일정」 폰 첫 화면(2026-10-23 본부 요청 ■2 · ■4 「폰에서 표는 카드로」) — 띠 표 대신 **오늘 · 이번 주** 목록.
 *  · 오늘: 지점 직원별 한 줄 「이름 · 13:00–22:00」. 휴가면 「연차」, 반차는 「반차 18–22」, 일정 없으면 「쉼」
 *  · 이번 주(월~일): 날짜별 묶음(「10월 27일 (화)」, 토 · 일 · 공휴일 회색, 오늘 인디고) 안에 같은 한 줄씩
 *  · 색은 띠 표(ScheduleBoard, 시안 R18)와 같게 — 기본 근무 연회색 · 시간 변경 인디고 테두리 · 휴가 연파랑 · 주말 근무 연보라,
 *    결재 대기(휴가 · 근무 변경)는 같은 색 점선 + 주황 「승인 대기」 알약
 *  · 줄을 누르면 띠 표에서 칸을 눌렀을 때와 같은 창 — 일정이 있으면 고치기(onSchedule), 없으면 추가(onEmptyCell)
 *  · 데이터는 부르는 쪽(page.tsx)이 이미 받은 것을 그대로 — 여기서는 API 를 부르지 않는다
 *  · 「기본 근무」는 띠 표와 같이 **그 사람이 받은 기간 평일에 가장 많이 한 시간**
 */

const PHONE_MQ = "(max-width: 47.9375rem)";   // Tailwind 4 md(48rem) 미만 — rem 으로 재야 글꼴 크기를 키운 브라우저에서도 CSS(md:hidden)와 같은 판정(10/24 검증 P1)
const subscribePhone = (cb: () => void) => {
  const mq = window.matchMedia(PHONE_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
/** 폰 폭(md 미만)인지 — 서버 렌더에서는 false */
export function useIsPhone() {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_MQ).matches, () => false);
}

/** yyyy-MM-dd 에 n 일 더하기(달력 날짜만 — UTC 로 계산) */
export const plusDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dowOf = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
/** 그 날이 든 주의 월요일 */
export const mondayOf = (ymd: string) => plusDays(ymd, -((dowOf(ymd) + 6) % 7));

type Kind = "base" | "chg" | "wk" | "vac" | "half" | "vacp" | "chgp" | "wkp" | "off" | "empty";
// 띠 표(ScheduleBoard KIND_CLS)와 같은 색 — 폰 줄 안의 작은 칩
const CHIP: Record<Kind, string> = {
  base: "bg-[#eef1f6] text-[#334155] font-semibold",
  chg: "bg-white border-[1.5px] border-[#818cf8] text-[#3730a3] font-bold",
  wk: "bg-[#ede9fe] text-[#5b21b6] font-bold",
  vac: "bg-[#dbeafe] text-[#1e40af] font-bold",
  half: "bg-[#dbeafe] text-[#1e40af] font-bold",
  vacp: "bg-[#f8fbff] border-[1.5px] border-dashed border-[#60a5fa] text-[#1e40af] font-bold",
  chgp: "bg-white border-[1.5px] border-dashed border-[#818cf8] text-[#3730a3] font-bold",
  wkp: "bg-[#fbfaff] border-[1.5px] border-dashed border-[#a78bfa] text-[#5b21b6] font-bold",
  off: "bg-[#f8fafc] border border-[#e2e8f0] text-[#64748b] font-medium",
  empty: "",
};
const TYPE_LABEL: Record<string, string> = { work: "근무", off: "휴무", holiday: "공휴일" };
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;
const isFull = (l: DayLeave) => !l.unit || l.unit === "FULL";
const shortLeave = (l: DayLeave) => (l.unit === "HALF" ? "반차" : l.unit === "QUARTER" ? "반반차" : l.label);
const dash = (a: string, b: string) => `${a}–${b}`;
const shortTime = (st: string, et: string) => dash(compactTime(st), compactTime(et));

type Cell = { kind: Kind; text: string; title: string; s: BoardSchedule | null; pending: boolean; work: boolean; leave: boolean };

/** 한 사람 · 하루의 모양 — 띠 표 buildCell 과 같은 순서(하루 휴가 → 휴가 결재 대기 → 근무 변경 결재 대기 → 반차 → 일정 → 없음) */
function cellOf(empId: string, date: string, off: boolean, list: BoardSchedule[], leaves: RangeLeaves | null, baseKey: string | undefined): Cell {
  const s = list[0] ?? null;
  const appr = leaves?.leaves[empId]?.[date] ?? [];
  const pend = leaves?.pendingLeaves?.[empId]?.[date] ?? [];
  const ps = leaves?.pendingSchedules?.[empId]?.[date];
  const work = !!s && s.type === "work";
  const sText = s ? (s.type === "work" ? dash(s.startTime, s.endTime) : typeLabel(s.type)) : "";
  const full = appr.filter(isFull);
  if (full.length) {
    const label = full.map((l) => l.label).join("·");
    return { kind: "vac", text: label, title: `${label}${s ? ` (일정 ${sText})` : ""}`, s, pending: false, work: false, leave: true };
  }
  const pFull = pend.find(isFull);
  if (pFull) return { kind: "vacp", text: pFull.label, title: `${pFull.label} 결재 대기`, s, pending: true, work, leave: false };
  if (ps) {
    if (ps.kind === "DELETE") return { kind: "chgp", text: "삭제 요청", title: `일정 삭제 요청 · 결재 대기${s ? ` (지금 ${sText})` : ""}`, s, pending: true, work, leave: false };
    const st = ps.startTime ?? s?.startTime ?? "", et = ps.endTime ?? s?.endTime ?? "";
    return { kind: off ? "wkp" : "chgp", text: dash(st, et), title: `근무 변경 ${dash(st, et)} · 결재 대기${s ? ` (지금 ${sText})` : ""}`, s, pending: true, work, leave: false };
  }
  const half = appr[0] ?? pend[0];
  if (half) {
    const pending = !appr.length;
    const t = work ? ` ${shortTime(s!.startTime, s!.endTime)}` : "";
    return { kind: pending ? "vacp" : "half", text: `${shortLeave(half)}${t}`, title: `${half.label}${pending ? " 결재 대기" : ""}${s ? ` · 일정 ${sText}` : ""}`, s, pending, work, leave: false };
  }
  if (s) {
    if (s.type !== "work") return { kind: "off", text: typeLabel(s.type), title: sText, s, pending: false, work: false, leave: false };
    const k = `${s.startTime}-${s.endTime}`;
    const kind: Kind = off ? "wk" : baseKey && k !== baseKey ? "chg" : "base";
    return { kind, text: dash(s.startTime, s.endTime), title: sText, s, pending: false, work: true, leave: false };
  }
  return { kind: "empty", text: "쉼", title: "일정 없음", s: null, pending: false, work: false, leave: false };
}

type Props = {
  today: string;                 // KST 오늘(yyyy-MM-dd)
  days: string[];                // 이번 주 월~일
  employees: BoardEmployee[];
  schedules: BoardSchedule[];    // 이번 주를 덮는 일정(보기 기간 것 또는 따로 받은 것)
  leaves: RangeLeaves | null;
  holidayMap: Map<string, string>;
  loading: boolean;
  tableOpen: boolean;
  onToggleTable: () => void;
  onEmptyCell?: (userId: string, date: string) => void;
  onSchedule?: (s: BoardSchedule, emp: BoardEmployee) => void;
};

export default function SchedulePhoneWeek({ today, days, employees, schedules, leaves, holidayMap, loading, tableOpen, onToggleTable, onEmptyCell, onSchedule }: Props) {
  // userId → date → 일정, 사람별 기본 근무(평일 · 공휴일 빼고 가장 많이 한 시간)
  const { by, baseTimes } = useMemo(() => {
    const by = new Map<string, Map<string, BoardSchedule[]>>();
    const cnt = new Map<string, Map<string, number>>();
    for (const s of schedules) {
      let u = by.get(s.userId); if (!u) { u = new Map(); by.set(s.userId, u); }
      const l = u.get(s.date); if (l) l.push(s); else u.set(s.date, [s]);
      if (s.type !== "work") continue;
      const dow = dowOf(s.date);
      if (dow === 0 || dow === 6 || holidayMap.has(s.date)) continue;
      let c = cnt.get(s.userId); if (!c) { c = new Map(); cnt.set(s.userId, c); }
      const k = `${s.startTime}-${s.endTime}`;
      c.set(k, (c.get(k) ?? 0) + 1);
    }
    const baseTimes = new Map<string, string>();
    for (const [uid, m] of cnt) { let best = "", n = 0; for (const [k, c] of m) if (c > n) { best = k; n = c; } baseTimes.set(uid, best); }
    return { by, baseTimes };
  }, [schedules, holidayMap]);

  const isOff = (d: string) => { const w = dowOf(d); return w === 0 || w === 6 || holidayMap.has(d); };
  const rowsOf = (d: string) => employees.map((emp) => ({ emp, cell: cellOf(emp.id, d, isOff(d), by.get(emp.id)?.get(d) ?? [], leaves, baseTimes.get(emp.id)) }));
  const pressOf = (emp: BoardEmployee, d: string, cell: Cell) =>
    cell.s && onSchedule ? () => onSchedule(cell.s!, emp) : !cell.s && onEmptyCell ? () => onEmptyCell(emp.id, d) : undefined;

  const todayRows = rowsOf(today);
  const workN = todayRows.filter((r) => r.cell.work).length, leaveN = todayRows.filter((r) => r.cell.leave).length;
  const countText = (rows: { cell: Cell }[]) => {
    const w = rows.filter((r) => r.cell.work).length, l = rows.filter((r) => r.cell.leave).length;
    return `근무 ${w}명${l ? ` · 휴가 ${l}명` : ""}`;
  };
  const empty = <p className="px-6 py-5 text-[14px] text-[#596578]">표시할 직원이 없습니다.</p>;
  const busy = <p className="px-6 py-5 text-[14px] text-[#596578]">근무일정을 불러오는 중…</p>;

  return (
    <div className="md:hidden">
      <Box icon={<Clock />} title="오늘" sub={`${fmtDayKo(today)}${holidayMap.has(today) ? ` · ${holidayMap.get(today)}` : ""}${!loading && employees.length ? ` · 근무 ${workN}명${leaveN ? ` · 휴가 ${leaveN}명` : ""}` : ""}`}>
        {loading ? busy : employees.length === 0 ? empty : (
          <ul className="px-4 py-1">
            {todayRows.map(({ emp, cell }) => <Row key={emp.id} emp={emp} cell={cell} onPress={pressOf(emp, today, cell)} />)}
          </ul>
        )}
      </Box>

      <Box icon={<CalendarDays />} tone="sl" title="이번 주" sub={`${fmtDayShort(days[0])} ~ ${fmtDayShort(days[days.length - 1])}`}>
        {loading ? busy : employees.length === 0 ? empty : days.map((d) => {
          const rows = rowsOf(d);
          const isToday = d === today, off = isOff(d), holi = holidayMap.get(d);
          return (
            <section key={d} aria-label={fmtDayKo(d)}>
              <div className={`flex items-center gap-2 border-y border-[#eef1f5] bg-[#fafbfd] px-4 py-2 text-[13.5px] font-bold ${isToday ? "text-[#4f46e5]" : off ? "text-[#64748b]" : "text-[#0f172a]"}`}>
                <span>{fmtDayKo(d)}</span>
                {holi && <span className="text-[12px] font-medium text-[#64748b]">{holi}</span>}
                {isToday && <StatusPill tone="ind">오늘</StatusPill>}
                <span className="ml-auto text-[12.5px] font-medium text-[#596578]">{countText(rows)}</span>
              </div>
              <ul className={`px-4 py-1 ${isToday ? "bg-[#f7f8ff]" : ""}`}>
                {rows.map(({ emp, cell }) => <Row key={emp.id} emp={emp} cell={cell} onPress={pressOf(emp, d, cell)} />)}
              </ul>
            </section>
          );
        })}
        {/* 띠 표는 눌렀을 때만 — 한 달 · 1주 띠 표는 PC 에서 보기 좋다 */}
        <div className="border-t border-[#eef1f5] px-4 py-3">
          <Btn className="min-h-[44px] w-full text-[14px]" aria-expanded={tableOpen} onClick={onToggleTable}>{tableOpen ? "표 닫기" : "표 보기"}</Btn>
        </div>
      </Box>
    </div>
  );
}

/** 한 줄 — 이름 · 시간(또는 휴가 · 쉼) · 결재 대기면 주황 알약. 누를 수 있으면 버튼(44px 이상) */
function Row({ emp, cell, onPress }: { emp: BoardEmployee; cell: Cell; onPress?: () => void }) {
  const inner = (
    <>
      <b className="w-[112px] shrink-0 truncate text-[15px] font-bold text-[#0f172a]">{emp.name}</b>
      <span className="min-w-0 flex-1">
        {cell.kind === "empty"
          ? <span className="text-[14px] text-[#94a3b8]">쉼</span>
          : <span className={`inline-block max-w-full truncate rounded-md px-2 py-0.5 text-[13px] tabular-nums ${CHIP[cell.kind]}`} title={cell.title}>{cell.text}</span>}
      </span>
      {cell.pending && <StatusPill tone="wait">승인 대기</StatusPill>}
    </>
  );
  const cls = "flex min-h-[48px] w-full items-center gap-3 py-2 text-left";
  return (
    <li className="border-t border-[#f1f5f9] first:border-t-0">
      {onPress
        ? <button type="button" className={`${cls} hover:bg-[#f8faff] focus-visible:outline-2 focus-visible:outline-[#4f46e5]`} aria-label={`${emp.name} ${cell.title}${cell.s ? "" : " · 일정 추가"}`} onClick={onPress}>{inner}</button>
        : <div className={cls}>{inner}</div>}
    </li>
  );
}
