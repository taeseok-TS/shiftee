"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Clock, TrendingUp, TrendingDown, Minus, MapPin, AlertTriangle, Users,
  ChevronLeft, ChevronRight, RotateCcw, Download, Pencil, Plus,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import * as XLSX from "xlsx";
import EditedMark, { editExcelColumns } from "@/components/attendance/EditedMark";
import type { AttendanceEditView } from "@/lib/attendance-edit";
import AttendanceTabs, { isAttendanceTab, type AttendanceTab } from "@/components/attendance/AttendanceTabs";
import WeekendExportBox from "@/components/attendance/WeekendExportBox";
import MissingFixDialog, { type MissingAttendance } from "@/components/attendance/MissingFixDialog";
import { Btn, Box, Tiles, Tile, tableClass, Cell2, StatusPill, type PillTone } from "@/components/kit";
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
  clockInPlace?: string | null; clockOutPlace?: string | null;
  status: string; minutes: number; userName?: string; userBranch?: string | null;
  edit?: AttendanceEditView | null;   // 수정 이력 요약(#219-15) — 원래 시각·사유·수정/승인자
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
};
type Employee = { id: string; name: string; department: string | null; branch?: string | null };
// 장소 칸 — 지점 밖·사진·본부 처리·수정처럼 결재로 남은 기록은 눈에 띄게(2026-10-07 #36)
const placeCls = (p?: string | null) => (p && /지점 밖|사진|본부|수정/.test(p) ? "text-amber-700 font-medium" : "text-gray-500");
type TodayAttendee = {
  id: string; userId: string; name: string; branch: string | null;
  jobGroup: string | null; position: string | null;
  status: string; clockIn: string | null; clockOut: string | null; minutes: number;
  clockInPlace?: string | null; clockOutPlace?: string | null;
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
  if (diff > 0) return <span className="text-xs text-[#1d4ed8] flex items-center gap-0.5"><TrendingUp size={11} />+{pct}%</span>;
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
  /* 알약 탭(R10) — ?tab=stats|weekend 로 들어오면 그 탭 */
  const [tab, setTab] = useState<AttendanceTab>("today");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    Promise.resolve().then(() => { if (isAttendanceTab(t)) setTab(t); });
  }, []);

  /* 오늘 — 숫자 칸 6 · 지점별 현황 · 확인 필요(대시보드와 같은 숫자: /api/admin/dashboard-stats) */
  type BranchRow = { branch: string; scheduled: number; present: number; late: number; absent: number; onLeave: number };
  // 숫자 칸을 누르면 보이는 명단(2026-10-26 디렉터 — 실사용 첫날 「미출근 16명이 누구냐」). 숫자와 같은 집합에서 route 가 만들어 보낸다
  type PeopleKey = "present" | "late" | "absent" | "earlyLeave" | "onLeave" | "scheduled";
  type Person = { id: string; name: string; branch: string; position?: string; phone?: string; startTime?: string; clockIn?: string; clockOut?: string; status?: string; leaveType?: string };
  type DashStats = {
    attendance?: { present: number; late: number; absent: number; earlyLeave: number; onLeave: number; scheduled?: number };
    byBranch?: BranchRow[]; people?: Partial<Record<PeopleKey, Person[]>>; missingAttendance?: MissingAttendance[];
  };
  type PendingReq = { id: string; userName?: string; userBranch?: string | null; kindLabel?: string; workDate?: string; status?: string };
  const [dash, setDash] = useState<DashStats | null>(null);
  // 열린 명단 — 칸(key) + 지점(지점별 표에서 눌렀을 때만). 같은 곳을 다시 누르면 닫힌다
  const [pick, setPick] = useState<{ key: PeopleKey; branch?: string } | null>(null);
  const togglePick = (key: PeopleKey, branch?: string) =>
    setPick((cur) => (cur && cur.key === key && (cur.branch ?? "") === (branch ?? "") ? null : { key, branch }));
  const [pendingReqs, setPendingReqs] = useState<PendingReq[]>([]);
  const [branchPick, setBranchPick] = useState("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [fixTarget, setFixTarget] = useState<MissingAttendance | null>(null);

  /* 통계 탭 */
  const [period, setPeriod]           = useState<Period>("monthly");
  const [baseDate, setBaseDate]       = useState(() => startOfDay(new Date()));
  const [statsData, setStatsData]     = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [employees, setEmployees]     = useState<Employee[]>([]);
  const [selectedUser, setSelectedUser] = useState("me");
  const [selectedBranch, setSelectedBranch] = useState(""); // "" = 지점별 조회 안 함
  const [myRole, setMyRole]           = useState("EMPLOYEE");

  // 전일 미마감 근태 (2026-09-07 디렉터 지시)
  // 근무가 상한(10.5시간)을 넘으면 직원은 앱에서 퇴근을 못 찍는다. 종전에는 그걸로 끝이라
  // 기록이 영원히 열린 채 남았다(실제로 14건이 최장 80일). 관리자가 여기서 마감한다.
  // 마감 시각 = 설정 › 근태 규칙(기본 22:00, 2026-10-20) — 대시보드 누락 보정·앱 본인 동의와 같은 기준(lib/attendance-policy autoCloseTime)
  type Unclosed = { id: string; date: string; name: string; branch: string | null; clockIn: string; willClockOut: string; basisLabel?: string; pendingRequest?: boolean };
  const [unclosed, setUnclosed] = useState<Unclosed[]>([]);
  const [capHours, setCapHours] = useState(10.5);
  const [fallbackHours, setFallbackHours] = useState(9);
  const [unclosedOpen, setUnclosedOpen] = useState(false);
  const loadUnclosed = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/attendance/unclosed");
      if (!res.ok) return;               // 관리자가 아니면 403 — 조용히 넘어간다
      const d = await res.json();
      setUnclosed(d.records || []);
      if (d.capHours) setCapHours(d.capHours);
      if (d.fallbackHours) setFallbackHours(d.fallbackHours);
    } catch { /* 목록을 못 불러와도 화면이 죽으면 안 된다 */ }
  }, []);
  useEffect(() => { if (myRole === "ADMIN") loadUnclosed(); }, [myRole, loadUnclosed]);
  // 미마감 한 건 → 보정 창(누락 보정과 같은 창 — 퇴근 시각은 근태 규칙 기준값으로 미리 채우기만, 저장은 사람이)
  const fixUnclosed = (r: Unclosed) => setFixTarget({
    id: r.id, name: r.name, branch: r.branch, date: r.date, type: "퇴근 누락", mode: "out",
    fillAt: r.willClockOut, fillLabel: r.basisLabel ?? null, pendingRequest: r.pendingRequest,
  });

  /* 오늘 출퇴근한 직원 목록 (관리자/원장) */
  const [todayList, setTodayList] = useState<TodayAttendee[]>([]);

  /* 날짜 직접 입력 (input[type=date] 용) */
  const [dateInput, setDateInput] = useState(format(new Date(), "yyyy-MM-dd"));

  /* ── 출퇴근 기록 수동 수정/생성 (관리자 전용) ── */
  const [editRec, setEditRec] = useState<AttendanceRecord | null>(null);
  const [editIn, setEditIn] = useState("");   // "HH:mm" (비우면 삭제)
  const [editOut, setEditOut] = useState("");
  const [editReason, setEditReason] = useState("");   // 수정 사유 — 수정 이력에 원래 시각과 함께 남는다(#219-15)
  const [addOpen, setAddOpen] = useState(false);
  // 여러 명을 같은 시각으로 한꺼번에(#215-5). 저장 전 미리보기로 이미 기록이 있는 사람을 표시한다
  const [addForm, setAddForm] = useState({ userIds: [] as string[], date: format(new Date(), "yyyy-MM-dd"), clockIn: "", clockOut: "", reason: "" });
  const [addSearch, setAddSearch] = useState("");
  const [addExists, setAddExists] = useState<{ date: string; map: Record<string, boolean> }>({ date: "", map: {} });   // 미리보기 결과(날짜별) — userId → 그 날 기록 있음
  const existsOn = (id: string) => addExists.date === addForm.date && !!addExists.map[id];
  const [editSaving, setEditSaving] = useState(false);
  useEffect(() => {
    if (!addOpen || !addForm.userIds.length || !/^\d{4}-\d{2}-\d{2}$/.test(addForm.date)) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch("/api/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
        body: JSON.stringify({ userIds: addForm.userIds, date: addForm.date, preview: true }) })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.preview) setAddExists({ date: addForm.date, map: Object.fromEntries((d.preview as { userId: string; exists: boolean }[]).map(p => [p.userId, p.exists])) }); })
        .catch(() => {});
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [addOpen, addForm.userIds, addForm.date]);

  function openEditRec(r: AttendanceRecord) {
    setEditIn(r.clockIn ? format(new Date(r.clockIn), "HH:mm") : "");
    setEditOut(r.clockOut ? format(new Date(r.clockOut), "HH:mm") : "");
    setEditReason("");
    setEditRec(r);
  }

  // "HH:mm" + 기록 날짜 → KST 오프셋 포함 ISO (타임존 어긋남 방지). 비우면 null(삭제)
  const toKstIso = (dateYmd: string, time: string) => (time ? `${dateYmd}T${time}:00+09:00` : null);
  const nextYmd = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);

  async function saveEditRec() {
    if (!editRec) return;
    // 근로감독 때 「고친 이유」를 보여 줄 수 있게 사유를 꼭 받는다(#219-15)
    if (!editReason.trim()) { toast.error("수정 사유를 입력해주세요."); return; }
    setEditSaving(true);
    try {
      const dateYmd = editRec.date.slice(0, 10);
      const res = await fetch(`/api/attendance/${editRec.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        // 퇴근이 출근보다 이른 시각이면 자정을 넘긴 퇴근 — 다음 날로 보낸다(검증 참고: 출근만 고쳐도 400 이 나던 것)
        body: JSON.stringify({ clockIn: toKstIso(dateYmd, editIn), clockOut: toKstIso(editIn && editOut && editOut < editIn ? nextYmd(dateYmd) : dateYmd, editOut), reason: editReason.trim() }),
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
    if (!addForm.userIds.length) { toast.error("직원을 선택해주세요."); return; }
    if (addForm.userIds.length > 200) { toast.error("한 번에 200명까지 넣을 수 있습니다."); return; }
    if (!addForm.clockIn && !addForm.clockOut) { toast.error("출근 또는 퇴근 시각을 입력해주세요."); return; }
    const dup = addForm.userIds.filter(existsOn);
    if (dup.length && dup.length === addForm.userIds.length) { toast.error("선택한 직원 모두 그 날 기록이 이미 있습니다. 수정 기능을 사용해주세요."); return; }
    if (dup.length && !confirm(`이미 기록이 있는 ${dup.length}명은 건너뛰고 ${addForm.userIds.length - dup.length}명만 추가합니다. 계속할까요?`)) return;
    setEditSaving(true);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: addForm.userIds, date: addForm.date,
          clockIn: toKstIso(addForm.date, addForm.clockIn), clockOut: toKstIso(addForm.date, addForm.clockOut),
          reason: addForm.reason.trim(),
        }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || "생성 실패"); return; }
      toast.success(`출퇴근 기록 ${d.created ?? 1}명 추가${d.skipped?.length ? ` · 건너뜀 ${d.skipped.length}명(${d.skipped.join(", ")})` : ""}`);
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
      // 수정된 기록 — 수정 여부·원래 출근·원래 퇴근·수정 사유·수정·승인자(#219-15)
      ...editExcelColumns(r.edit),
    }));
    rows.push({
      날짜: "합계", 요일: "", 이름: empFilter === "all" ? "" : empFilter, 지점: "",
      출근: "", 퇴근: "",
      "근무시간(분)": visibleTotals.minutes,
      근무시간: fmtMin(visibleTotals.minutes),
      상태: `${visibleTotals.days}일 출근`,
      ...editExcelColumns(null),
    } as (typeof rows)[number]);
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 5 }, { wch: 10 }, { wch: 12 }, { wch: 7 }, { wch: 7 }, { wch: 11 }, { wch: 11 }, { wch: 10 },
      { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 30 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "출퇴근");
    XLSX.writeFile(wb, `출퇴근_${scopeLabel}_${rangeLabel}.xlsx`);
  }

  /* ── 오늘 숫자 · 지점별 · 확인 필요 ── */
  const fetchDash = useCallback(async () => {
    const [d, r] = await Promise.all([
      fetch("/api/admin/dashboard-stats", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      fetch("/api/attendance-requests?scope=inbox", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ]);
    if (d) { setDash(d); setLoadedAt(new Date()); } else toast.error("오늘 근태를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.");
    if (r) setPendingReqs(((r.requests || []) as PendingReq[]).filter((x) => !x.status || x.status === "PENDING"));
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
    fetchDash();
    fetchTodayList();
    // 5분마다 새로(대시보드와 같은 주기)
    const timer = setInterval(() => { fetchDash(); fetchTodayList(); }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [fetchDash, fetchTodayList]);

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

  // 머리 「엑셀」 — 오늘 출근한 직원 목록
  function exportToday() {
    if (!todayList.length) { toast.error("오늘 출근 기록이 없습니다."); return; }
    const rows = todayList.map((r) => ({
      이름: r.name, 지점: r.branch ?? "", 직무: r.jobGroup || r.position || "",
      출근: r.clockIn ? format(new Date(r.clockIn), "HH:mm") : "", 출근장소: r.clockInPlace ?? "",
      퇴근: r.clockOut ? format(new Date(r.clockOut), "HH:mm") : "", 퇴근장소: r.clockOut ? r.clockOutPlace ?? "" : "",
      상태: STATUS_CONFIG[r.status]?.label ?? r.status, "근무시간(분)": r.minutes || 0,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "오늘 출퇴근");
    XLSX.writeFile(wb, `출퇴근_오늘_${format(new Date(), "yyyyMMdd")}.xlsx`);
  }

  const a = dash?.attendance;
  // 오늘 일정이 하나도 안 들어 있는 날(이관 공백 · 아직 안 넣음) — 「출근 2명 · 일정 0명」이 왜 그런지 칸 아래에 이유를(2026-10-23 오픈 전 요청 ■3)
  const noSchedule = !!a && (a.scheduled ?? 0) === 0;
  const branchRows = (dash?.byBranch || []).filter((b) => !branchPick || b.branch === branchPick);
  // 확인 필요 — 최근 7일 누락(요청이 결재 대기인 날은 결재함 쪽으로만) · 오늘 지각 · 결재 대기 출퇴근 요청
  const checkRows = [
    ...(dash?.missingAttendance || []).filter((m) => !m.pendingRequest).map((m) => ({
      key: `miss-${m.id}`, title: `${m.name}${m.branch ? ` · ${m.branch}` : ""} · ${format(new Date(m.date), "M/d")} ${m.type}`,
      sub: "누르면 시각을 넣는 보정 창", red: true, onOpen: () => setFixTarget(m), href: undefined as string | undefined,
    })),
    ...todayList.filter((r) => r.status === "LATE").map((r) => ({
      key: `late-${r.id}`, title: `${r.name}${r.branch ? ` · ${r.branch}` : ""} · 오늘 지각`,
      sub: `출근 ${r.clockIn ? format(new Date(r.clockIn), "HH:mm") : "-"}`, red: false, onOpen: undefined as (() => void) | undefined, href: "/admin/attendance-board",
    })),
    ...pendingReqs.map((r) => ({
      key: `req-${r.id}`, title: `${r.userName ?? ""}${r.userBranch ? ` · ${r.userBranch}` : ""} · ${r.workDate ? format(new Date(`${r.workDate.slice(0, 10)}T00:00:00`), "M/d") : ""} ${r.kindLabel ?? "출퇴근 요청"}`,
      sub: "결재 대기 · 결재함에서 처리", red: false, onOpen: undefined as (() => void) | undefined, href: "/admin/leave-approvals?tab=attendance",
    })),
  ];
  const statusTone = (st: string): PillTone => (st === "NORMAL" ? "done" : st === "LATE" || st === "EARLY_LEAVE" ? "wait" : st === "ABSENT" ? "rej" : "gray");

  // 명단 상자 — 고른 칸(+지점)의 사람들을 지점별로 묶는다. 숫자 칸 값과 같은 배열(route people)이라 길이가 숫자와 같다
  const PEOPLE_LABEL: Record<PeopleKey, string> = { present: "출근", late: "지각", absent: "미출근", earlyLeave: "조퇴", onLeave: "휴가", scheduled: "오늘 일정 있는 직원" };
  const pickedAll = pick ? (dash?.people?.[pick.key] ?? []) : [];
  const picked = pick?.branch ? pickedAll.filter((x) => x.branch === pick.branch) : pickedAll;
  const pickedGroups = (() => {
    const m = new Map<string, Person[]>();
    for (const x of picked) m.set(x.branch, [...(m.get(x.branch) ?? []), x]);
    return [...m.entries()];   // route 가 지점 › 일정 시각 › 이름 순으로 정렬해 보내므로 묶음 순서도 지점 가나다
  })();
  // 줄 둘째 칸 — 칸마다 보여 줄 것. 출근 칸은 「출근 12:54」(지각이면 「지각 · 13:07」), 휴가 칸은 유형, 미출근은 「일정 있는데 출근 전」
  const personDetail = (key: PeopleKey, x: Person): string => {
    const sched = x.startTime ? `일정 ${x.startTime}` : "";
    const came = x.clockIn ? (x.status === "LATE" ? `지각 · ${x.clockIn}` : `출근 ${x.clockIn}`) : "";
    switch (key) {
      case "absent": return [sched, "일정 있는데 출근 전"].filter(Boolean).join(" · ");
      case "onLeave": return [x.leaveType ?? "휴가", sched].filter(Boolean).join(" · ");
      case "earlyLeave": return [sched, `조퇴${x.clockOut ? ` · 퇴근 ${x.clockOut}` : ""}`].filter(Boolean).join(" · ");
      case "scheduled": return [sched, came || (x.leaveType ? x.leaveType : "출근 전")].filter(Boolean).join(" · ");
      default: return [sched, came].filter(Boolean).join(" · ");
    }
  };
  // 지점별 표의 숫자 — 0 은 글자만, 1 이상은 누르면 그 지점 · 그 상태 명단(44px 누름 자리, 글자 링크처럼)
  const cellBtn = (b: BranchRow, key: PeopleKey, n: number, red = false) => {
    const color = red && n > 0 ? "font-bold text-[#dc2626]" : n > 0 ? "font-semibold text-[#4f46e5]" : "";
    if (n <= 0) return <span className={`tabular-nums ${color}`}>{n}</span>;
    const on = !!pick && pick.key === key && pick.branch === b.branch;
    return (
      <button type="button" onClick={() => togglePick(key, b.branch)} aria-pressed={on} title={`${b.branch} ${PEOPLE_LABEL[key]} ${n}명 보기`}
        className={`-my-3 -mr-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-end rounded-lg px-2 tabular-nums underline-offset-[3px] hover:underline ${color} ${on ? "bg-[#eef2ff] underline" : ""}`}>
        {n}
      </button>
    );
  };

  return (
    <div>
      {/* 머리 + 알약 탭 한 줄(R10) — 옛 「출퇴근 관리」 · 큰 시계 · 내 출근/퇴근 버튼(관리 화면엔 본인 출퇴근을 두지 않는다, 본부 본인 출퇴근은 직원 모드) */}
      <AttendanceTabs active={tab} onSelect={(t) => { setTab(t); try { window.history.replaceState(null, "", t === "today" ? "/admin/attendance" : `/admin/attendance?tab=${t}`); } catch { /* 주소만 못 바꿔도 탭은 바뀐다 */ } }} note={tab === "today" && loadedAt ? `${format(loadedAt, "M월 d일 (EEE) HH:mm", { locale: ko })} 기준` : undefined}>
        {tab === "today" && <Btn onClick={exportToday}><Download size={14} />엑셀</Btn>}
      </AttendanceTabs>

      <Tabs value={tab} onValueChange={(v) => setTab(v as AttendanceTab)}>
        {/* ── 오늘 ── */}
        <TabsContent value="today">
          {/* 오늘 근태 — 대시보드와 같은 6칸(R9·R10). 미출근 · 지각 · 조퇴만 1 이상 빨강 */}
          <Box icon={<Clock />} title="오늘 근태" sub="근무일정이 있는 직원 기준">
            {/* 칸을 누르면 바로 아래 「명단」 상자가 열린다(2026-10-26). 0 명이면 누를 것이 없어 그대로 둔다 */}
            <Tiles cols={6}>
              {([
                { key: "present", label: "출근", value: a?.present },
                { key: "late", label: "지각", value: a?.late, alert: true },
                { key: "absent", label: "미출근", value: a?.absent, alert: true, note: noSchedule ? "일정이 없어 셀 수 없음" : "일정 있는데 출근 전" },
                { key: "earlyLeave", label: "조퇴", value: a?.earlyLeave, alert: true },
                { key: "onLeave", label: "휴가", value: a?.onLeave },
                { key: "scheduled", label: "오늘 일정 있는 직원", value: a?.scheduled, hl: true,
                  note: noSchedule && (a?.present ?? 0) + (a?.late ?? 0) > 0 ? "오늘 일정이 들어 있지 않음 — 일정 없이 출근한 사람만 셈" : "관리자 제외" },
              ] as { key: PeopleKey; label: string; value: number | undefined; alert?: boolean; hl?: boolean; note?: string }[]).map((t) => (
                <Tile key={t.key} label={t.label} value={t.value} unit="명" alert={t.alert} hl={t.hl} note={t.note}
                  active={!!pick && pick.key === t.key && !pick.branch && (t.value ?? 0) > 0}
                  onClick={(t.value ?? 0) > 0 ? () => togglePick(t.key) : undefined} />
              ))}
            </Tiles>
          </Box>

          {/* 명단 — 누른 칸(또는 지점별 표의 숫자)의 사람들. 지점별 묶음, 폰에서는 이름 굵게 + 둘째 줄 */}
          {pick && (
            <Box icon={<Users />} tone={pick.key === "absent" || pick.key === "late" || pick.key === "earlyLeave" ? "rose" : "ind"}
              title={`${pick.branch ? `${pick.branch} · ` : ""}${PEOPLE_LABEL[pick.key]} ${picked.length}명`}
              sub={pick.key === "absent" ? "오늘 근무일정이 있는데 출근 기록이 없는 사람(휴가 · 출근 요청 대기 중 제외)" : pick.key === "onLeave" ? "오늘 걸친 승인 휴가" : undefined}
              right={<Btn kind="text" onClick={() => setPick(null)}>닫기</Btn>}>
              {!picked.length ? (
                <p className="px-6 py-6 text-[14px] text-[#596578]">해당하는 직원이 없습니다</p>
              ) : pickedGroups.map(([branch, rows]) => (
                <div key={branch} className="border-t border-[#eef1f5] first:border-t-0">
                  <div className="flex items-baseline gap-2 bg-[#fafbfd] px-6 py-2 text-[13px] font-semibold text-[#596578]">
                    <span className="text-[#0f172a]">{branch}</span><span className="tabular-nums">{rows.length}</span>
                  </div>
                  <ul className="px-6">
                    {rows.map((x) => (
                      <li key={x.id} className="flex flex-col gap-0.5 border-t border-[#f1f5f9] py-3 first:border-t-0 md:flex-row md:items-center md:gap-3">
                        <span className="min-w-0 md:w-[220px] md:shrink-0">
                          <b className="text-[15px] font-bold text-[#0f172a]">{x.name}</b>
                          {x.position && <span className="ml-1.5 text-[12.5px] text-[#596578]">{x.position}</span>}
                        </span>
                        <span className={`min-w-0 flex-1 text-[13.5px] ${pick.key === "absent" ? "text-[#dc2626]" : "text-[#475569]"}`}>{personDetail(pick.key, x)}</span>
                        {/* 미출근 줄 — 전화번호가 있으면 바로 걸 수 있게(흰 작은 버튼). 번호 없으면 생략 */}
                        {pick.key === "absent" && x.phone && x.phone.replace(/[^0-9+]/g, "") && (
                          <a href={`tel:${x.phone.replace(/[^\d+]/g, "")}`} className="mt-1 inline-flex w-fit items-center rounded-[10px] border border-[#e2e8f0] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#334155] hover:bg-[#f8fafc] md:mt-0 md:ml-auto">전화</a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Box>
          )}

          <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            {/* 지점별 현황(본부 10/22 — 「지점별 오늘」 대신) */}
            <Box icon={<MapPin />} tone="sky" title="지점별 현황" className="!mb-0 min-w-0"
              right={<select value={branchPick} onChange={(e) => setBranchPick(e.target.value)} aria-label="지점" className="rounded-[10px] border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[13px] font-medium text-[#334155]">
                <option value="">지점: 전체</option>
                {(dash?.byBranch || []).map((b) => <option key={b.branch} value={b.branch}>{b.branch}</option>)}
              </select>}>
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead><tr><th>지점</th><th className="text-right">일정</th><th className="text-right">출근</th><th className="text-right">지각</th><th className="text-right">미출근</th><th className="text-right">휴가</th></tr></thead>
                  <tbody>
                    {!dash ? (
                      <tr><td colSpan={6} className="text-center text-[#596578]">불러오는 중…</td></tr>
                    ) : !branchRows.length ? (
                      <tr><td colSpan={6} className="text-center text-[#596578]">직원이 없습니다</td></tr>
                    ) : branchRows.map((b) => (
                      <tr key={b.branch}>
                        <td className="font-bold text-[#0f172a]">{b.branch}</td>
                        {/* 숫자를 누르면 위 「명단」 상자가 그 지점 · 그 상태로 열린다(2026-10-26). 0 은 누를 수 없다 */}
                        <td className="text-right">{cellBtn(b, "scheduled", b.scheduled)}</td>
                        <td className="text-right">{cellBtn(b, "present", b.present)}</td>
                        <td className="text-right">{cellBtn(b, "late", b.late, true)}</td>
                        <td className="text-right">{cellBtn(b, "absent", b.absent, true)}</td>
                        <td className="text-right">{cellBtn(b, "onLeave", b.onLeave)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Box>

            {/* 확인 필요(본부 10/22 — 「처리할 것」 대신) — 누락 · 지각 · 수정 요청 줄 */}
            <Box icon={<AlertTriangle />} tone="rose" title="확인 필요" count={checkRows.length} className="!mb-0 min-w-0">
              <div className="px-6 py-1">
                {!dash ? (
                  <p className="py-5 text-[14px] text-[#596578]">불러오는 중…</p>
                ) : !checkRows.length ? (
                  <p className="py-5 text-[14px] text-[#596578]">최근 7일 출퇴근 누락 없음<span className="mt-0.5 block text-[12.5px]">누락 · 지각 · 수정 요청이 생기면 여기에 사람 · 날짜가 줄로 나옵니다</span></p>
                ) : checkRows.map((r) => {
                  const body = (
                    <>
                      <span className="min-w-0 flex-1">
                        <b className={`block truncate text-[15px] font-bold ${r.red ? "text-[#dc2626]" : "text-[#0f172a]"}`}>{r.title}</b>
                        <span className="block truncate text-[13px] text-[#596578]">{r.sub}</span>
                      </span>
                      <span className="shrink-0 text-[14px] font-semibold text-[#4f46e5]">열기 ›</span>
                    </>
                  );
                  const cls = "flex w-full items-center gap-3 border-t border-[#f1f5f9] py-3.5 text-left first:border-t-0";
                  return r.onOpen
                    ? <button key={r.key} type="button" onClick={r.onOpen} className={cls}>{body}</button>
                    : <a key={r.key} href={r.href} className={cls}>{body}</a>;
                })}
              </div>
            </Box>
          </div>

          {/* 전일 미마감 — 상한을 넘겨 직원이 퇴근을 못 찍은 기록. 관리자가 확인해 마감한다(2026-09-07) */}
          {myRole === "ADMIN" && unclosed.length > 0 && (
            <Box icon={<AlertTriangle />} tone="amb" title="전일 미마감" count={unclosed.length} className="mt-[18px]"
              sub="어제 이전에 출근만 있고 퇴근이 없는 기록"
              right={<>
                {/* 「○건 확인」 = 목록 열기(본부 10/23 — 한꺼번에 넣는 버튼은 뺐다. 줄마다 「보정」으로 한 건씩) */}
                <Btn kind="primary" className="px-3.5 py-1.5" onClick={() => setUnclosedOpen(v => !v)}>{unclosedOpen ? "접기" : `${unclosed.length}건 확인`}</Btn>
              </>}>
              <p className="px-6 py-3 text-[13px] text-[#596578]">
                줄마다 「보정」을 누르면 보정 창이 열립니다. 퇴근 시각은 <b>설정 › 근태 규칙</b> 기준값(「기준」 칸, 보정 시간 {fallbackHours}시간 · 상한 {capHours}시간)으로 미리 채워 두기만 하고,
                실제 시각과 사유를 넣어 저장합니다. 저장하면 수정 이력과 변경 로그에 고친 사람 · 시각 · 값이 남습니다.
              </p>
              {unclosedOpen && (
                <div className="overflow-x-auto border-t border-[#eef1f5]">
                  <table className={tableClass}>
                    <thead><tr><th>날짜</th><th>직원</th><th>출근</th><th>기준 퇴근(미리 채울 값)</th><th>기준</th><th className="text-right">처리</th></tr></thead>
                    <tbody>
                      {unclosed.map(r => (
                        <tr key={r.id}>
                          <td className="whitespace-nowrap">{r.date}</td>
                          <td className="whitespace-nowrap"><Cell2 main={r.name} sub={r.branch ?? undefined} /></td>
                          <td className="whitespace-nowrap tabular-nums">{format(new Date(r.clockIn), "HH:mm")}</td>
                          <td className="whitespace-nowrap tabular-nums text-[#b45309]">{format(new Date(r.willClockOut), "MM/dd HH:mm")}</td>
                          <td className="text-[12.5px] text-[#596578]">{r.basisLabel ?? "-"}</td>
                          <td className="text-right">
                            {r.pendingRequest
                              ? <span className="whitespace-nowrap text-[12.5px] font-semibold text-[#b45309]" title="직원이 올린 퇴근 처리·수정 요청을 결재하면 그 시각으로 기록됩니다">요청 결재 대기</span>
                              : <Btn kind="text" onClick={() => fixUnclosed(r)}>보정</Btn>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Box>
          )}

          {/* 오늘 출근한 직원 */}
          <Box icon={<Users />} tone="ind" title="오늘 출근한 직원" sub={`${todayList.length}명`} className="mt-[18px]">
            {todayList.length === 0 ? (
              <p className="px-6 py-10 text-center text-[14px] text-[#596578]">아직 오늘 출근한 직원이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead><tr><th>직원</th><th>출근</th><th>출근 장소</th><th>퇴근</th><th>퇴근 장소</th><th>상태</th><th className="text-right">근무시간</th></tr></thead>
                  <tbody>
                    {todayList.map((r) => (
                      <tr key={r.id}>
                        <td><Cell2 main={r.name} sub={[r.branch, r.jobGroup || r.position].filter(Boolean).join(" · ") || undefined} /></td>
                        <td className="tabular-nums">{r.clockIn ? format(new Date(r.clockIn), "HH:mm") : "-"}</td>
                        <td className={`text-[12.5px] ${placeCls(r.clockInPlace)}`}>{r.clockInPlace || "-"}</td>
                        <td className="tabular-nums">{r.clockOut ? format(new Date(r.clockOut), "HH:mm") : <span className="text-[#596578]">근무 중</span>}</td>
                        <td className={`text-[12.5px] ${placeCls(r.clockOutPlace)}`}>{r.clockOut ? r.clockOutPlace || "-" : ""}</td>
                        <td><StatusPill tone={statusTone(r.status)}>{STATUS_CONFIG[r.status]?.label ?? r.status}</StatusPill></td>
                        <td className="text-right tabular-nums">{r.minutes > 0 ? fmtMin(r.minutes) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Box>
        </TabsContent>

        {/* ── 주말 근무 엑셀(R10 알약 탭) ── */}
        <TabsContent value="weekend">
          <WeekendExportBox />
        </TabsContent>

        {/* ── 기간별 통계 탭 ── */}
        <TabsContent value="stats" className="space-y-4">

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
              <span className="text-sm text-[#4f46e5] font-medium">{selectedBranch} 지점 전체 통계</span>
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
                    color: "text-[#1d4ed8]", bg: "bg-[#eff6ff]", border: "border-[#bfdbfe]",
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
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">상세 기록</CardTitle>
                    <div className="flex gap-2">
                      {myRole === "ADMIN" && (
                        <Button variant="outline" size="sm" className="gap-1"
                          onClick={() => { setAddForm({ userIds: [], date: format(new Date(), "yyyy-MM-dd"), clockIn: "", clockOut: "", reason: "" }); setAddSearch(""); setAddOpen(true); }}>
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
                        className={`text-xs rounded-full px-3 py-1 border ${empFilter === "all" ? "bg-[#4f46e5] text-white border-[#4f46e5]" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                        전체 {recordNames.length}명
                      </button>
                      {recordNames.map((n) => (
                        <button key={n} onClick={() => setEmpFilter(n)}
                          className={`text-xs rounded-full px-3 py-1 border ${empFilter === n ? "bg-[#4f46e5] text-white border-[#4f46e5]" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
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
                          <th className="pb-3 font-medium">출근 장소</th>
                          <th className="pb-3 font-medium">퇴근</th>
                          <th className="pb-3 font-medium">퇴근 장소</th>
                          <th className="pb-3 font-medium">근무시간</th>
                          <th className="pb-3 font-medium">상태</th>
                          {myRole === "ADMIN" && <th className="pb-3 font-medium text-right">수정</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRecords.length === 0 ? (
                          <tr>
                            <td colSpan={multiPerson ? 9 : 8} className="py-8 text-center text-gray-400">해당 기간에 기록이 없습니다.</td>
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
                              <td className={`py-3 text-xs ${placeCls(r.clockInPlace)}`}>{r.clockInPlace || "-"}</td>
                              <td className="py-3">{r.clockOut ? format(new Date(r.clockOut), "HH:mm") : "-"}</td>
                              <td className={`py-3 text-xs ${placeCls(r.clockOutPlace)}`}>{r.clockOutPlace || "-"}</td>
                              <td className="py-3 font-medium">{r.minutes > 0 ? fmtMin(r.minutes) : "-"}</td>
                              <td className="py-3">
                                <StatusPill tone={statusTone(r.status)}>{s.label}</StatusPill>
                                {/* 0분 기록(출근 = 퇴근) — 출근일에 넣지 않고 따로 표시(#219-6) */}
                                {r.clockIn && r.clockOut && r.minutes === 0 && (
                                  <Badge variant="outline" className="ml-1 border-amber-300 text-amber-700">확인 필요</Badge>
                                )}
                                {/* 수정된 기록 — 원래 시각·사유·수정/승인자(#219-15) */}
                                <EditedMark edit={r.edit} />
                              </td>
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
                            <td colSpan={multiPerson ? 6 : 5} className="py-2.5 px-0 text-xs font-semibold text-gray-600">
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

      {/* 출퇴근 누락 보정 — 사람이 시각·사유를 넣고 저장(대시보드와 같은 부품, components/attendance/MissingFixDialog) */}
      <MissingFixDialog key={fixTarget?.id ?? "none"} target={fixTarget} onClose={() => setFixTarget(null)} onSaved={() => { setFixTarget(null); fetchDash(); fetchTodayList(); loadUnclosed(); }} />

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
              <div>
                <label className="text-xs text-gray-500">수정 사유 <span className="text-red-500">*</span></label>
                <Input value={editReason} maxLength={300} onChange={(e) => setEditReason(e.target.value)} placeholder="예: 출근 버튼 누락 — 원장 확인" />
              </div>
              {editRec.edit && (
                <p className="text-xs text-amber-700">
                  이미 고친 기록입니다{editRec.edit.inChanged ? ` · 원래 출근 ${editRec.edit.origIn}` : ""}{editRec.edit.outChanged ? ` · 원래 퇴근 ${editRec.edit.origOut}` : ""}
                </p>
              )}
              <p className="text-xs text-gray-400">지각/조퇴 상태는 자동으로 다시 계산됩니다. 원래 시각·사유·수정자는 수정 이력에 남아 목록과 엑셀에 「수정됨」으로 보입니다.</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditRec(null)}>취소</Button>
                <Button size="sm" className="bg-[#4f46e5] text-white hover:bg-[#4338ca]" onClick={saveEditRec} disabled={editSaving}>{editSaving ? "저장 중…" : "저장"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 출퇴근 기록 수동 생성 (관리자) */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>출퇴근 기록 추가 {addForm.userIds.length > 1 && <span className="text-sm font-normal text-gray-500">— {addForm.userIds.length}명 일괄</span>}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-500">직원 <span className="text-gray-400">(여러 명 선택 가능 — 같은 시각으로 들어갑니다)</span></label>
                <button type="button" className="text-[11px] text-blue-600 hover:underline"
                  onClick={() => {
                    const shown = employees.filter(e => !addSearch.trim() || `${e.name} ${e.branch || ""} ${e.department || ""}`.includes(addSearch.trim())).map(e => e.id);
                    setAddForm(f => {
                      const next = shown.every(id => f.userIds.includes(id)) ? f.userIds.filter(id => !shown.includes(id)) : [...new Set([...f.userIds, ...shown])];
                      if (next.length > 200) { toast.error("한 번에 200명까지 넣을 수 있습니다. 지점·이름으로 좁혀 주세요."); return f; }
                      return { ...f, userIds: next };
                    });
                  }}>표시된 직원 전체 선택/해제</button>
              </div>
              <Input value={addSearch} onChange={(e) => setAddSearch(e.target.value)} placeholder="이름·지점으로 찾기" className="h-8 mt-1" />
              <div className="mt-1 max-h-44 overflow-y-auto rounded border divide-y">
                {employees.filter(e => !addSearch.trim() || `${e.name} ${e.branch || ""} ${e.department || ""}`.includes(addSearch.trim())).map((e) => {
                  const on = addForm.userIds.includes(e.id);
                  return (
                    <label key={e.id} className={`flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-50 ${on ? "bg-blue-50/60" : ""}`}>
                      <input type="checkbox" checked={on}
                        onChange={(ev) => setAddForm(f => ({ ...f, userIds: ev.target.checked ? [...f.userIds, e.id] : f.userIds.filter(id => id !== e.id) }))} />
                      <span className="flex-1 truncate">{e.name}{e.branch ? <span className="text-gray-400"> · {e.branch}</span> : null}</span>
                      {on && existsOn(e.id) && <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">그 날 기록 있음 · 건너뜀</Badge>}
                    </label>
                  );
                })}
                {employees.length === 0 && <p className="px-2 py-3 text-xs text-gray-400">직원 목록을 불러오는 중…</p>}
              </div>
              {addForm.userIds.length > 0 && (
                <p className="text-[11px] text-gray-500 mt-1">
                  대상 {addForm.userIds.length}명: {employees.filter(e => addForm.userIds.includes(e.id)).map(e => e.name).join(", ")}
                  {addForm.userIds.some(existsOn) && <span className="text-amber-700"> (기록 있음 {addForm.userIds.filter(existsOn).length}명 제외)</span>}
                </p>
              )}
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
            <div>
              <label className="text-xs text-gray-500">사유</label>
              <Input value={addForm.reason} maxLength={300} onChange={(e) => setAddForm((f) => ({ ...f, reason: e.target.value }))} placeholder="예: 앱 오류로 출근 기록 누락" />
            </div>
            <p className="text-xs text-gray-400">수동 생성 기록은 GPS 좌표 없이 저장되며, 「원래 기록 없음」으로 수정 이력에 남습니다.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>취소</Button>
              <Button size="sm" className="bg-[#4f46e5] text-white hover:bg-[#4338ca]" onClick={saveAddRec} disabled={editSaving}>{editSaving ? "저장 중…" : addForm.userIds.length > 1 ? `${addForm.userIds.length - addForm.userIds.filter(existsOn).length}명 추가` : "추가"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
