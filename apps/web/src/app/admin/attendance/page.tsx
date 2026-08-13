"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Clock, LogIn, LogOut, TrendingUp, TrendingDown, Minus,
  ChevronLeft, ChevronRight, RotateCcw, Download, Pencil, Plus,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import * as XLSX from "xlsx";
import {
  format, startOfDay, isSameDay,
  addDays, addWeeks, addMonths, addYears,
  subDays, subWeeks, subMonths, subYears,
  startOfWeek, endOfWeek,
} from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

/* ── 타입 ── */
type Period = "daily" | "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";
type AttendanceRecord = {
  id: string; date: string; clockIn: string | null; clockOut: string | null;
  status: string; minutes: number; userName?: string; userBranch?: string | null;
};
type Stats = { total: number; normal: number; late: number; earlyLeave: number; absent: number; totalMinutes: number; avgMinutes: number };
type ChartItem = { date: string; hours: number; count?: number };
type StatsResponse = {
  period: Period; range: { start: string; end: string };
  current: Stats; previous: Stats;
  chartData: ChartItem[];
  records: AttendanceRecord[];
};
type Employee = { id: string; name: string; department: string | null; branch?: string | null };
type TodayAttendee = {
  id: string; userId: string; name: string; branch: string | null;
  jobGroup: string | null; position: string | null;
  status: string; clockIn: string | null; clockOut: string | null; minutes: number;
};

/* ── 상수 ── */
const PERIODS: { value: Period; label: string }[] = [
  { value: "daily",      label: "일간" },
  { value: "weekly",     label: "주간" },
  { value: "monthly",    label: "월간" },
  { value: "quarterly",  label: "분기" },
  { value: "semiannual", label: "반기" },
  { value: "annual",     label: "연간" },
];

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline"; bar: string }> = {
  NORMAL:      { label: "정상",     variant: "default",     bar: "#22c55e" },
  LATE:        { label: "지각",     variant: "destructive", bar: "#f97316" },
  EARLY_LEAVE: { label: "조기퇴근", variant: "secondary",   bar: "#a855f7" },
  ABSENT:      { label: "결근",     variant: "destructive", bar: "#ef4444" },
  HOLIDAY:     { label: "휴일",     variant: "outline",     bar: "#94a3b8" },
};

/* ── 헬퍼 ── */
function fmtMin(min: number) {
  if (!min) return "0시간";
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

function Trend({ curr, prev }: { curr: number; prev: number }) {
  if (prev === 0) return null;
  const diff = curr - prev;
  const pct = Math.abs(Math.round((diff / prev) * 100));
  if (diff > 0) return <span className="text-xs text-green-600 flex items-center gap-0.5"><TrendingUp size={11} />+{pct}%</span>;
  if (diff < 0) return <span className="text-xs text-red-500 flex items-center gap-0.5"><TrendingDown size={11} />-{pct}%</span>;
  return <span className="text-xs text-gray-400 flex items-center gap-0.5"><Minus size={11} />0%</span>;
}

/** baseDate 기준으로 period 레이블 계산 */
function getPeriodLabel(period: Period, date: Date): string {
  switch (period) {
    case "daily":
      return format(date, "yyyy년 MM월 dd일 (EEEE)", { locale: ko });
    case "weekly": {
      const s = startOfWeek(date, { weekStartsOn: 1 });
      const e = endOfWeek(date, { weekStartsOn: 1 });
      return `${format(s, "yyyy.MM.dd")} ~ ${format(e, "MM.dd")}`;
    }
    case "monthly":
      return format(date, "yyyy년 MM월", { locale: ko });
    case "quarterly":
      return `${format(date, "yyyy년")} ${Math.ceil((date.getMonth() + 1) / 3)}분기`;
    case "semiannual":
      return `${format(date, "yyyy년")} ${date.getMonth() < 6 ? "상반기" : "하반기"}`;
    case "annual":
      return format(date, "yyyy년", { locale: ko });
  }
}

/** 다음 기간 시작이 오늘을 초과하는지 */
function isNextFuture(period: Period, date: Date): boolean {
  const next = (() => {
    switch (period) {
      case "daily":      return addDays(date, 1);
      case "weekly":     return addWeeks(date, 1);
      case "monthly":    return addMonths(date, 1);
      case "quarterly":  return addMonths(date, 3);
      case "semiannual": return addMonths(date, 6);
      case "annual":     return addYears(date, 1);
    }
  })();
  return startOfDay(next) > startOfDay(new Date());
}

export default function AttendancePage() {
  /* 출퇴근 탭 */
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [clockLoading, setClockLoading] = useState(false);
  const [now, setNow] = useState<Date | null>(null); // 마운트 후에만 채워 hydration mismatch 방지

  /* 통계 탭 */
  const [period, setPeriod]           = useState<Period>("monthly");
  const [baseDate, setBaseDate]       = useState(() => startOfDay(new Date()));
  const [statsData, setStatsData]     = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [employees, setEmployees]     = useState<Employee[]>([]);
  const [selectedUser, setSelectedUser] = useState("me");
  const [selectedBranch, setSelectedBranch] = useState(""); // "" = 지점별 조회 안 함
  const [myRole, setMyRole]           = useState("EMPLOYEE");

  /* 오늘 출퇴근한 직원 목록 (관리자/원장) */
  const [todayList, setTodayList] = useState<TodayAttendee[]>([]);

  /* 날짜 직접 입력 (input[type=date] 용) */
  const [dateInput, setDateInput] = useState(format(new Date(), "yyyy-MM-dd"));

  /* ── 출퇴근 기록 수동 수정/생성 (관리자 전용) ── */
  const [editRec, setEditRec] = useState<AttendanceRecord | null>(null);
  const [editIn, setEditIn] = useState("");   // "HH:mm" (비우면 삭제)
  const [editOut, setEditOut] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ userId: "", date: format(new Date(), "yyyy-MM-dd"), clockIn: "", clockOut: "" });
  const [editSaving, setEditSaving] = useState(false);

  function openEditRec(r: AttendanceRecord) {
    setEditIn(r.clockIn ? format(new Date(r.clockIn), "HH:mm") : "");
    setEditOut(r.clockOut ? format(new Date(r.clockOut), "HH:mm") : "");
    setEditRec(r);
  }

  // "HH:mm" + 기록 날짜 → KST 오프셋 포함 ISO (타임존 어긋남 방지). 비우면 null(삭제)
  const toKstIso = (dateYmd: string, time: string) => (time ? `${dateYmd}T${time}:00+09:00` : null);

  async function saveEditRec() {
    if (!editRec) return;
    setEditSaving(true);
    try {
      const dateYmd = editRec.date.slice(0, 10);
      const res = await fetch(`/api/attendance/${editRec.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clockIn: toKstIso(dateYmd, editIn), clockOut: toKstIso(dateYmd, editOut) }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || "수정 실패"); return; }
      toast.success("출퇴근 기록이 수정되었습니다.");
      if (d.warning) toast.info(d.warning);
      setEditRec(null);
      fetchStats();
    } finally { setEditSaving(false); }
  }

  async function saveAddRec() {
    if (!addForm.userId) { toast.error("직원을 선택해주세요."); return; }
    if (!addForm.clockIn && !addForm.clockOut) { toast.error("출근 또는 퇴근 시각을 입력해주세요."); return; }
    setEditSaving(true);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: addForm.userId, date: addForm.date,
          clockIn: toKstIso(addForm.date, addForm.clockIn), clockOut: toKstIso(addForm.date, addForm.clockOut),
        }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || "생성 실패"); return; }
      toast.success("출퇴근 기록이 생성되었습니다.");
      setAddOpen(false);
      fetchStats();
    } finally { setEditSaving(false); }
  }

  /* ── 상세 기록: 직원 필터 + 엑셀 다운로드 ── */
  const [empFilter, setEmpFilter] = useState<string>("all");
  useEffect(() => { setEmpFilter("all"); }, [statsData]);
  const recordNames = useMemo(() => {
    const s = new Set<string>();
    statsData?.records.forEach((r) => { if (r.userName) s.add(r.userName); });
    return [...s].sort((a, b) => a.localeCompare(b, "ko"));
  }, [statsData]);
  const multiPerson = recordNames.length > 1; // 지점 조회 등 여러 명일 때만 이름 컬럼/필터 표시
  const visibleRecords = useMemo(() => {
    const base = statsData?.records || [];
    const filtered = empFilter === "all" ? base : base.filter((r) => r.userName === empFilter);
    return [...filtered].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || (a.userName || "").localeCompare(b.userName || "", "ko")
    );
  }, [statsData, empFilter]);
  const visibleTotals = useMemo(
    () => ({ minutes: visibleRecords.reduce((s, r) => s + (r.minutes || 0), 0), days: visibleRecords.length }),
    [visibleRecords]
  );

  function downloadExcel() {
    if (!statsData || visibleRecords.length === 0) { toast.error("다운로드할 기록이 없습니다."); return; }
    const scopeLabel = selectedBranch
      ? selectedBranch
      : selectedUser === "me" ? "본인" : (employees.find((e) => e.id === selectedUser)?.name || "직원");
    const rangeLabel = `${format(new Date(statsData.range.start), "yyyyMMdd")}-${format(new Date(statsData.range.end), "yyyyMMdd")}`;
    const rows = visibleRecords.map((r) => ({
      날짜: format(new Date(r.date), "yyyy-MM-dd"),
      요일: format(new Date(r.date), "EEE", { locale: ko }),
      이름: r.userName || "",
      지점: r.userBranch || "",
      출근: r.clockIn ? format(new Date(r.clockIn), "HH:mm") : "",
      퇴근: r.clockOut ? format(new Date(r.clockOut), "HH:mm") : "",
      "근무시간(분)": r.minutes || 0,
      근무시간: r.minutes > 0 ? fmtMin(r.minutes) : "",
      상태: (STATUS_CONFIG[r.status]?.label as string) || r.status,
    }));
    rows.push({
      날짜: "합계", 요일: "", 이름: empFilter === "all" ? "" : empFilter, 지점: "",
      출근: "", 퇴근: "",
      "근무시간(분)": visibleTotals.minutes,
      근무시간: fmtMin(visibleTotals.minutes),
      상태: `${visibleTotals.days}일 출근`,
    } as (typeof rows)[number]);
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 5 }, { wch: 10 }, { wch: 12 }, { wch: 7 }, { wch: 7 }, { wch: 11 }, { wch: 11 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "출퇴근");
    XLSX.writeFile(wb, `출퇴근_${scopeLabel}_${rangeLabel}.xlsx`);
  }

  /* ── 오늘 출퇴근 조회 ── */
  const fetchToday = useCallback(async () => {
    const res = await fetch(`/api/attendance?year=${new Date().getFullYear()}&month=${new Date().getMonth() + 1}`);
    const data = await res.json();
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const rec = data.records?.find((r: AttendanceRecord) => r.date?.startsWith(todayStr));
    setTodayRecord(rec || null);
  }, []);

  /* ── 오늘 출퇴근한 직원 목록 조회 ── */
  const fetchTodayList = useCallback(async () => {
    const res = await fetch("/api/attendance/today-list");
    if (res.ok) {
      const data = await res.json();
      setTodayList(data.records || []);
    }
  }, []);

  /* ── 기간별 통계 조회 ── */
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    // 지점별 조회가 선택되면 branch 우선, 아니면 개인(userId)
    const scope = selectedBranch
      ? `&branch=${encodeURIComponent(selectedBranch)}`
      : selectedUser === "me" ? "" : `&userId=${selectedUser}`;
    const dateStr = format(baseDate, "yyyy-MM-dd");
    const res = await fetch(`/api/attendance/stats?period=${period}&date=${dateStr}${scope}`);
    const data = await res.json();
    setStatsData(data);
    setStatsLoading(false);
  }, [period, baseDate, selectedUser, selectedBranch]);

  useEffect(() => {
    fetchToday();
    fetchTodayList();
    setNow(new Date()); // 마운트 즉시 1회
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [fetchToday, fetchTodayList]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => setMyRole(d.user?.role || "EMPLOYEE"));
    fetch("/api/employees").then(r => r.json()).then(d => setEmployees(d.employees || [])).catch(() => {});
  }, []);

  /* ── 기간 이동 ── */
  function navigate(dir: -1 | 1) {
    setBaseDate(prev => {
      const next = dir === 1
        ? (() => {
            switch (period) {
              case "daily":      return addDays(prev, 1);
              case "weekly":     return addWeeks(prev, 1);
              case "monthly":    return addMonths(prev, 1);
              case "quarterly":  return addMonths(prev, 3);
              case "semiannual": return addMonths(prev, 6);
              case "annual":     return addYears(prev, 1);
            }
          })()
        : (() => {
            switch (period) {
              case "daily":      return subDays(prev, 1);
              case "weekly":     return subWeeks(prev, 1);
              case "monthly":    return subMonths(prev, 1);
              case "quarterly":  return subMonths(prev, 3);
              case "semiannual": return subMonths(prev, 6);
              case "annual":     return subYears(prev, 1);
            }
          })();
      if (startOfDay(next) > startOfDay(new Date())) return prev;
      setDateInput(format(next, "yyyy-MM-dd"));
      return next;
    });
  }

  /* ── 날짜 직접 입력 ── */
  function applyDateInput() {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) { toast.error("올바른 날짜를 입력해주세요."); return; }
    const clamped = startOfDay(d) > startOfDay(new Date()) ? startOfDay(new Date()) : startOfDay(d);
    setBaseDate(clamped);
    setDateInput(format(clamped, "yyyy-MM-dd"));
  }

  /* ── 오늘로 초기화 ── */
  function resetToToday() {
    const today = startOfDay(new Date());
    setBaseDate(today);
    setDateInput(format(today, "yyyy-MM-dd"));
  }

  const nextDisabled = useMemo(() => isNextFuture(period, baseDate), [period, baseDate]);
  const isToday      = useMemo(() => isSameDay(baseDate, new Date()), [baseDate]);

  // 직원 목록에서 지점 추출
  const branchList = useMemo(
    () => [...new Set(employees.map(e => e.branch).filter(Boolean) as string[])].sort(),
    [employees]
  );

  const c = statsData?.current;
  const p = statsData?.previous;

  /* ── 출근/퇴근 ── */
  async function handleClock(type: "in" | "out") {
    setClockLoading(true);
    try {
      // GPS 좌표 취득 (실패 시 null 전송 → 서버에서 지오펜스 미설정이면 허용)
      let latitude: number | null = null;
      let longitude: number | null = null;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true, timeout: 10000,
            });
          });
          latitude  = pos.coords.latitude;
          longitude = pos.coords.longitude;
        } catch {
          // 위치 거부 / 타임아웃 → 서버가 geofence 설정 여부에 따라 판단
        }
      }

      const res = await fetch(`/api/attendance/clock-${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude, longitude }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.outsideGeofence) {
          toast.error(`📍 ${data.error}`, { duration: 5000 });
        } else {
          toast.error(data.error);
        }
        return;
      }
      toast.success(type === "in" ? "출근이 등록되었습니다." : "퇴근이 등록되었습니다.");
      fetchToday();
      fetchTodayList();
    } finally { setClockLoading(false); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">출퇴근 관리</h1>

      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">오늘 출퇴근</TabsTrigger>
          <TabsTrigger value="stats">기간별 통계</TabsTrigger>
        </TabsList>

        {/* ── 오늘 출퇴근 탭 ── */}
        <TabsContent value="today" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row items-center gap-6">
                {/* 시계 */}
                <div className="text-center">
                  <p className="text-5xl font-mono font-bold text-gray-900">{now ? format(now, "HH:mm:ss") : "--:--:--"}</p>
                  <p className="text-gray-500 mt-1 text-sm">{now ? format(now, "yyyy년 MM월 dd일 (EEEE)", { locale: ko }) : ""}</p>
                </div>
                {/* 현황 */}
                <div className="flex-1 grid grid-cols-2 gap-4">
                  <div className="bg-green-50 rounded-xl p-4 text-center">
                    <p className="text-sm text-green-700 font-medium">출근 시각</p>
                    <p className="text-3xl font-bold text-green-800 mt-1">
                      {todayRecord?.clockIn ? format(new Date(todayRecord.clockIn), "HH:mm") : "--:--"}
                    </p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-4 text-center">
                    <p className="text-sm text-blue-700 font-medium">퇴근 시각</p>
                    <p className="text-3xl font-bold text-blue-800 mt-1">
                      {todayRecord?.clockOut ? format(new Date(todayRecord.clockOut), "HH:mm") : "--:--"}
                    </p>
                  </div>
                </div>
                {/* 버튼 */}
                <div className="flex gap-3">
                  <Button onClick={() => handleClock("in")} disabled={clockLoading || !!todayRecord?.clockIn}
                    className="bg-green-600 hover:bg-green-700 gap-2" size="lg">
                    <LogIn size={18} />출근
                  </Button>
                  <Button onClick={() => handleClock("out")}
                    disabled={clockLoading || !todayRecord?.clockIn || !!todayRecord?.clockOut}
                    variant="outline" className="border-blue-500 text-blue-600 hover:bg-blue-50 gap-2" size="lg">
                    <LogOut size={18} />퇴근
                  </Button>
                </div>
              </div>
              {todayRecord && (
                <div className="mt-4 pt-4 border-t flex items-center gap-3">
                  <Badge variant={STATUS_CONFIG[todayRecord.status]?.variant || "outline"}>
                    {STATUS_CONFIG[todayRecord.status]?.label || todayRecord.status}
                  </Badge>
                  {todayRecord.minutes > 0 && (
                    <span className="text-sm text-gray-600">오늘 근무시간: <strong>{fmtMin(todayRecord.minutes)}</strong></span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 오늘 출퇴근한 직원 목록 (관리자/원장) */}
          {myRole !== "EMPLOYEE" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  오늘 출근한 직원
                  <Badge variant="secondary">{todayList.length}명</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {todayList.length === 0 ? (
                  <div className="py-10 text-center text-gray-400 text-sm">아직 오늘 출근한 직원이 없습니다.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b text-left text-gray-500">
                        <tr>
                          <th className="pb-2 font-medium">직원</th>
                          <th className="pb-2 font-medium">지점</th>
                          <th className="pb-2 font-medium">출근</th>
                          <th className="pb-2 font-medium">퇴근</th>
                          <th className="pb-2 font-medium">상태</th>
                          <th className="pb-2 font-medium text-right">근무시간</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {todayList.map((r) => {
                          const s = STATUS_CONFIG[r.status] || { label: r.status, variant: "outline" as const };
                          return (
                            <tr key={r.id} className="hover:bg-gray-50">
                              <td className="py-2.5">
                                <span className="font-medium">{r.name}</span>
                                {(r.jobGroup || r.position) && (
                                  <span className="text-xs text-gray-400 ml-2">{r.jobGroup || r.position}</span>
                                )}
                              </td>
                              <td className="py-2.5 text-gray-500">{r.branch || "-"}</td>
                              <td className="py-2.5">{r.clockIn ? format(new Date(r.clockIn), "HH:mm") : "-"}</td>
                              <td className="py-2.5">{r.clockOut ? format(new Date(r.clockOut), "HH:mm") : <span className="text-gray-400">근무 중</span>}</td>
                              <td className="py-2.5"><Badge variant={s.variant}>{s.label}</Badge></td>
                              <td className="py-2.5 text-right">{r.minutes > 0 ? fmtMin(r.minutes) : "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── 기간별 통계 탭 ── */}
        <TabsContent value="stats" className="space-y-4 mt-4">

          {/* ── 필터 행 1: 기간 단위 + 직원 선택 ── */}
          <div className="flex flex-wrap items-center gap-3">
            {/* 기간 단위 버튼 그룹 */}
            <div className="flex bg-white border rounded-lg overflow-hidden shadow-sm">
              {PERIODS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setPeriod(value)}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-r last:border-r-0
                    ${period === value ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 개인별 조회 (관리자) */}
            {myRole !== "EMPLOYEE" && (
              <Select
                value={selectedUser}
                onValueChange={(value) => {
                  if (!value) return;
                  setSelectedUser(value);
                  setSelectedBranch(""); // 개인 선택 시 지점 조회 해제
                }}
              >
                <SelectTrigger className="w-44 bg-white">
                  <SelectValue placeholder="개인별 조회" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="me">내 기록</SelectItem>
                  {employees.map(e => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.branch ? `[${e.branch}] ` : ""}{e.name}{e.department ? ` (${e.department})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* 지점별 조회 (관리자) */}
            {myRole !== "EMPLOYEE" && branchList.length > 0 && (
              <Select
                value={selectedBranch || "NONE"}
                onValueChange={(value) => {
                  if (!value) return;
                  if (value === "NONE") {
                    setSelectedBranch("");
                  } else {
                    setSelectedBranch(value);
                    setSelectedUser("me"); // 지점 선택 시 개인 조회 해제
                  }
                }}
              >
                <SelectTrigger className="w-44 bg-white">
                  <SelectValue placeholder="지점별 조회" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">지점별 조회 안 함</SelectItem>
                  {branchList.map(b => (
                    <SelectItem key={b} value={b}>{b} 전체</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* 현재 조회 대상 표시 */}
            {selectedBranch && (
              <span className="text-sm text-blue-600 font-medium">📍 {selectedBranch} 지점 전체 통계</span>
            )}
          </div>

          {/* ── 필터 행 2: 기간 내비게이션 ── */}
          <div className="flex flex-wrap items-center gap-2 bg-white border rounded-xl px-4 py-2.5 shadow-sm">
            {/* 이전 버튼 */}
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => navigate(-1)}>
              <ChevronLeft size={16} />
            </Button>

            {/* 현재 기간 레이블 */}
            <span className="text-sm font-semibold text-gray-800 min-w-52 text-center px-2">
              {getPeriodLabel(period, baseDate)}
            </span>

            {/* 다음 버튼 */}
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg"
              onClick={() => navigate(1)} disabled={nextDisabled}>
              <ChevronRight size={16} />
            </Button>

            <div className="w-px h-5 bg-gray-200 mx-1" />

            {/* 날짜 직접 입력 */}
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={dateInput}
                max={format(new Date(), "yyyy-MM-dd")}
                onChange={e => setDateInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && applyDateInput()}
                className="h-8 w-36 text-xs border-gray-200"
              />
              <Button variant="outline" size="sm" className="h-8 text-xs px-3" onClick={applyDateInput}>
                이동
              </Button>
            </div>

            <div className="w-px h-5 bg-gray-200 mx-1" />

            {/* 오늘로 초기화 */}
            <Button
              variant="ghost" size="sm"
              className={`h-8 text-xs gap-1 ${isToday ? "text-gray-300 cursor-default" : "text-blue-600 hover:text-blue-700 hover:bg-blue-50"}`}
              onClick={resetToToday}
              disabled={isToday}
            >
              <RotateCcw size={12} />오늘
            </Button>
          </div>

          {/* ── 통계 본문 ── */}
          {statsLoading ? (
            <div className="text-center py-16 text-gray-400">불러오는 중...</div>
          ) : c && (
            <>
              {/* 요약 카드 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "총 출근일",    val: `${c.total}일`,          prev: p?.total ?? 0,        curr: c.total },
                  { label: "누적 근무시간", val: fmtMin(c.totalMinutes),  prev: p?.totalMinutes ?? 0, curr: c.totalMinutes },
                  { label: "평균 근무시간", val: fmtMin(c.avgMinutes),    prev: p?.avgMinutes ?? 0,   curr: c.avgMinutes },
                  { label: "정상 출퇴근",  val: `${c.normal}회`,          prev: p?.normal ?? 0,       curr: c.normal },
                ].map(({ label, val, prev: pv, curr: cv }) => (
                  <Card key={label}>
                    <CardContent className="pt-5">
                      <p className="text-xs text-gray-500 mb-1">{label}</p>
                      <p className="text-2xl font-bold text-gray-900">{val}</p>
                      <div className="mt-1"><Trend curr={cv} prev={pv} /></div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* 상태 분포 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "지각",     val: c.late,       color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" },
                  { label: "조기퇴근", val: c.earlyLeave,  color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-200" },
                  { label: "결근",     val: c.absent,     color: "text-red-600",    bg: "bg-red-50",    border: "border-red-200" },
                  {
                    label: "출근율",
                    val: c.total > 0 ? `${Math.round((c.normal / c.total) * 100)}%` : "0%",
                    color: "text-green-600", bg: "bg-green-50", border: "border-green-200",
                  },
                ].map(({ label, val, color, bg, border }) => (
                  <div key={label} className={`rounded-xl p-4 border ${bg} ${border}`}>
                    <p className="text-xs font-medium text-gray-500">{label}</p>
                    <p className={`text-2xl font-bold mt-1 ${color}`}>{typeof val === "number" ? `${val}회` : val}</p>
                  </div>
                ))}
              </div>

              {/* 근무시간 차트 */}
              {statsData.chartData.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp size={16} />
                      기간별 근무시간
                      <span className="text-xs font-normal text-gray-400 ml-1">
                        ({period === "quarterly" || period === "semiannual" || period === "annual" ? "월별 합산" : "일별"})
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={statsData.chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} unit="h" />
                        <Tooltip
                          // @ts-ignore
                          formatter={(v) => v !== undefined ? [`${v}시간`, "근무시간"] : ["", ""]}
                          labelStyle={{ fontWeight: 600 }}
                          contentStyle={{ borderRadius: 8, fontSize: 12 }}
                        />
                        <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={40}>
                          {statsData.chartData.map((item, i) => (
                            <Cell key={i} fill={item.hours >= 8 ? "#3b82f6" : item.hours >= 4 ? "#93c5fd" : "#e2e8f0"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="flex gap-4 justify-end mt-2">
                      {[
                        { color: "bg-blue-500",  label: "8시간 이상" },
                        { color: "bg-blue-200",  label: "4~8시간" },
                        { color: "bg-slate-200", label: "4시간 미만" },
                      ].map(({ color, label }) => (
                        <div key={label} className="flex items-center gap-1.5">
                          <div className={`w-3 h-3 rounded-sm ${color}`} />
                          <span className="text-xs text-gray-500">{label}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 상세 기록 테이블 */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">상세 기록</CardTitle>
                    <div className="flex gap-2">
                      {myRole === "ADMIN" && (
                        <Button variant="outline" size="sm" className="gap-1"
                          onClick={() => { setAddForm({ userId: "", date: format(new Date(), "yyyy-MM-dd"), clockIn: "", clockOut: "" }); setAddOpen(true); }}>
                          <Plus size={13} />기록 추가
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={downloadExcel} className="gap-1">
                        <Download size={13} />엑셀 다운로드
                      </Button>
                    </div>
                  </div>
                  {/* 여러 명 조회(지점 등) 시 직원 필터 칩 */}
                  {multiPerson && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      <button onClick={() => setEmpFilter("all")}
                        className={`text-xs rounded-full px-3 py-1 border ${empFilter === "all" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                        전체 {recordNames.length}명
                      </button>
                      {recordNames.map((n) => (
                        <button key={n} onClick={() => setEmpFilter(n)}
                          className={`text-xs rounded-full px-3 py-1 border ${empFilter === n ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-gray-500">
                          <th className="pb-3 font-medium">날짜</th>
                          {multiPerson && <th className="pb-3 font-medium">이름</th>}
                          <th className="pb-3 font-medium">출근</th>
                          <th className="pb-3 font-medium">퇴근</th>
                          <th className="pb-3 font-medium">근무시간</th>
                          <th className="pb-3 font-medium">상태</th>
                          {myRole === "ADMIN" && <th className="pb-3 font-medium text-right">수정</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRecords.length === 0 ? (
                          <tr>
                            <td colSpan={multiPerson ? 7 : 6} className="py-8 text-center text-gray-400">해당 기간에 기록이 없습니다.</td>
                          </tr>
                        ) : visibleRecords.map(r => {
                          const s = STATUS_CONFIG[r.status] || { label: r.status, variant: "outline" as const };
                          return (
                            <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                              <td className="py-3">{format(new Date(r.date), "MM월 dd일 (EEE)", { locale: ko })}</td>
                              {multiPerson && (
                                <td className="py-3">
                                  <button onClick={() => setEmpFilter(empFilter === r.userName ? "all" : r.userName || "all")}
                                    className="font-medium text-gray-800 hover:text-blue-600 hover:underline" title="이 직원만 보기">
                                    {r.userName || "-"}
                                  </button>
                                </td>
                              )}
                              <td className="py-3">{r.clockIn ? format(new Date(r.clockIn), "HH:mm") : "-"}</td>
                              <td className="py-3">{r.clockOut ? format(new Date(r.clockOut), "HH:mm") : "-"}</td>
                              <td className="py-3 font-medium">{r.minutes > 0 ? fmtMin(r.minutes) : "-"}</td>
                              <td className="py-3"><Badge variant={s.variant}>{s.label}</Badge></td>
                              {myRole === "ADMIN" && (
                                <td className="py-3 text-right">
                                  <button onClick={() => openEditRec(r)} className="text-gray-400 hover:text-blue-600" title="출퇴근 시각 수정">
                                    <Pencil size={14} />
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                      {visibleRecords.length > 0 && (
                        <tfoot>
                          <tr className="border-t bg-gray-50">
                            <td colSpan={multiPerson ? 4 : 3} className="py-2.5 px-0 text-xs font-semibold text-gray-600">
                              합계{empFilter !== "all" ? ` (${empFilter})` : ""}
                            </td>
                            <td className="py-2.5 text-xs font-semibold text-blue-700">{fmtMin(visibleTotals.minutes)}</td>
                            <td className="py-2.5 text-xs text-gray-500">{visibleTotals.days}일 출근</td>
                            {myRole === "ADMIN" && <td />}
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* 출퇴근 기록 수정 (관리자) */}
      <Dialog open={!!editRec} onOpenChange={(v) => { if (!v) setEditRec(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>출퇴근 기록 수정</DialogTitle></DialogHeader>
          {editRec && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                <span className="font-semibold">{editRec.userName || "본인"}</span> · {format(new Date(editRec.date), "yyyy년 MM월 dd일 (EEE)", { locale: ko })}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">출근 (비우면 삭제)</label>
                  <Input type="time" value={editIn} onChange={(e) => setEditIn(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-gray-500">퇴근 (비우면 삭제)</label>
                  <Input type="time" value={editOut} onChange={(e) => setEditOut(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-gray-400">지각/조퇴 상태는 자동으로 다시 계산됩니다. 수정 내역은 감사 로그에 남습니다.</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditRec(null)}>취소</Button>
                <Button size="sm" onClick={saveEditRec} disabled={editSaving}>{editSaving ? "저장 중…" : "저장"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 출퇴근 기록 수동 생성 (관리자) */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>출퇴근 기록 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">직원</label>
              <Select value={addForm.userId} onValueChange={(v) => setAddForm((f) => ({ ...f, userId: v }))}>
                <SelectTrigger><SelectValue placeholder="직원 선택" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}{e.branch ? ` · ${e.branch}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-gray-500">날짜</label>
              <Input type="date" value={addForm.date} onChange={(e) => setAddForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">출근</label>
                <Input type="time" value={addForm.clockIn} onChange={(e) => setAddForm((f) => ({ ...f, clockIn: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-500">퇴근</label>
                <Input type="time" value={addForm.clockOut} onChange={(e) => setAddForm((f) => ({ ...f, clockOut: e.target.value }))} />
              </div>
            </div>
            <p className="text-xs text-gray-400">수동 생성 기록은 GPS 좌표 없이 저장되며, 생성 내역은 감사 로그에 남습니다.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>취소</Button>
              <Button size="sm" onClick={saveAddRec} disabled={editSaving}>{editSaving ? "저장 중…" : "추가"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
