"use client";

import { LEAVE_LABELS } from "@/lib/leave-catalog";
import { useLeaveCatalog } from "@/components/leave/useLeaveCatalog";
import { useUserPrefs } from "@/components/prefs/useUserPrefs";
import { type ViewUnit, UNIT_LABEL, VIEW_UNITS, daysOf, isViewUnit, rangeOf, rangeTitle, shiftAnchor, yearsOf, ymd } from "@/lib/schedule-view";
import { TemplatePicker } from "@/components/schedule/TemplatePicker";
import { showWeekWarnings } from "@/components/schedule/WeekHours";
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
  id: string; name: string; department: string; position: string; branch: string | null;
  scheduleType: string | null; startTime: string | null; endTime: string | null;
  clockIn: string | null; clockOut: string | null;
  // 찍었는지 — 시각은 본부만이라(■0-11) 직원 · 원장 응답은 clockIn · clockOut 이 null 이고 이 값으로 상태를 그린다
  clockedIn?: boolean; clockedOut?: boolean; hasClockIn?: boolean; hasClockOut?: boolean;
  leaveType: string | null; status: string; scheduleId: string | null;
};
type DaySummary = {
  total: number; checkedIn: number; late: number; earlyLeave: number;
  absent: number; leave: number; notYet: number; off: number;
};
type Employee = { id: string; name: string; department: string | null; branch?: string | null };

/* ── 상태 설정 ── */
// 색(■1 · ■4 — 보드 board-state 와 같게): 출근 연인디고 · 문제(지각 · 결근)만 분홍 · 휴가 파랑 · 그 밖 회색. 초록 · 토일 빨강 없음
const STATUS_CFG: Record<string, { label: string; badge: string; dot: string }> = {
  NORMAL:      { label: "출근",    badge: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-500" },
  LATE:        { label: "지각",    badge: "bg-rose-50 text-rose-700 border-rose-200",       dot: "bg-rose-500" },
  EARLY_LEAVE: { label: "조퇴",    badge: "bg-gray-100 text-gray-600 border-gray-200",      dot: "bg-gray-500" },
  ABSENT:      { label: "결근",    badge: "bg-rose-50 text-rose-700 border-rose-200",       dot: "bg-rose-500" },
  LEAVE:       { label: "휴가",    badge: "bg-blue-100 text-blue-700 border-blue-200",      dot: "bg-blue-500" },
  OFF:         { label: "휴무",    badge: "bg-gray-100 text-gray-500 border-gray-200",      dot: "bg-gray-400" },
  HOLIDAY:     { label: "공휴일",  badge: "bg-gray-100 text-gray-500 border-gray-200",      dot: "bg-gray-400" },
  NOT_YET:     { label: "미등록",  badge: "bg-slate-100 text-slate-500 border-slate-200",   dot: "bg-slate-400" },
  NO_SCHEDULE: { label: "일정없음", badge: "bg-gray-50 text-gray-400 border-gray-100",      dot: "bg-gray-300" },
  // 출퇴근 열람이 꺼진 직원의 근무일 — 출근 여부를 말하지 않는다(#219-14)
  WORK:        { label: "근무",    badge: "bg-sky-50 text-sky-700 border-sky-200",          dot: "bg-sky-400" },
};

const LEAVE_LABEL: Record<string, string> = LEAVE_LABELS;   // 공용 객체 — useLeaveCatalog 가 본부 유형 이름을 채운다(#216-1)

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
// 달력 머리 — 한 주는 월요일 ~ 일요일(■4). 값은 getDay 번호(일 = 0)
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

const TYPE_CFG: Record<string, string> = {
  WORK: "근무", OFF: "휴무", HOLIDAY: "공휴일",
};

/** 출근 · 퇴근 칸 — 시각을 받으면 시각, 시각이 빠진 응답(■0-11)이면 「출근 · 지각 · 퇴근 · 퇴근 누락」 상태 글자 */
// 오늘 = 한국 날짜(브라우저 시간대가 달라도 「퇴근 누락」을 하루 일찍 · 늦게 붙이지 않게)
const kstTodayYmd = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
/** 시간 「13:00–22:00」 */
const timeRange = (a: string | null, b: string | null) => `${a ?? ""}–${b ?? ""}`;
function ClockCell({ r, which, date }: { r: EmpRow | null | undefined; which: "in" | "out"; date: string }) {
  const dash = <span className="text-gray-300">-</span>;
  if (!r) return dash;
  const time = which === "in" ? r.clockIn : r.clockOut;
  if (time) return <>{time}</>;
  const inn = r.clockedIn ?? r.hasClockIn ?? false;
  const out = r.clockedOut ?? r.hasClockOut ?? false;
  if (which === "in") return inn ? <span className="font-sans">{r.status === "LATE" ? "지각" : "출근"}</span> : dash;
  if (out) return <span className="font-sans">퇴근</span>;
  // 출근만 있고 그날이 지났으면 퇴근 누락(빨강 = 문제)
  if (inn && date && date < kstTodayYmd()) return <span className="font-sans text-red-600">퇴근 누락</span>;
  return dash;
}

const defaultForm = { userId: "", date: "", startTime: "09:00", endTime: "18:00", type: "WORK", note: "" };

// 직원 달력 보기 단위(2026-10-12 QA #81) — 월(종전 달력) · 주 · 일. 선택은 사람마다 저장(/api/me/prefs 키 myCalendar)
type MyCalPrefs = { unit: ViewUnit };
const MYCAL_DEFAULT: MyCalPrefs = { unit: "month" };
const cleanMyCal = (raw: unknown): MyCalPrefs => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { unit: isViewUnit(r.unit) ? r.unit : "month" };
};
const defaultBulk = { userIds: [] as string[], startDate: "", endDate: "", weekdays: [1,2,3,4,5] as number[], startTime: "09:00", endTime: "18:00", type: "WORK" };

export default function SchedulePage() {
  useLeaveCatalog();   // 본부가 만든 휴가 유형 이름을 받아 다시 그린다(#216-1)
  const [currentDate, setCurrentDate] = useState(new Date());
  const [cal, setCal] = useUserPrefs<MyCalPrefs>("myCalendar", MYCAL_DEFAULT, cleanMyCal);
  const unit = cal.unit;
  // 주·일 보기 기간과 그 날들의 내 현황(날짜 상세와 같은 API, 하루 한 번씩) — 기간이 바뀐 뒤 늦게 온 옛 응답은 버린다
  const range = useMemo(() => rangeOf(currentDate, unit === "month" ? "month" : unit, 1), [currentDate, unit]);
  const [rangeReload, setRangeReload] = useState(0);   // 관리자·원장이 상세 창에서 일정을 바꾸면 카드도 다시(#81 검증 4)
  const rangeKey = `${unit}:${ymd(range.start)}~${ymd(range.end)}#${rangeReload}`;
  // 값: EmpRow = 그날 내 현황, null = 조회 실패(「일정 없음」으로 위장하지 않는다, #81 검증 3)
  const [dayRowsByDate, setDayRowsByDate] = useState<{ key: string; rows: Record<string, EmpRow | null> }>({ key: "", rows: {} });
  useEffect(() => {
    if (unit === "month") return;
    let alive = true;
    const days = daysOf(range).map(ymd);
    Promise.all(days.map((d) => fetch(`/api/schedule/day?date=${d}&scope=self`).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((list) => {
        if (!alive) return;
        const rows: Record<string, EmpRow | null> = {};
        days.forEach((d, i) => { rows[d] = list[i] ? ((list[i].employees?.[0] as EmpRow | undefined) ?? { status: "NO_SCHEDULE" } as EmpRow) : null; });
        setDayRowsByDate({ key: rangeKey, rows });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);
  const rangeRows = dayRowsByDate.key === rangeKey ? dayRowsByDate.rows : null;

  // 폰 첫 화면 — 이번 주(월 ~ 일) 내 근무 목록(■1 시안 S1-2 「월 13:00–22:00 / … / 토 쉼」). 달력은 「달력 보기」 버튼으로 연다
  const thisWeek = useMemo(() => daysOf(rangeOf(new Date(), "week", 1)).map(ymd), []);
  const [weekList, setWeekList] = useState<Record<string, EmpRow | null> | null>(null);
  const [showCal, setShowCal] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all(thisWeek.map((d) => fetch(`/api/schedule/day?date=${d}&scope=self`).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((list) => {
        if (!alive) return;
        const rows: Record<string, EmpRow | null> = {};
        thisWeek.forEach((d, i) => { rows[d] = list[i] ? ((list[i].employees?.[0] as EmpRow | undefined) ?? { status: "NO_SCHEDULE" } as EmpRow) : null; });
        setWeekList(rows);
      });
    return () => { alive = false; };
  }, [thisWeek, rangeReload]);

  // 공휴일 (관리자 > 공휴일 관리 데이터) — 날짜별 이름 맵
  const [holidayMap, setHolidayMap] = useState<Map<string, string>>(new Map());
  const yearsKey = yearsOf(range).join(",");   // 연말 주는 두 해(#81 검증 5)
  useEffect(() => {
    let alive = true;
    Promise.all(yearsKey.split(",").map((y) => fetch(`/api/holidays?year=${y}`).then((r) => (r.ok ? r.json() : { holidays: [] })).catch(() => ({ holidays: [] }))))
      .then((list) => { if (alive) setHolidayMap(new Map(list.flatMap((d) => (d.holidays || []) as { date: string; name: string }[]).map((h) => [h.date, h.name]))); });
    return () => { alive = false; };
  }, [yearsKey]);
  const [monthData,   setMonthData]   = useState<DayData[]>([]);
  const [totalEmp,    setTotalEmp]    = useState(0);
  const [employees,   setEmployees]   = useState<Employee[]>([]);
  const [role,        setRole]        = useState("EMPLOYEE");
  // 「본인 출퇴근 기록 열람」이 꺼진 직원 — 서버가 출퇴근 수치를 빼고 보낸다. 화면도 출근·지각 칸을 그리지 않는다(#219-14)
  const [attHidden,   setAttHidden]   = useState(false);

  /* 날짜 상세 다이얼로그 */
  const [dayOpen,     setDayOpen]     = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [dayRows,     setDayRows]     = useState<EmpRow[]>([]);
  const [daySummary,  setDaySummary]  = useState<DaySummary | null>(null);
  const [dayLoading,  setDayLoading]  = useState(false);

  /* 상세 필터 */
  const [search,      setSearch]      = useState("");
  const [filterBranch,  setFilterBranch]  = useState("all");
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
    const res  = await fetch(`/api/schedule?year=${year}&month=${month}&scope=self`);
    const data = await res.json();
    setMonthData(data.monthData  || []);
    setTotalEmp(data.totalEmployees || 0);
    setAttHidden(data.attendanceHidden === true);
  }, [year, month]);

  useEffect(() => {
    fetchMonth();
    fetch("/api/auth/me").then(r => r.json()).then(d => setRole(d.user?.role || "EMPLOYEE"));
    fetch("/api/employees").then(r => r.json()).then(d => setEmployees(d.employees || [])).catch(() => {});
  }, [fetchMonth]);

  /* ── 날짜 클릭 → 상세 로드 ── */
  async function openDay(dateStr: string) {
    setSelectedDay(dateStr);
    setSearch(""); setFilterBranch("all"); setFilterStatus("all");
    setDayOpen(true);
    setDayLoading(true);
    try {
      const res  = await fetch(`/api/schedule/day?date=${dateStr}&scope=self`);
      const data = await res.json();
      setDayRows(data.employees || []);
      setDaySummary(data.summary || null);
      if (typeof data.attendanceHidden === "boolean") setAttHidden(data.attendanceHidden);
    } finally { setDayLoading(false); }
  }

  /* ── 캘린더 데이터 ── */
  const days     = eachDayOfInterval({ start: startOfMonth(currentDate), end: endOfMonth(currentDate) });
  const startPad = (getDay(startOfMonth(currentDate)) + 6) % 7;   // 월요일 시작(■4)

  const dayMap = useMemo(() => {
    const m: Record<string, DayData> = {};
    (monthData || []).forEach(d => { m[d.date] = d; });
    return m;
  }, [monthData]);

  /* ── 상세 필터 적용 ── */
  const branches = useMemo(() =>
    [...new Set(dayRows.map(r => r.branch).filter(Boolean) as string[])].sort(), [dayRows]);

  const filteredRows = useMemo(() => dayRows.filter(r => {
    const matchSearch = !search || r.name.includes(search) || (r.branch && r.branch.includes(search));
    const matchBranch   = filterBranch   === "all" || r.branch === filterBranch;
    const matchStatus = filterStatus === "all" || r.status === filterStatus;
    return matchSearch && matchBranch && matchStatus;
  }), [dayRows, search, filterBranch, filterStatus]);

  /* ── 단일 일정 등록 ── */
  async function handleAddSave(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.userId || !addForm.date) { toast.error("직원과 날짜를 선택해주세요."); return; }
    let res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(addForm),
    });
    let data = await res.json();
    // 그날 일정이 이미 있으면 물어보고 덮어쓴다(조용히 덮어쓰지 않게)
    if (res.status === 409 && data.exists) {
      if (!window.confirm(data.error)) return;
      res = await fetch("/api/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...addForm, overwrite: true }) });
      data = await res.json();
    }
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("일정이 등록되었습니다.");
    showWeekWarnings(data.warnings);   // 주 49시간 초과 경고(#38)
    setAddOpen(false);
    setAddForm(defaultForm);
    fetchMonth();
    setRangeReload((n) => n + 1);
    if (dayOpen && selectedDay === addForm.date) openDay(selectedDay);
  }

  /* ── 일정 삭제 ── */
  async function handleDeleteSchedule(scheduleId: string) {
    const res = await fetch(`/api/schedule/${scheduleId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제 실패"); return; }
    toast.success("일정이 삭제되었습니다.");
    fetchMonth();
    setRangeReload((n) => n + 1);
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
      // 이미 일정이 있는 날·휴가인 날·공휴일은 건너뛴다(본부 답변 #15, 공휴일 안내 2026-10-17 #219 검증 F5)
      const skipped = [data.skippedExisting ? `일정 있는 날 ${data.skippedExisting}건` : "", data.skippedLeave ? `휴가인 날 ${data.skippedLeave}건` : "", data.skippedHoliday ? `공휴일 ${data.skippedHoliday}건` : ""].filter(Boolean).join(", ");
      toast.success(`${data.count}개 일정 등록 완료${skipped ? ` · 건너뜀: ${skipped}` : ""}`);
      showWeekWarnings(data.warnings);   // 주 49시간 초과 경고(#38) — 많으면 앞 3건만
      setBulkOpen(false);
      setBulk(defaultBulk);
      fetchMonth();
      setRangeReload((n) => n + 1);
    } finally { setBulkLoading(false); }
  }

  return (
    <div className="space-y-5">
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900 whitespace-nowrap">근무일정</h1>
        <div className="flex gap-2">
          {/* 개인 페이지: 본인 근무 변경 요청만 가능 (일정 등록/관리는 관리자 페이지에서) */}
          <Button className="gap-2 min-h-[44px] sm:min-h-0 bg-[#4f46e5] hover:bg-[#4338ca] text-white" onClick={() => window.location.href = "/schedule/request"}>
            <Plus size={15} />근무 변경 요청
          </Button>
        </div>
      </div>

      {/* ── 폰 첫 화면: 이번 주 내 근무(■1 S1-2) — 줄을 누르면 그날 상세 ── */}
      <Card className="md:hidden">
        <CardContent className="py-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="text-[16px] font-bold text-gray-900 whitespace-nowrap">이번 주 내 근무</h2>
            <button type="button" className="min-h-[44px] px-2 text-[14px] font-semibold text-[#4f46e5]" aria-expanded={showCal}
              onClick={() => setShowCal((v) => !v)}>{showCal ? "달력 닫기" : "달력 보기"}</button>
          </div>
          <ul className="divide-y divide-gray-100">
            {thisWeek.map((d) => {
              const r = weekList?.[d];
              const dt = new Date(`${d}T00:00:00`);
              const isTodayRow = d === kstTodayYmd();
              const text = !weekList ? <span className="text-gray-400">불러오는 중…</span>
                : r === null ? <span className="text-gray-500">불러오지 못함</span>
                : r?.leaveType ? <span className="font-semibold text-blue-700">{LEAVE_LABEL[r.leaveType] ?? r.leaveType}</span>
                : r?.scheduleType === "WORK" ? <span className="font-semibold tabular-nums text-gray-900">{timeRange(r.startTime, r.endTime)}</span>
                : <span className="text-gray-500">쉼</span>;
              return (
                <li key={d}>
                  <button type="button" onClick={() => openDay(d)} className={`flex min-h-[48px] w-full items-center gap-3 py-2 text-left ${isTodayRow ? "bg-indigo-50/50" : ""}`}>
                    <span className="w-14 shrink-0 pl-1 leading-tight">
                      <b className="block text-[15px] text-gray-900">{WEEKDAYS[dt.getDay()]}</b>
                      <span className="text-[13.5px] text-gray-600">{dt.getMonth() + 1}/{dt.getDate()}</span>
                    </span>
                    <span className="flex-1 text-[15px]">{text}</span>
                    {isTodayRow && <span className="mr-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[13px] font-semibold text-[#4f46e5]">오늘</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* ── 캘린더 카드 — 폰에서는 「달력 보기」를 눌렀을 때만 ── */}
      <Card className={showCal ? "" : "hidden md:block"}>
        <CardHeader className="pb-2">
          {/* 폰 폭에서 「2026년 10월」이 두 줄로 꺾이고 「내 일정」이 세로로 쌓였다 — 줄바꿈 없이, 버튼 묶음은 아래 줄로 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 font-semibold text-gray-800 text-xl sm:text-2xl whitespace-nowrap">
              <CalendarDays size={22} className="shrink-0 text-[#4f46e5]" />
              {unit === "month" ? `${year}년 ${month}월` : rangeTitle(range, unit)}
              <span className="shrink-0 text-base font-normal text-gray-500 ml-1">내 일정</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* 보기 단위(#81) */}
              <div role="radiogroup" className="inline-flex rounded-md border bg-white p-0.5 text-xs">
                {VIEW_UNITS.map((u) => (
                  <button key={u} type="button" role="radio" aria-checked={unit === u}
                    className={`px-2.5 py-1 rounded ${unit === u ? "bg-indigo-50 text-[#4f46e5] font-semibold" : "text-gray-600 hover:bg-gray-100"}`}
                    onClick={() => setCal({ unit: u })}>{UNIT_LABEL[u]}</button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="이전"
                  onClick={() => setCurrentDate(d => unit === "month" ? subMonths(d, 1) : shiftAnchor(d, unit, -1))}>
                  <ChevronLeft size={16} />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 px-3 text-xs"
                  onClick={() => setCurrentDate(new Date())}>오늘</Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="다음"
                  onClick={() => setCurrentDate(d => unit === "month" ? addMonths(d, 1) : shiftAnchor(d, unit, 1))}>
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>

        {unit !== "month" ? (
          <CardContent className="px-3 pb-4">
            {!rangeRows ? (
              <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>
            ) : (
              <div className={`grid gap-2 ${unit === "week" ? "grid-cols-1 md:grid-cols-7" : "grid-cols-1"}`}>
                {daysOf(range).map((day) => {
                  const dateStr = ymd(day);
                  const r = rangeRows[dateStr];
                  const dow = getDay(day);
                  const today = isToday(day);
                  const holidayName = holidayMap.get(dateStr);
                  const failed = r === null;
                  const cfg = r ? (STATUS_CFG[r.status] ?? STATUS_CFG.NO_SCHEDULE) : null;
                  return (
                    <button key={dateStr} type="button" onClick={() => openDay(dateStr)} title="누르면 상세"
                      className={`text-left rounded-lg border p-3 transition-all hover:border-gray-300 hover:bg-gray-50/70
                        ${today ? "border-indigo-400 bg-indigo-50/60" : "border-gray-200"} ${!today && (dow === 0 || dow === 6 || holidayName) ? "bg-gray-50/60" : ""}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`font-semibold ${unit === "day" ? "text-xl" : "text-base"} ${today ? "text-[#4f46e5]" : dow === 0 || dow === 6 || holidayName ? "text-gray-500" : "text-gray-700"}`}>
                          {format(day, unit === "day" ? "M월 d일 (EEEE)" : "d일 (EEE)", { locale: ko })}
                        </span>
                        {holidayName && <span className="text-xs text-gray-500 truncate ml-1">{holidayName}</span>}
                      </div>
                      {failed ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium bg-amber-50 text-amber-700 border-amber-200">불러오지 못함 · 다시 열어 주세요</span>
                      ) : cfg && (
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
                        </span>
                      )}
                      <dl className={`mt-2 space-y-1 ${unit === "day" ? "text-base" : "text-sm"}`}>
                        <div className="flex gap-2"><dt className="w-14 shrink-0 text-gray-400">근무</dt><dd className="text-gray-800">
                          {r?.leaveType ? <span className="text-blue-600">{LEAVE_LABEL[r.leaveType] ?? r.leaveType}</span>
                            : r?.scheduleType === "WORK" ? timeRange(r.startTime, r.endTime)
                            : r?.scheduleType ? <span className="text-gray-400">{TYPE_CFG[r.scheduleType] ?? r.scheduleType}</span>
                            : <span className="text-gray-300">일정 없음</span>}
                        </dd></div>
                        {!attHidden && (<>
                          <div className="flex gap-2"><dt className="w-14 shrink-0 text-gray-400">출근</dt><dd className="font-mono text-gray-800"><ClockCell r={r} which="in" date={dateStr} /></dd></div>
                          <div className="flex gap-2"><dt className="w-14 shrink-0 text-gray-400">퇴근</dt><dd className="font-mono text-gray-800"><ClockCell r={r} which="out" date={dateStr} /></dd></div>
                        </>)}
                      </dl>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        ) : (
        <CardContent className="px-3 pb-4">
          {/* 범례 */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 px-1">
            {[
              ...(attHidden ? [] : [
                { dot: "bg-indigo-500", label: "출근" },
                { dot: "bg-rose-500",   label: "지각" },
                { dot: "bg-gray-500",   label: "조퇴" },
                { dot: "bg-rose-300",   label: "결근" },
              ]),
              { dot: "bg-blue-500",   label: "휴가" },
              { dot: "bg-gray-300",   label: "근무 예정" },
            ].map(({ dot, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded-full ${dot}`} />
                <span className="text-base text-gray-500">{label}</span>
              </div>
            ))}
          </div>

          {/* 요일 헤더 — 월요일부터, 토 · 일은 회색(■4) */}
          <div className="grid grid-cols-7 mb-1">
            {MON_FIRST.map((i) => (
              <div key={i} className={`text-center text-base sm:text-xl font-semibold py-1.5
                ${i === 0 || i === 6 ? "text-gray-400" : "text-gray-600"}`}>{WEEKDAYS[i]}</div>
            ))}
          </div>

          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: startPad }).map((_, i) => (
              <div key={`pad-${i}`} className="min-h-[110px] bg-gray-50/40 rounded-lg" />
            ))}

            {days.map(day => {
              const dateStr = format(day, "yyyy-MM-dd");
              const d       = dayMap[dateStr];
              const dow     = getDay(day);
              const today   = isToday(day);
              const inMonth = isSameMonth(day, currentDate);
              const holidayName = holidayMap.get(dateStr); // 공휴일이면 이름

              // 표시할 집계 항목 (0 제외)
              const stats = d ? [
                { val: d.checkedIn,  dot: "bg-indigo-500", label: "출근" },
                { val: d.late,       dot: "bg-rose-500",   label: "지각" },
                { val: d.earlyLeave, dot: "bg-gray-500",   label: "조퇴" },
                { val: d.absent,     dot: "bg-rose-300",   label: "결근" },
                { val: d.leave,      dot: "bg-blue-500",   label: "휴가" },
              ].filter(s => s.val > 0) : [];

              return (
                <div
                  key={dateStr}
                  onClick={() => inMonth && openDay(dateStr)}
                  className={`min-h-[110px] rounded-lg p-1.5 border transition-all select-none
                    ${today
                      ? "border-indigo-400 bg-indigo-50/60"
                      : "border-transparent hover:border-gray-300 hover:bg-gray-50/70"}
                    ${!today && (dow === 0 || dow === 6 || holidayName) ? "bg-gray-50/60" : ""}
                    ${inMonth ? "cursor-pointer" : "opacity-0 pointer-events-none"}`}
                >
                  {/* 날짜 번호 */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className={`text-base sm:text-xl font-semibold w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-full shrink-0
                      ${today
                        ? "bg-[#4f46e5] text-white"
                        : dow === 0 || dow === 6 || holidayName ? "text-gray-400" : "text-gray-600"}`}>
                      {day.getDate()}
                    </p>
                    {holidayName && <span className="text-xs text-gray-500 truncate">{holidayName}</span>}
                  </div>

                  {/* 집계 배지 — 휴대폰 폭에서는 점(●)과 숫자만(글자가 한 자씩 세로로 깨졌다, #219-16). 뜻은 위 범례로 */}
                  <div className="space-y-1">
                    {stats.slice(0, 4).map(s => (
                      <div key={s.label} className="flex items-center gap-1 sm:gap-1.5 whitespace-nowrap" title={`${s.label} ${s.val}`}>
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.dot}`} />
                        <span className="text-sm sm:text-base text-gray-600 leading-tight">
                          <span className="hidden sm:inline">{s.label} </span><span className="font-semibold">{s.val}</span>
                        </span>
                      </div>
                    ))}
                    {stats.length === 0 && d && (d.work > 0 || d.off > 0) && (
                      <div className="flex items-center gap-1 sm:gap-1.5 whitespace-nowrap" title={`근무 예정 ${d.work}`}>
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-gray-300" />
                        <span className="text-sm sm:text-base text-gray-400 leading-tight">
                          <span className="hidden sm:inline">예정 </span>{d.work}<span className="hidden sm:inline">명</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
        )}
      </Card>

      {/* ═══════════════════════════════════
          날짜 상세 다이얼로그
      ═══════════════════════════════════ */}
      <Dialog open={dayOpen} onOpenChange={setDayOpen}>
        <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col p-0 gap-0">
          {/* 헤더 */}
          <DialogHeader className="px-6 pt-5 pb-3 border-b flex-shrink-0">
            <DialogTitle className="text-base font-bold">
              {selectedDay && format(new Date(`${selectedDay}T00:00:00`), "M월 d일 (EEE)", { locale: ko })}
            </DialogTitle>

            {/* 요약 행 */}
            {daySummary && (
              <div className="flex flex-wrap gap-3 mt-2">
                {[
                  { label: "전체",    val: daySummary.total,      dot: "bg-gray-400" },
                  { label: "출근",    val: daySummary.checkedIn,  dot: "bg-indigo-500" },
                  { label: "지각",    val: daySummary.late,       dot: "bg-rose-500" },
                  { label: "조퇴",    val: daySummary.earlyLeave, dot: "bg-gray-500" },
                  { label: "결근",    val: daySummary.absent,     dot: "bg-rose-300" },
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
                placeholder="이름 또는 지점명 검색"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm bg-white"
              />
            </div>

            {/* 지점 필터 */}
            <Select value={filterBranch} onValueChange={v => v && setFilterBranch(v)}>
              <SelectTrigger className="h-8 w-36 text-sm bg-white">
                <SelectValue placeholder="지점" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 지점</SelectItem>
                {branches.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* 상태 필터 */}
            <Select value={filterStatus} onValueChange={v => v && setFilterStatus(v)}>
              <SelectTrigger className="h-8 w-36 text-sm bg-white">
                <SelectValue placeholder="상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                {Object.entries(STATUS_CFG)
                  .filter(([k]) => attHidden ? !["NORMAL", "LATE", "EARLY_LEAVE", "ABSENT", "NOT_YET"].includes(k) : k !== "WORK")
                  .map(([k, v]) => (
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
                    <th className="px-3 py-2.5 font-medium w-36">근무 예정</th>
                    {!attHidden && <th className="px-3 py-2.5 font-medium w-20">출근</th>}
                    {!attHidden && <th className="px-3 py-2.5 font-medium w-20">퇴근</th>}
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

                        {/* 근무 예정 */}
                        <td className="px-3 py-2.5 text-xs text-gray-600">
                          {r.leaveType
                            ? <span className="text-blue-600">{LEAVE_LABEL[r.leaveType] ?? r.leaveType}</span>
                            : r.scheduleType === "WORK"
                              ? timeRange(r.startTime, r.endTime)
                              : r.scheduleType
                                ? <span className="text-gray-400">{TYPE_CFG[r.scheduleType] ?? r.scheduleType}</span>
                                : <span className="text-gray-300">-</span>}
                        </td>

                        {/* 출근 — 출퇴근 열람이 꺼진 직원에게는 그리지 않는다(#219-14) */}
                        {!attHidden && (
                          <td className="px-3 py-2.5 font-mono text-xs text-gray-700">
                            <ClockCell r={r} which="in" date={selectedDay} />
                          </td>
                        )}

                        {/* 퇴근 */}
                        {!attHidden && (
                          <td className="px-3 py-2.5 font-mono text-xs text-gray-700">
                            <ClockCell r={r} which="out" date={selectedDay} />
                          </td>
                        )}

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
                      {emp.branch ? `[${emp.branch}] ` : ""}{emp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>날짜 *</Label>
              <Input type="date" max="9999-12-31" value={addForm.date} onChange={e => setAddForm(f => ({ ...f, date: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label>유형</Label>
              <Select value={addForm.type} onValueChange={v => v && setAddForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue>{TYPE_CFG[addForm.type] ?? addForm.type}</SelectValue></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>근무 시간 종류</Label>
              <TemplatePicker branch={employees.find((x) => x.id === addForm.userId)?.branch ?? null}
                onPick={(st, et) => setAddForm((f) => ({ ...f, startTime: st, endTime: et }))} />
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
            <DialogTitle>여러 날 한 번에 넣기</DialogTitle>
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
                      {emp.name}{emp.branch ? <span className="text-gray-500 text-xs"> · {emp.branch}</span> : null}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>기간 *</Label>
                <Button type="button" variant="ghost" size="sm" className="h-6 text-xs text-[#4f46e5]" onClick={setBulkThisMonth}>
                  이번 달
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" max="9999-12-31" value={bulk.startDate} onChange={e => setBulk(b => ({ ...b, startDate: e.target.value }))} />
                <Input type="date" max="9999-12-31" value={bulk.endDate}   onChange={e => setBulk(b => ({ ...b, endDate:   e.target.value }))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>요일 *</Label>
              <div className="flex gap-1.5">
                {MON_FIRST.map((i) => (
                  <button key={i} type="button"
                    onClick={() => setBulk(b => ({
                      ...b,
                      weekdays: b.weekdays.includes(i) ? b.weekdays.filter(d => d !== i) : [...b.weekdays, i].sort(),
                    }))}
                    className={`w-9 h-9 rounded-full text-sm font-medium border transition-colors
                      ${bulk.weekdays.includes(i)
                        ? "bg-[#4f46e5] text-white border-[#4f46e5]"
                        : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"}`}
                  >{WEEKDAYS[i]}</button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>근무 시간 종류</Label>
              <TemplatePicker onPick={(st, et) => setBulk((b) => ({ ...b, startTime: st, endTime: et }))} />
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
              선택한 직원 · 기간 · 요일의 기존 일정은 덮어씁니다.
            </p>

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>취소</Button>
              <Button type="submit" className="bg-[#4f46e5] text-white hover:bg-[#4338ca]" disabled={bulkLoading}>{bulkLoading ? "넣는 중..." : "한 번에 넣기"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
