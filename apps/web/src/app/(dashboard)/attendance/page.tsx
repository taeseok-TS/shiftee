"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  TrendingUp, TrendingDown, Minus,
  ChevronLeft, ChevronRight, RotateCcw,
} from "lucide-react";
import {
  format, startOfDay, isSameDay,
  addDays, addWeeks, addMonths, addYears,
  subDays, subWeeks, subMonths, subYears,
  startOfWeek, endOfWeek,
} from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import EditedMark from "@/components/attendance/EditedMark";
import { PageHead } from "@/components/kit";
import { TodayPanel, StatusHistory, FixDialog, RecordRequestDialog, kstYmd, type MyRecord, type MyDay } from "./MyAttendanceParts";
import type { AttendanceEditView } from "@/lib/attendance-edit";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

/* ── 타입 ── */
type Period = "daily" | "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";
type AttendanceRecord = {
  id: string; date: string; clockIn: string | null; clockOut: string | null;
  clockedIn?: boolean; clockedOut?: boolean; zeroMinutes?: boolean;   // 시각을 뺀 응답(■0-11)이면 찍었는지만
  status: string; minutes: number;
  userName?: string;   // 지점 전체 조회 때 누구 기록인지(서버가 보내 줌)
  edit?: AttendanceEditView | null;   // 수정 이력 요약(#219-15)
};
type Stats = {
  total: number; normal: number; late: number; earlyLeave: number; absent: number; totalMinutes: number; avgMinutes: number;
  // 출근율 정의(2026-10-16 #219-6): 출근한 날 ÷ 근무해야 할 날(근무일정 있는 날 + 일정 없이 출근한 날, 휴가 제외). 0분 기록은 「확인 필요」
  attendDays?: number; requiredDays?: number; missedDays?: number; missingDays?: number; needsCheck?: number; attendRate?: number | null;
};
type ChartItem = { date: string; hours: number; count?: number };
type StatsResponse = {
  period: Period; range: { start: string; end: string };
  current: Stats; previous: Stats;
  chartData: ChartItem[];
  records: AttendanceRecord[];
  timesHidden?: boolean;   // 직원 · 원장 — 시각 · 일한 시간 없이 상태만(■0-11)
};
type Employee = { id: string; name: string; department: string | null; branch?: string | null };

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
  /* 오늘 탭 — 지난 7일 상태 · 오늘 내 근무(■0-7 · ■0-11, 시안 S1-1) */
  const [recent, setRecent] = useState<MyRecord[]>([]);
  const [timesHidden, setTimesHidden] = useState(true);
  const [myDay, setMyDay] = useState<MyDay | null | undefined>(undefined);
  const [clockLoading, setClockLoading] = useState(false);
  const [fixTarget, setFixTarget] = useState<MyRecord | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [todayYmd] = useState(() => kstYmd());

  /* 통계 탭 */
  const [period, setPeriod]           = useState<Period>("monthly");
  const [baseDate, setBaseDate]       = useState(() => startOfDay(new Date()));
  const [statsData, setStatsData]     = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [employees, setEmployees]     = useState<Employee[]>([]);
  const [selectedUser, setSelectedUser] = useState("me");
  const [selectedBranch, setSelectedBranch] = useState(""); // "" = 지점별 조회 안 함
  const [myRole, setMyRole]           = useState("");   // "" = 아직 모름(역할을 알기 전엔 직원용 안내도 원장용 표도 그리지 않는다)
  const [selfView, setSelfView]       = useState<boolean | null>(null);   // 직원 본인 열람 허용(권한 설정 #39) — null = 아직 모름

  /* 날짜 직접 입력 (input[type=date] 용) */
  const [dateInput, setDateInput] = useState(format(new Date(), "yyyy-MM-dd"));

  /* ── 오늘 · 지난 7일 조회 — 이번 달(달 초면 지난달도). 직원 · 원장에게는 서버가 시각을 빼고 보낸다(■0-11) ── */
  const fetchToday = useCallback(async () => {
    const [y, m, d] = kstYmd().split("-").map(Number);
    const months = d < 8 ? [[m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1], [y, m]] : [[y, m]];
    const got = await Promise.all(months.map(([yy, mm]) => fetch(`/api/attendance?year=${yy}&month=${mm}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    const recs = got.flatMap((g) => (g?.records ?? []) as MyRecord[]).sort((a, b) => (a.date < b.date ? 1 : -1));
    setRecent(recs);
    setTimesHidden(got.some((g) => g?.timesHidden !== false));
    const day = await fetch(`/api/schedule/day?date=${kstYmd()}&scope=self`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setMyDay((day?.employees?.[0] as MyDay | undefined) ?? null);
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

  useEffect(() => { Promise.resolve().then(fetchToday); }, [fetchToday]);

  useEffect(() => { Promise.resolve().then(fetchStats); }, [fetchStats]);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => setMyRole(d.user?.role || "EMPLOYEE")).catch(() => setMyRole("EMPLOYEE"));
    fetch("/api/me/permissions").then(r => r.json()).then(d => setSelfView(d.permissions?.["employee.viewOwnAttendance"] === true)).catch(() => setSelfView(false));
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
          toast.error(data.error, { duration: 5000 });
        } else {
          toast.error(data.error);
        }
        return;
      }
      toast.success(type === "in" ? "출근이 등록되었습니다." : "퇴근이 등록되었습니다.");
      fetchToday();
    } finally { setClockLoading(false); }
  }

  const statsHidden = statsData?.timesHidden === true;
  return (
    <div className="space-y-6">
      <PageHead crumb="근태 › 내 출퇴근" title="내 출퇴근" />

      {/* 직원은 웹에서 본인 출퇴근 기록을 보지 않는다 — 시프티 설정 「직원 본인 출퇴근기록 열람 OFF」와 같게(2026-10-08 본부 답변 #3).
          출퇴근 찍기·오늘 상태·기록 수정 요청은 앱에서 한다. 원장(담당 지점)·본부 화면은 그대로 */}
      {myRole === "" || (myRole === "EMPLOYEE" && selfView === null) ? (
        <div className="py-10 text-center text-sm text-gray-400">불러오는 중…</div>
      ) : myRole === "EMPLOYEE" && !selfView ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-500 space-y-2">
            <p className="font-medium text-gray-700">출퇴근은 큐브티 앱에서 합니다.</p>
            <p>오늘 출근 · 퇴근 상태와 「출퇴근 기록 고치기 요청」은 앱 [출퇴근] 화면에 있습니다.</p>
            <p className="text-xs text-gray-400">월별 출퇴근 기록은 지점 원장·본부가 관리합니다.</p>
          </CardContent>
        </Card>
      ) : (
      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">오늘</TabsTrigger>
          <TabsTrigger value="stats">지난 기록</TabsTrigger>
        </TabsList>

        {/* ── 오늘 탭 — 오늘 내 근무 · 상태 · 지난 7일 · 아래 큰 출근 버튼(■0-7, 시안 S1-1) ── */}
        <TabsContent value="today" className="mt-4">
          <TodayPanel role={myRole} today={todayYmd} recent={recent} myDay={myDay} timesHidden={timesHidden}
            clockLoading={clockLoading} onClock={handleClock} onFix={setFixTarget} onRecordRequest={() => setRecordOpen(true)} />
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
                    ${period === value ? "bg-[#4f46e5] text-white" : "text-gray-600 hover:bg-gray-50"}`}
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
                  <SelectValue placeholder="개인별 조회">{selectedUser === "me" ? "내 기록" : employees.find(e => e.id === selectedUser)?.name ?? "개인별 조회"}</SelectValue>
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
                  <SelectValue placeholder="지점별 조회">{selectedBranch ? `${selectedBranch} 전체` : "지점별 조회 안 함"}</SelectValue>
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
              <span className="text-sm text-blue-600 font-medium">{selectedBranch} 지점 전체</span>
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

          {/* ── 통계 본문 — 직원 · 원장(시각 숨김)은 날짜별 상태만(■0-11) ── */}
          {statsLoading ? (
            <div className="text-center py-16 text-gray-400">불러오는 중...</div>
          ) : c && statsHidden ? (
            <StatusHistory records={statsData.records} today={todayYmd} showName={!!selectedBranch} mine={!selectedBranch && selectedUser === "me"}
              current={c} onFix={setFixTarget} />
          ) : c && (
            <>
              {/* 요약 카드 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  // 0분 기록(출근 = 퇴근)은 출근일에 넣지 않는다(#219-6) — 「확인 필요」로 따로 센다
                  { label: "총 출근일",    val: `${c.attendDays ?? c.total}일`, prev: p?.attendDays ?? p?.total ?? 0, curr: c.attendDays ?? c.total },
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
              {/* 출근율 = 출근한 날 ÷ 근무해야 할 날, 결근·누락 = 근로시간 리포트와 같은 판정(lib/attendance-day), 확인 필요 = 0분 기록 (#219-6·검증 F2) */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: "지각",     val: c.late,       color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" },
                  { label: "조기퇴근", val: c.earlyLeave,  color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-200" },
                  { label: "결근",     val: c.missedDays ?? c.absent, color: "text-red-600", bg: "bg-red-50", border: "border-red-200",
                    hint: `근무일정이 있는 지난 날에 기록 없음(휴가·공휴일·휴직 제외)${c.missingDays ? ` · 출근·퇴근 한쪽 누락 ${c.missingDays}일은 따로` : ""}` },
                  { label: "확인 필요", val: c.needsCheck ?? 0, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200",
                    hint: "출근과 퇴근이 같은 시각(0분) — 출근일에 넣지 않음" },
                  {
                    label: "출근율",
                    val: c.attendRate != null ? `${c.attendRate}%` : "-",
                    color: "text-green-600", bg: "bg-green-50", border: "border-green-200",
                    hint: c.requiredDays != null ? `출근 ${c.attendDays ?? 0}일 ÷ 근무해야 할 날 ${c.requiredDays}일` : undefined,
                  },
                ].map(({ label, val, color, bg, border, hint }) => (
                  <div key={label} className={`rounded-xl p-4 border ${bg} ${border}`} title={hint}>
                    <p className="text-xs font-medium text-gray-500">{label}</p>
                    <p className={`text-2xl font-bold mt-1 ${color}`}>{typeof val === "number" ? `${val}회` : val}</p>
                    {hint && <p className="text-[11px] text-gray-400 mt-1 leading-snug">{hint}</p>}
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
                  <CardTitle className="text-base">상세 기록</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-gray-500">
                          <th className="pb-3 font-medium">날짜</th>
                          {/* 지점 전체 조회면 이름 열 — 종전엔 누구 기록인지 알 수 없었다(2026-10-06 QA 조사) */}
                          {selectedBranch && <th className="pb-3 font-medium">이름</th>}
                          <th className="pb-3 font-medium">출근</th>
                          <th className="pb-3 font-medium">퇴근</th>
                          <th className="pb-3 font-medium">근무시간</th>
                          <th className="pb-3 font-medium">상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statsData.records.length === 0 ? (
                          <tr>
                            <td colSpan={selectedBranch ? 6 : 5} className="py-8 text-center text-gray-400">해당 기간에 기록이 없습니다.</td>
                          </tr>
                        ) : statsData.records.map(r => {
                          const s = STATUS_CONFIG[r.status] || { label: r.status, variant: "outline" as const };
                          return (
                            <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                              <td className="py-3">{format(new Date(r.date), "MM월 dd일 (EEE)", { locale: ko })}</td>
                              {selectedBranch && <td className="py-3 font-medium text-gray-800">{r.userName || "-"}</td>}
                              <td className="py-3">{r.clockIn ? format(new Date(r.clockIn), "HH:mm") : "-"}</td>
                              <td className="py-3">{r.clockOut ? format(new Date(r.clockOut), "HH:mm") : "-"}</td>
                              <td className="py-3 font-medium">{r.minutes > 0 ? fmtMin(r.minutes) : "-"}</td>
                              <td className="py-3">
                                <Badge variant={s.variant}>{s.label}</Badge>
                                {/* 0분 기록(출근 = 퇴근) — 출근일에 넣지 않고 따로 표시(#219-6) */}
                                {r.clockIn && r.clockOut && r.minutes === 0 && (
                                  <Badge variant="outline" className="ml-1 border-amber-300 text-amber-700">확인 필요</Badge>
                                )}
                                {/* 수정된 기록 — 원래 시각·사유·수정/승인자(#219-15) */}
                                <EditedMark edit={r.edit} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {statsData.records.length > 0 && (
                        <tfoot>
                          <tr className="border-t bg-gray-50">
                            <td colSpan={selectedBranch ? 4 : 3} className="py-2.5 px-0 text-xs font-semibold text-gray-600">합계</td>
                            <td className="py-2.5 text-xs font-semibold text-blue-700">{fmtMin(c.totalMinutes)}</td>
                            <td className="py-2.5 text-xs text-gray-500">{c.attendDays ?? c.total}일 출근{c.needsCheck ? ` · 확인 필요 ${c.needsCheck}` : ""}</td>
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
      )}
      <FixDialog target={fixTarget} onClose={() => setFixTarget(null)} onDone={() => { setFixTarget(null); fetchToday(); fetchStats(); }} />
      <RecordRequestDialog open={recordOpen} onClose={() => setRecordOpen(false)} />
    </div>
  );
}
