"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, LogIn, LogOut, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

/* ── 타입 ── */
type Period = "daily" | "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";
type AttendanceRecord = {
  id: string; date: string; clockIn: string | null; clockOut: string | null;
  status: string; minutes: number;
};
type Stats = { total: number; normal: number; late: number; earlyLeave: number; absent: number; totalMinutes: number; avgMinutes: number };
type ChartItem = { date: string; hours: number; count?: number };
type StatsResponse = {
  period: Period; range: { start: string; end: string };
  current: Stats; previous: Stats;
  chartData: ChartItem[];
  records: AttendanceRecord[];
};
type Employee = { id: string; name: string; department: string | null };

/* ── 상수 ── */
const PERIODS: { value: Period; label: string }[] = [
  { value: "daily", label: "일간" },
  { value: "weekly", label: "주간" },
  { value: "monthly", label: "월간" },
  { value: "quarterly", label: "분기" },
  { value: "semiannual", label: "반기" },
  { value: "annual", label: "연간" },
];

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline"; bar: string }> = {
  NORMAL:      { label: "정상",     variant: "default",     bar: "#22c55e" },
  LATE:        { label: "지각",     variant: "destructive", bar: "#f97316" },
  EARLY_LEAVE: { label: "조기퇴근", variant: "secondary",   bar: "#a855f7" },
  ABSENT:      { label: "결근",     variant: "destructive", bar: "#ef4444" },
  HOLIDAY:     { label: "휴일",     variant: "outline",     bar: "#94a3b8" },
};

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

export default function AttendancePage() {
  /* 출퇴근 탭 */
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [clockLoading, setClockLoading] = useState(false);
  const [now, setNow] = useState(new Date());

  /* 통계 탭 */
  const [period, setPeriod] = useState<Period>("monthly");
  const [statsData, setStatsData] = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedUser, setSelectedUser] = useState("me");
  const [myRole, setMyRole] = useState("EMPLOYEE");

  /* ── 오늘 출퇴근 조회 ── */
  const fetchToday = useCallback(async () => {
    const res = await fetch(`/api/attendance?year=${new Date().getFullYear()}&month=${new Date().getMonth() + 1}`);
    const data = await res.json();
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const rec = data.records?.find((r: AttendanceRecord) => r.date?.startsWith(todayStr));
    setTodayRecord(rec || null);
  }, []);

  /* ── 기간별 통계 조회 ── */
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    const uid = selectedUser === "me" ? "" : `&userId=${selectedUser}`;
    const res = await fetch(`/api/attendance/stats?period=${period}${uid}`);
    const data = await res.json();
    setStatsData(data);
    setStatsLoading(false);
  }, [period, selectedUser]);

  useEffect(() => {
    fetchToday();
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [fetchToday]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => setMyRole(d.user?.role || "EMPLOYEE"));
    fetch("/api/employees").then(r => r.json()).then(d => setEmployees(d.employees || [])).catch(() => {});
  }, []);

  /* ── 출근/퇴근 ── */
  async function handleClock(type: "in" | "out") {
    setClockLoading(true);
    try {
      const res = await fetch(`/api/attendance/clock-${type}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      toast.success(type === "in" ? "출근이 등록되었습니다." : "퇴근이 등록되었습니다.");
      fetchToday();
    } finally { setClockLoading(false); }
  }

  /* ── 기간 레이블 ── */
  function periodLabel() {
    if (!statsData) return "";
    const s = new Date(statsData.range.start), e = new Date(statsData.range.end);
    switch (period) {
      case "daily":      return format(s, "yyyy년 MM월 dd일 (EEEE)", { locale: ko });
      case "weekly":     return `${format(s, "MM/dd")} ~ ${format(e, "MM/dd")} (주간)`;
      case "monthly":    return format(s, "yyyy년 MM월", { locale: ko });
      case "quarterly":  return `${format(s, "yyyy년")} ${Math.ceil((s.getMonth() + 1) / 3)}분기`;
      case "semiannual": return `${format(s, "yyyy년")} ${s.getMonth() < 6 ? "상반기" : "하반기"}`;
      case "annual":     return format(s, "yyyy년", { locale: ko });
    }
  }

  const c = statsData?.current;
  const p = statsData?.previous;

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
                  <p className="text-5xl font-mono font-bold text-gray-900">{format(now, "HH:mm:ss")}</p>
                  <p className="text-gray-500 mt-1 text-sm">{format(now, "yyyy년 MM월 dd일 (EEEE)", { locale: ko })}</p>
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
        </TabsContent>

        {/* ── 기간별 통계 탭 ── */}
        <TabsContent value="stats" className="space-y-4 mt-4">
          {/* 필터 */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-white border rounded-lg overflow-hidden shadow-sm">
              {PERIODS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setPeriod(value)}
                  className={`px-4 py-2 text-sm font-medium transition-colors
                    ${period === value ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {myRole !== "EMPLOYEE" && (
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger className="w-44 bg-white">
                  <SelectValue placeholder="직원 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="me">내 기록</SelectItem>
                  {employees.map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.name} ({e.department})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {statsData && (
              <span className="text-sm font-semibold text-gray-700 ml-1">{periodLabel()}</span>
            )}
          </div>

          {statsLoading ? (
            <div className="text-center py-16 text-gray-400">불러오는 중...</div>
          ) : c && (
            <>
              {/* 요약 카드 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "총 출근일",     val: `${c.total}일`,          prev: p?.total ?? 0,      curr: c.total,       unit: "일" },
                  { label: "누적 근무시간",  val: fmtMin(c.totalMinutes), prev: p?.totalMinutes ?? 0, curr: c.totalMinutes, unit: "분" },
                  { label: "평균 근무시간",  val: fmtMin(c.avgMinutes),   prev: p?.avgMinutes ?? 0,  curr: c.avgMinutes,  unit: "분" },
                  { label: "정상 출퇴근",   val: `${c.normal}회`,         prev: p?.normal ?? 0,      curr: c.normal,      unit: "회" },
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

              {/* 상태 분포 카드 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "지각",     val: c.late,      color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" },
                  { label: "조기퇴근", val: c.earlyLeave, color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-200" },
                  { label: "결근",     val: c.absent,    color: "text-red-600",    bg: "bg-red-50",    border: "border-red-200" },
                  { label: "출근율",   val: c.total > 0 ? `${Math.round((c.normal / c.total) * 100)}%` : "0%",
                    color: "text-green-600", bg: "bg-green-50", border: "border-green-200" },
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
                          formatter={(v: number) => [`${v}시간`, "근무시간"]}
                          labelStyle={{ fontWeight: 600 }}
                          contentStyle={{ borderRadius: 8, fontSize: 12 }}
                        />
                        <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={40}>
                          {statsData.chartData.map((_, i) => (
                            <Cell key={i} fill={_.hours >= 8 ? "#3b82f6" : _.hours >= 4 ? "#93c5fd" : "#e2e8f0"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="flex gap-4 justify-end mt-2">
                      {[{ color: "bg-blue-500", label: "8시간 이상" }, { color: "bg-blue-200", label: "4~8시간" }, { color: "bg-slate-200", label: "4시간 미만" }].map(({ color, label }) => (
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
                          <th className="pb-3 font-medium">출근</th>
                          <th className="pb-3 font-medium">퇴근</th>
                          <th className="pb-3 font-medium">근무시간</th>
                          <th className="pb-3 font-medium">상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statsData.records.length === 0 ? (
                          <tr><td colSpan={5} className="py-8 text-center text-gray-400">해당 기간에 기록이 없습니다.</td></tr>
                        ) : statsData.records.map(r => {
                          const s = STATUS_CONFIG[r.status] || { label: r.status, variant: "outline" as const };
                          return (
                            <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                              <td className="py-3">{format(new Date(r.date), "MM월 dd일 (EEE)", { locale: ko })}</td>
                              <td className="py-3">{r.clockIn ? format(new Date(r.clockIn), "HH:mm") : "-"}</td>
                              <td className="py-3">{r.clockOut ? format(new Date(r.clockOut), "HH:mm") : "-"}</td>
                              <td className="py-3 font-medium">{r.minutes > 0 ? fmtMin(r.minutes) : "-"}</td>
                              <td className="py-3"><Badge variant={s.variant}>{s.label}</Badge></td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {statsData.records.length > 0 && (
                        <tfoot>
                          <tr className="border-t bg-gray-50">
                            <td colSpan={3} className="py-2.5 px-0 text-xs font-semibold text-gray-600">합계</td>
                            <td className="py-2.5 text-xs font-semibold text-blue-700">{fmtMin(c.totalMinutes)}</td>
                            <td className="py-2.5 text-xs text-gray-500">{c.total}일 출근</td>
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
    </div>
  );
}
