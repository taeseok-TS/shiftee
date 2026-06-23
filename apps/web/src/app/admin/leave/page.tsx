"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  UmbrellaOff, Plus, Check, X, AlertCircle, CalendarDays,
  ClipboardList, Users, Pencil, GitBranch, Inbox, ChevronRight,
  Trash2, Search, ArrowUp, ArrowDown, RefreshCw, Calculator,
} from "lucide-react";
import { format, eachDayOfInterval, getDay } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import { getPermissionSummary, type UserRole } from "@/lib/permissions";

/* ── 타입 ── */
type ApprovalStepInfo = {
  id: string; order: number; status: string;
  approver: { id: string; name: string; position: string | null };
  comment?: string | null;
};
type LeaveRequest = {
  id: string; type: string; startDate: string; endDate: string;
  days: number; reason: string | null; status: string;
  rejectedReason: string | null;
  user: { name: string; department: string | null };
  approver: { name: string } | null;
  approvalSteps?: ApprovalStepInfo[];
};
type Balance  = { total: number; used: number; remaining: number };
type EmpBalance = {
  userId: string; name: string; department: string; position: string;
  branch?: string; hireDate?: string | null; tenure?: string; recommended?: number | null; leaveNote?: string | null;
  balanceId: string | null; year: number; total: number; used: number; remaining: number;
};
type LineStep = { order: number; approver: { id: string; name: string; position: string | null; department: string | null; branch?: string | null } };
type LineUser = {
  id: string; name: string; department: string | null; position: string | null; branch?: string | null;
  approvalLine: { steps: LineStep[] } | null;
  approvalLines?: { id: string; purpose: string; steps: LineStep[] }[];
};
const LINE_PURPOSES = [
  { key: "CONTRACT", label: "결재라인1", desc: "전자계약" },
  { key: "LEAVE_2PLUS", label: "결재라인2", desc: "연차 2일 이상" },
  { key: "LEAVE_SHORT", label: "결재라인3", desc: "단기휴가(1일·반차·반반차)" },
];
type AllUser  = { id: string; name: string; department: string | null; position: string | null; branch?: string | null };
type MyStep   = {
  id: string; order: number;
  leaveRequest: LeaveRequest & { approvalSteps: ApprovalStepInfo[] };
};

/* ── 상수 ── */
const TYPE_LABEL: Record<string, string> = {
  ANNUAL: "연차", HALF_AM: "오전반차", HALF_PM: "오후반차",
  QUARTER_AM: "오전반반차", QUARTER_PM: "오후반반차",
  COMPENSATORY: "대체휴무", COMPENSATORY_HALF: "대체휴무반차",
  SICK: "병가", SPECIAL: "특별휴가",
  CIVIL_DEFENSE: "민방위", RESERVE_FORCES: "예비군훈련", FAMILY_EVENT: "경조사",
};
const SINGLE_DAY_TYPES = new Set(["HALF_AM","HALF_PM","QUARTER_AM","QUARTER_PM","COMPENSATORY_HALF","CIVIL_DEFENSE"]);
const FIXED_DAYS: Record<string, number> = {
  HALF_AM: 0.5, HALF_PM: 0.5, QUARTER_AM: 0.25, QUARTER_PM: 0.25, COMPENSATORY_HALF: 0.5, CIVIL_DEFENSE: 0.5,
};
// 연차 미차감 유형 (승인되어도 잔여 연차에서 차감되지 않음)
const NON_DEDUCT_TYPES = new Set(["COMPENSATORY","COMPENSATORY_HALF","SPECIAL","CIVIL_DEFENSE","RESERVE_FORCES","FAMILY_EVENT"]);
const STATUS_CFG: Record<string, { label: string; badge: string }> = {
  PENDING:   { label: "대기중",  badge: "bg-amber-100 text-amber-700 border-amber-200" },
  APPROVED:  { label: "승인",    badge: "bg-green-100 text-green-700 border-green-200" },
  REJECTED:  { label: "반려",    badge: "bg-red-100 text-red-700 border-red-200" },
  CANCELLED: { label: "취소",    badge: "bg-gray-100 text-gray-500 border-gray-200" },
};
const STEP_CFG: Record<string, { dot: string; label: string }> = {
  WAITING:  { dot: "bg-gray-300",   label: "대기" },
  PENDING:  { dot: "bg-amber-400",  label: "결재중" },
  APPROVED: { dot: "bg-green-500",  label: "승인" },
  REJECTED: { dot: "bg-red-500",    label: "반려" },
};

const CURRENT_YEAR = new Date().getFullYear();
const YEARS        = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

function calcWorkdays(start: string, end: string, type: string) {
  if (!start) return 0;
  if (type in FIXED_DAYS) return FIXED_DAYS[type];
  if (!end) return 0;
  try {
    const s = new Date(start), e = new Date(end);
    if (s > e) return 0;
    return eachDayOfInterval({ start: s, end: e })
      .filter(d => getDay(d) !== 0 && getDay(d) !== 6).length;
  } catch { return 0; }
}

/* ── 결재 진행 뱃지 ── */
function ApprovalChain({ steps }: { steps: ApprovalStepInfo[] }) {
  if (!steps || steps.length === 0) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((s, i) => {
        const cfg = STEP_CFG[s.status] ?? STEP_CFG.WAITING;
        return (
          <span key={s.id} className="flex items-center gap-1 text-xs">
            {i > 0 && <ChevronRight size={10} className="text-gray-300" />}
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            <span className="text-gray-600">{s.approver.name}</span>
            <span className={`text-[10px] ${s.status === "APPROVED" ? "text-green-600" : s.status === "REJECTED" ? "text-red-500" : s.status === "PENDING" ? "text-amber-600" : "text-gray-400"}`}>
              ({cfg.label})
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default function LeavePage() {
  const [role, setRole]   = useState("EMPLOYEE");
  const [myId, setMyId]   = useState("");

  /* 신청 목록 */
  const [requests, setRequests]         = useState<LeaveRequest[]>([]);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterYear, setFilterYear]     = useState(String(CURRENT_YEAR));
  const [filterMonth, setFilterMonth]   = useState("all");

  /* 잔여 현황 */
  const [balance, setBalance]       = useState<Balance | null>(null);
  const [empBalances, setEmpBalances] = useState<EmpBalance[]>([]);

  /* 내 결재함 */
  const [mySteps, setMySteps]       = useState<MyStep[]>([]);

  /* 결재라인 설정 */
  const [lineUsers, setLineUsers]   = useState<LineUser[]>([]);
  const [allUsers, setAllUsers]     = useState<AllUser[]>([]);
  const [lineEditOpen, setLineEditOpen]   = useState(false);
  const [lineEditTarget, setLineEditTarget] = useState<LineUser | null>(null);
  const [lineEditPurpose, setLineEditPurpose] = useState("LEAVE_2PLUS"); // 편집 중인 결재라인 용도
  const [lineSteps, setLineSteps]   = useState<AllUser[]>([]); // 편집 중인 결재자 목록
  const [userSearch, setUserSearch] = useState("");

  /* 휴가 신청 */
  const [addOpen, setAddOpen]   = useState(false);
  const [form, setForm]         = useState({ type: "ANNUAL", startDate: "", endDate: "", reason: "" });
  const previewDays = useMemo(() => calcWorkdays(form.startDate, form.endDate, form.type), [form]);

  /* 반려 다이얼로그 */
  const [rejectOpen, setRejectOpen]     = useState(false);
  const [rejectTarget, setRejectTarget] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  /* 잔여 조정 */
  const [editOpen, setEditOpen]     = useState(false);
  const [editTarget, setEditTarget] = useState<EmpBalance | null>(null);
  const [editForm, setEditForm]     = useState<{ total: number; used: number; leaveNote: string }>({ total: 15, used: 0, leaveNote: "" });
  // #7 연차 자동계산 / #8 연차수당 계산
  const [recalcing, setRecalcing]   = useState(false);
  const [allowTarget, setAllowTarget] = useState<EmpBalance | null>(null);
  const [allowSalary, setAllowSalary] = useState("");
  const [allowBaseDate, setAllowBaseDate] = useState("");

  // 권한 요약 (통일된 권한 함수 사용)
  const permissions = useMemo(() => getPermissionSummary(role as UserRole), [role]);
  const isAdmin = permissions.canManageEmployees;

  /* ── 데이터 로드 ── */
  const fetchRequests = useCallback(async () => {
    const p = new URLSearchParams();
    if (filterStatus !== "all") p.set("status", filterStatus);
    p.set("year", filterYear);
    if (filterMonth !== "all") p.set("month", filterMonth);
    const data = await fetch(`/api/leave?${p}`).then(r => r.json());
    setRequests(data.requests || []);
  }, [filterStatus, filterYear, filterMonth]);

  const fetchBalance = useCallback(async () => {
    const data = await fetch("/api/leave/balance").then(r => r.json());
    if (data.balance)  setBalance(data.balance);
    if (data.balances) setEmpBalances(data.balances);
  }, []);

  const fetchMySteps = useCallback(async () => {
    const data = await fetch("/api/leave/my-approvals").then(r => r.json());
    setMySteps(data.steps || []);
  }, []);

  const fetchApprovalLines = useCallback(async () => {
    if (!isAdmin) return;
    const data = await fetch("/api/approval-line").then(r => r.json());
    setLineUsers(data.employees || []);
    setAllUsers(data.allUsers   || []);
  }, [isAdmin]);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      setRole(d.user?.role || "EMPLOYEE");
      setMyId(d.user?.id   || "");
    });
  }, []);

  useEffect(() => { fetchRequests();     }, [fetchRequests]);
  useEffect(() => { fetchBalance();      }, [fetchBalance]);
  useEffect(() => { fetchMySteps();      }, [fetchMySteps]);
  useEffect(() => { fetchApprovalLines();}, [fetchApprovalLines]);

  /* ── 휴가 신청 ── */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (previewDays <= 0) { toast.error("올바른 날짜 범위를 선택해주세요."); return; }
    const res  = await fetch("/api/leave", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success(`${data.days}일 휴가 신청이 완료되었습니다.`);
    setAddOpen(false);
    setForm({ type: "ANNUAL", startDate: "", endDate: "", reason: "" });
    fetchRequests(); fetchBalance(); fetchMySteps();
  }

  /* ── 승인 ── */
  async function handleApprove(id: string) {
    const res = await fetch(`/api/leave/${id}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    if (!res.ok) { toast.error((await res.json()).error); return; }
    toast.success("승인되었습니다.");
    fetchRequests(); fetchBalance(); fetchMySteps();
  }

  /* ── 반려 ── */
  function openReject(id: string) { setRejectTarget(id); setRejectReason(""); setRejectOpen(true); }
  async function handleReject() {
    const res = await fetch(`/api/leave/${rejectTarget}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", reason: rejectReason }),
    });
    if (!res.ok) { toast.error((await res.json()).error); return; }
    toast.success("반려되었습니다.");
    setRejectOpen(false);
    fetchRequests(); fetchMySteps();
  }

  /* ── 취소 ── */
  async function handleCancel(id: string) {
    const res = await fetch(`/api/leave/${id}`, { method: "PATCH" });
    if (!res.ok) { toast.error((await res.json()).error); return; }
    toast.success("신청이 취소되었습니다.");
    fetchRequests(); fetchBalance();
  }

  /* ── 잔여 조정 ── */
  async function handleEditSave() {
    if (!editTarget) return;
    const res = await fetch("/api/leave/balance", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: editTarget.userId, total: editForm.total, used: editForm.used, leaveNote: editForm.leaveNote }),
    });
    if (!res.ok) { toast.error((await res.json()).error); return; }
    toast.success("잔여 휴가가 조정되었습니다.");
    setEditOpen(false); fetchBalance();
  }

  /* ── #7 근속기간 기반 연차 자동계산 ── */
  async function recalcAll() {
    setRecalcing(true);
    try {
      const res = await fetch("/api/leave/balance/recalc", { method: "POST" });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || "자동계산 실패"); return; }
      toast.success(`${d.updated}명 연차를 자동 계산했습니다.`);
      fetchBalance();
    } finally { setRecalcing(false); }
  }

  /* ── 결재라인 편집 열기 ── */
  function openLineEdit(emp: LineUser, purpose: string) {
    setLineEditTarget(emp);
    setLineEditPurpose(purpose);
    const line = emp.approvalLines?.find(l => l.purpose === purpose);
    setLineSteps(line?.steps.map(s => s.approver as AllUser) ?? []);
    setUserSearch("");
    setLineEditOpen(true);
  }

  /* ── 결재라인 저장 ── */
  async function handleLineSave() {
    if (!lineEditTarget) return;
    const res = await fetch(`/api/approval-line/${lineEditTarget.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approverIds: lineSteps.map(u => u.id), purpose: lineEditPurpose }),
    });
    if (!res.ok) { toast.error((await res.json()).error); return; }
    toast.success("결재라인이 저장되었습니다.");
    setLineEditOpen(false); fetchApprovalLines();
  }

  /* ── 결재자 추가/이동/삭제 ── */
  function addApprover(user: AllUser) {
    if (lineSteps.find(s => s.id === user.id)) { toast.error("이미 추가된 결재자입니다."); return; }
    setLineSteps(prev => [...prev, user]);
  }
  function removeApprover(idx: number) {
    setLineSteps(prev => prev.filter((_, i) => i !== idx));
  }
  function moveApprover(idx: number, dir: -1 | 1) {
    setLineSteps(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  const filteredUsers = allUsers.filter(u =>
    u.id !== lineEditTarget?.id &&
    (u.name.includes(userSearch) || (u.department ?? "").includes(userSearch) || (u.position ?? "").includes(userSearch))
  );

  function progressColor(used: number, total: number) {
    const pct = total > 0 ? used / total : 0;
    if (pct >= 0.9) return "bg-red-500";
    if (pct >= 0.6) return "bg-amber-500";
    return "bg-blue-500";
  }

  /* ── 렌더 ── */
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">휴가 관리</h1>
        <Button className="gap-2" onClick={() => setAddOpen(true)}>
          <Plus size={15} />휴가 신청
        </Button>
      </div>

      {/* 직원 잔여 카드 */}
      {!isAdmin && balance && (
        <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-blue-700">나의 연차 현황</p>
                <p className="text-3xl font-bold text-blue-900 mt-0.5">
                  {balance.remaining}<span className="text-base font-normal text-blue-600 ml-1">일 남음</span>
                </p>
              </div>
              <div className="text-right text-sm text-blue-600">
                <p>총 {balance.total}일</p><p>사용 {balance.used}일</p>
              </div>
            </div>
            <div className="w-full bg-blue-100 rounded-full h-2">
              <div className={`h-2 rounded-full transition-all ${progressColor(balance.used, balance.total)}`}
                style={{ width: `${Math.min((balance.used / balance.total) * 100, 100)}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 탭 ── */}
      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list" className="gap-1.5">
            <ClipboardList size={14} />신청 관리
          </TabsTrigger>
          {/* 내 결재함: 결재 대기가 있으면 모두에게 표시 */}
          {mySteps.length > 0 && (
            <TabsTrigger value="myapprovals" className="gap-1.5 relative">
              <Inbox size={14} />내 결재함
              <span className="ml-1 bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">
                {mySteps.length}
              </span>
            </TabsTrigger>
          )}
          {isAdmin && (
            <>
              <TabsTrigger value="approvalline" className="gap-1.5">
                <GitBranch size={14} />결재라인 설정
              </TabsTrigger>
              <TabsTrigger value="balance" className="gap-1.5">
                <Users size={14} />직원별 잔여 현황
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* ═══ 신청 목록 ═══ */}
        <TabsContent value="list" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Select value={filterYear} onValueChange={v => v && (setFilterYear(v), setFilterMonth("all"))}>
              <SelectTrigger className="w-28 h-8 text-sm bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>{YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}년</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filterMonth} onValueChange={v => v && setFilterMonth(v)}>
              <SelectTrigger className="w-24 h-8 text-sm bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 월</SelectItem>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <SelectItem key={m} value={String(m)}>{m}월</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex bg-white border rounded-lg overflow-hidden shadow-sm">
              {[
                { value: "all", label: "전체" },
                { value: "PENDING",   label: "대기" },
                { value: "APPROVED",  label: "승인" },
                { value: "REJECTED",  label: "반려" },
                { value: "CANCELLED", label: "취소" },
              ].map(({ value, label }) => (
                <button key={value} onClick={() => setFilterStatus(value)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors border-r last:border-r-0
                    ${filterStatus === value ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-500 bg-gray-50/60">
                      {isAdmin && <th className="px-4 py-3 font-medium">직원</th>}
                      <th className="px-4 py-3 font-medium">유형</th>
                      <th className="px-4 py-3 font-medium">기간</th>
                      <th className="px-4 py-3 font-medium">일수</th>
                      <th className="px-4 py-3 font-medium">결재 현황</th>
                      <th className="px-4 py-3 font-medium">상태</th>
                      <th className="px-4 py-3 font-medium">처리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.length === 0 ? (
                      <tr><td colSpan={7} className="py-16 text-center text-gray-400">
                        <UmbrellaOff size={32} className="mx-auto mb-2 opacity-30" />신청 내역이 없습니다.
                      </td></tr>
                    ) : requests.map(r => {
                      const s = STATUS_CFG[r.status] ?? STATUS_CFG.CANCELLED;
                      return (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50/70 transition-colors">
                          {isAdmin && (
                            <td className="px-4 py-3">
                              <p className="font-medium text-gray-900">{r.user.name}</p>
                              <p className="text-xs text-gray-400">{r.user.department}</p>
                            </td>
                          )}
                          <td className="px-4 py-3 font-medium text-gray-800">{TYPE_LABEL[r.type] ?? r.type}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            {format(new Date(r.startDate), "yyyy.MM.dd")}
                            {r.startDate !== r.endDate && ` ~ ${format(new Date(r.endDate), "MM.dd")}`}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{r.days}일</td>
                          <td className="px-4 py-3">
                            {r.approvalSteps && r.approvalSteps.length > 0
                              ? <ApprovalChain steps={r.approvalSteps} />
                              : <span className="text-xs text-gray-400">-</span>}
                            {r.status === "REJECTED" && r.rejectedReason && (
                              <p className="text-xs text-red-500 mt-0.5">반려: {r.rejectedReason}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex text-xs px-2 py-0.5 rounded-full border font-medium ${s.badge}`}>
                              {s.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              {isAdmin && r.status === "PENDING" && (
                                <>
                                  <Button size="sm" className="h-7 gap-1 bg-green-600 hover:bg-green-700"
                                    onClick={() => handleApprove(r.id)}><Check size={11} />승인</Button>
                                  <Button size="sm" variant="destructive" className="h-7 gap-1"
                                    onClick={() => openReject(r.id)}><X size={11} />반려</Button>
                                </>
                              )}
                              {isAdmin && r.status === "APPROVED" && (
                                <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-400 hover:text-red-500"
                                  onClick={() => handleCancel(r.id)}>취소</Button>
                              )}
                              {!isAdmin && r.status === "PENDING" && (
                                <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-400 hover:text-red-500"
                                  onClick={() => handleCancel(r.id)}><X size={11} />취소</Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ 내 결재함 ═══ */}
        <TabsContent value="myapprovals" className="mt-4 space-y-3">
          {mySteps.length === 0 ? (
            <div className="text-center text-gray-400 py-16">
              <Inbox size={32} className="mx-auto mb-2 opacity-30" />결재 대기 건이 없습니다.
            </div>
          ) : mySteps.map(step => {
            const r = step.leaveRequest;
            return (
              <Card key={step.id} className="border-amber-200">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{r.user.name}</span>
                        <span className="text-xs text-gray-400">{r.user.department}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_CFG.PENDING.badge}`}>
                          대기중
                        </span>
                      </div>
                      <div className="text-sm text-gray-700">
                        <span className="font-medium">{TYPE_LABEL[r.type]}</span>
                        <span className="mx-2 text-gray-400">·</span>
                        {format(new Date(r.startDate), "yyyy.MM.dd")}
                        {r.startDate !== r.endDate && ` ~ ${format(new Date(r.endDate), "MM.dd")}`}
                        <span className="ml-2 text-gray-500">({r.days}일)</span>
                      </div>
                      {r.reason && <p className="text-xs text-gray-500">사유: {r.reason}</p>}
                      <div className="pt-1">
                        <p className="text-xs text-gray-400 mb-1">결재 순서</p>
                        <ApprovalChain steps={r.approvalSteps} />
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700"
                        onClick={() => handleApprove(r.id)}>
                        <Check size={13} />승인
                      </Button>
                      <Button size="sm" variant="destructive" className="gap-1"
                        onClick={() => openReject(r.id)}>
                        <X size={13} />반려
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ═══ 결재라인 설정 (관리자) ═══ */}
        {isAdmin && (
          <TabsContent value="approvalline" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-600 font-medium">
                  직원별 결재라인을 설정하세요. 설정된 순서대로 순차 결재가 진행됩니다.
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-gray-500 bg-gray-50/60 text-left">
                      <th className="px-4 py-3 font-medium w-52">직원</th>
                      <th className="px-4 py-3 font-medium">결재라인 (용도별)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineUsers.map(emp => (
                      <tr key={emp.id} className="border-b last:border-0 align-top">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900 flex items-center gap-1">
                            {emp.branch && <span className="text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{emp.branch}</span>}
                            {emp.name}
                          </p>
                          <p className="text-xs text-gray-400">{emp.department} · {emp.position}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-2">
                            {LINE_PURPOSES.map(lp => {
                              const line = emp.approvalLines?.find(l => l.purpose === lp.key);
                              const steps = line?.steps ?? [];
                              return (
                                <div key={lp.key} className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[11px] font-medium text-gray-500 w-40 shrink-0">
                                    {lp.label} <span className="text-gray-400">· {lp.desc}</span>
                                  </span>
                                  {steps.length > 0 ? (
                                    <div className="flex items-center gap-1 flex-wrap flex-1">
                                      {steps.map((s, i) => (
                                        <span key={s.order} className="flex items-center gap-1 text-xs">
                                          {i > 0 && <ChevronRight size={10} className="text-gray-300" />}
                                          <span className="bg-blue-50 border border-blue-200 text-blue-700 rounded px-1.5 py-0.5">
                                            {s.order}차. {s.approver.branch ? `[${s.approver.branch}] ` : ""}{s.approver.name}
                                            {s.approver.position && <span className="text-blue-400 ml-1">({s.approver.position})</span>}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-gray-400 flex-1">미설정</span>
                                  )}
                                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-gray-400 hover:text-gray-700 shrink-0"
                                    onClick={() => openLineEdit(emp, lp.key)}>
                                    <Pencil size={12} />설정
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ═══ 직원별 잔여 현황 (관리자) ═══ */}
        {isAdmin && (
          <TabsContent value="balance" className="mt-4">
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between gap-2">
                <CardTitle className="text-sm text-gray-600 font-medium">
                  전체 {empBalances.length}명 · {CURRENT_YEAR}년 기준
                </CardTitle>
                <Button variant="outline" size="sm" className="gap-1 shrink-0" onClick={recalcAll} disabled={recalcing}>
                  <RefreshCw size={13} className={recalcing ? "animate-spin" : ""} />연차 자동계산
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-gray-500 bg-gray-50/60 text-left">
                      <th className="px-4 py-3 font-medium">직원</th>
                      <th className="px-4 py-3 font-medium">지점</th>
                      <th className="px-4 py-3 font-medium">근속기간</th>
                      <th className="px-4 py-3 font-medium">총 연차</th>
                      <th className="px-4 py-3 font-medium">사용</th>
                      <th className="px-4 py-3 font-medium w-40">잔여</th>
                      <th className="px-4 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {empBalances.map(b => {
                      const pct = b.total > 0 ? (b.used / b.total) * 100 : 0;
                      return (
                        <tr key={b.userId} className="border-b last:border-0 hover:bg-gray-50/70">
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{b.name}</p>
                            <p className="text-xs text-gray-400">{b.department} · {b.position}</p>
                            {b.leaveNote && <p className="text-[11px] text-amber-600 mt-0.5">※ {b.leaveNote}</p>}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{b.branch || "-"}</td>
                          <td className="px-4 py-3 text-gray-600">{b.tenure || "-"}</td>
                          <td className="px-4 py-3 text-gray-700 font-medium">
                            {b.total}일
                            {b.recommended != null && b.recommended !== b.total && (
                              <span className="text-[11px] text-amber-600 ml-1" title="근로기준법 권장">(권장 {b.recommended})</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{b.used}일</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                                <div className={`h-1.5 rounded-full transition-all ${progressColor(b.used, b.total)}`}
                                  style={{ width: `${Math.min(pct, 100)}%` }} />
                              </div>
                              <span className={`text-sm font-semibold w-10 text-right
                                ${b.remaining <= 0 ? "text-red-500" : b.remaining <= 3 ? "text-amber-600" : "text-blue-600"}`}>
                                {b.remaining}일
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <Button variant="ghost" size="sm" className="h-7 gap-1 text-gray-400 hover:text-gray-700"
                              onClick={() => { setEditTarget(b); setEditForm({ total: b.total, used: b.used, leaveNote: b.leaveNote ?? "" }); setEditOpen(true); }}>
                              <Pencil size={12} />조정
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 gap-1 text-indigo-500 hover:text-indigo-700"
                              onClick={() => { setAllowTarget(b); setAllowSalary(""); setAllowBaseDate(new Date().toISOString().slice(0,10)); }}>
                              <Calculator size={12} />계산
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* ═══ 휴가 신청 다이얼로그 ═══ */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-xl sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CalendarDays size={18} />휴가 신청</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isAdmin && balance && (
              <div className="flex items-center justify-between bg-blue-50 rounded-lg px-4 py-2.5">
                <span className="text-sm text-blue-700">잔여 연차</span>
                <span className="font-bold text-blue-800">{balance.remaining}일</span>
              </div>
            )}
            <div className="space-y-2">
              <Label>휴가 유형 *</Label>
              <Select value={form.type} onValueChange={v =>
                v && setForm(f => ({ ...f, type: v, endDate: SINGLE_DAY_TYPES.has(v) ? f.startDate : f.endDate }))
              }>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <div className="px-2 py-1 text-xs text-gray-400 font-medium">연차 계열</div>
                  {(["ANNUAL","HALF_AM","HALF_PM","QUARTER_AM","QUARTER_PM"] as const).map(k => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center justify-between w-full gap-8">
                        <span>{TYPE_LABEL[k]}</span>
                        {FIXED_DAYS[k] && <span className="text-xs text-gray-400">{FIXED_DAYS[k]}일</span>}
                      </span>
                    </SelectItem>
                  ))}
                  <div className="px-2 py-1 text-xs text-gray-400 font-medium border-t mt-1 pt-2">기타</div>
                  {(["COMPENSATORY","COMPENSATORY_HALF","SICK","SPECIAL","CIVIL_DEFENSE","RESERVE_FORCES","FAMILY_EVENT"] as const).map(k => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center justify-between w-full gap-8">
                        <span>{TYPE_LABEL[k]}</span>
                        <span className="text-xs text-gray-400">
                          {FIXED_DAYS[k] && `${FIXED_DAYS[k]}일 `}
                          {NON_DEDUCT_TYPES.has(k) && "· 연차 미차감"}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {SINGLE_DAY_TYPES.has(form.type) ? (
              <div className="space-y-2">
                <Label>날짜 *</Label>
                <Input type="date" value={form.startDate} required
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value, endDate: e.target.value }))} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>시작일 *</Label>
                  <Input type="date" value={form.startDate} required
                    onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>종료일 *</Label>
                  <Input type="date" value={form.endDate} required min={form.startDate}
                    onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
                </div>
              </div>
            )}
            {previewDays > 0 && (
              <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2 text-sm">
                <span className="text-gray-500">{FIXED_DAYS[form.type] ? "신청 일수 (고정)" : "신청 일수 (평일 기준)"}</span>
                <span className="font-bold text-gray-800">{previewDays}일</span>
              </div>
            )}
            <div className="space-y-2">
              <Label>사유 <span className="text-gray-400 font-normal text-xs">(선택)</span></Label>
              <Textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="휴가 사유를 입력하세요" rows={2} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>취소</Button>
              <Button type="submit" disabled={previewDays <= 0}>신청</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ 반려 다이얼로그 ═══ */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-red-600">휴가 반려</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>반려 사유 <span className="text-gray-400 font-normal text-xs">(선택)</span></Label>
              <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                placeholder="반려 사유를 입력하면 직원에게 표시됩니다." rows={3} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setRejectOpen(false)}>취소</Button>
              <Button variant="destructive" onClick={handleReject}><X size={14} className="mr-1" />반려 확정</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══ 잔여 조정 다이얼로그 ═══ */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>연차 조정 — {editTarget?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>총 연차 일수</Label>
              <Input type="number" min={0} max={365} step={0.5} value={editForm.total}
                onChange={e => setEditForm(f => ({ ...f, total: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-2">
              <Label>사용 일수</Label>
              <Input type="number" min={0} step={0.5} value={editForm.used}
                onChange={e => setEditForm(f => ({ ...f, used: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-2">
              <Label>근속 별도 표기 (육아휴직 등, 선택)</Label>
              <Input placeholder="예: 2023.03~2024.02 육아휴직" value={editForm.leaveNote}
                onChange={e => setEditForm(f => ({ ...f, leaveNote: e.target.value }))} />
            </div>
            <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2 text-sm">
              <span className="text-gray-500">조정 후 잔여</span>
              <span className="font-bold text-blue-700">{Math.max(editForm.total - editForm.used, 0)}일</span>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
              <Button onClick={handleEditSave}>저장</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══ #8 연차수당 계산 다이얼로그 ═══ */}
      <Dialog open={!!allowTarget} onOpenChange={(o) => { if (!o) setAllowTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Calculator size={18} />연차수당 계산 — {allowTarget?.name}</DialogTitle></DialogHeader>
          {allowTarget && (() => {
            const salary = parseFloat(allowSalary.replace(/[^0-9.]/g, "")) || 0;
            const remaining = allowTarget.remaining;
            const dailyWage = salary > 0 ? Math.round((salary / 12 / 209) * 8) : 0;
            const allowance = Math.round(dailyWage * remaining);
            const won = (n: number) => n.toLocaleString("ko-KR");
            return (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>연봉 (원)</Label>
                  <Input inputMode="numeric" placeholder="예: 36000000" value={allowSalary}
                    onChange={(e) => setAllowSalary(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>계산 기준일</Label>
                  <Input type="date" value={allowBaseDate} onChange={(e) => setAllowBaseDate(e.target.value)} />
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1.5">
                  <div className="flex justify-between"><span className="text-gray-500">잔여 연차</span><span className="font-medium">{remaining}일</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">1일 통상임금</span><span className="font-medium">₩{won(dailyWage)}</span></div>
                  <div className="text-[11px] text-gray-400">= (연봉 ÷ 12 ÷ 209시간) × 8시간</div>
                  <div className="border-t pt-2 flex justify-between items-center">
                    <span className="text-gray-700 font-medium">연차수당</span>
                    <span className="text-lg font-bold text-indigo-600">₩{won(allowance)}</span>
                  </div>
                  <div className="text-[11px] text-gray-400">= 1일 통상임금 × 잔여 연차 {remaining}일</div>
                </div>
                <p className="text-[11px] text-gray-400">※ 통상임금 산정 방식(상여 포함 여부 등)에 따라 실제 금액은 달라질 수 있습니다.</p>
                <div className="flex justify-end"><Button variant="outline" onClick={() => setAllowTarget(null)}>닫기</Button></div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ═══ 결재라인 편집 다이얼로그 ═══ */}
      <Dialog open={lineEditOpen} onOpenChange={setLineEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch size={18} />
              {LINE_PURPOSES.find(p => p.key === lineEditPurpose)?.label || "결재라인"} 설정 — {lineEditTarget?.name}
              <span className="text-sm font-normal text-gray-400">
                ({LINE_PURPOSES.find(p => p.key === lineEditPurpose)?.desc})
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* 현재 결재 순서 */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">결재 순서 (위→아래 순서로 진행)</p>
              {lineSteps.length === 0 ? (
                <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-4 py-3 text-center">
                  결재자를 추가하세요. 비워두면 관리자가 직접 승인합니다.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {lineSteps.map((u, i) => (
                    <div key={u.id} className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                      <span className="text-xs font-bold text-blue-500 w-5">{i + 1}차</span>
                      <div className="flex-1">
                        <span className="font-medium text-sm text-gray-800">
                          {u.branch ? `[${u.branch}] ` : ""}{u.name}
                        </span>
                        {u.position && <span className="text-xs text-gray-400 ml-1.5">{u.position}</span>}
                        {u.department && <span className="text-xs text-gray-300 ml-1">· {u.department}</span>}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-gray-400"
                          onClick={() => moveApprover(i, -1)} disabled={i === 0}>
                          <ArrowUp size={12} />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-gray-400"
                          onClick={() => moveApprover(i, 1)} disabled={i === lineSteps.length - 1}>
                          <ArrowDown size={12} />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                          onClick={() => removeApprover(i)}>
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 결재자 검색 & 추가 */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">결재자 추가</p>
              <div className="relative mb-2">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input placeholder="이름, 부서, 직책 검색..." value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  className="pl-8 h-8 text-sm" />
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1 border rounded-lg p-1">
                {filteredUsers.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-3">검색 결과가 없습니다.</p>
                ) : filteredUsers.map(u => (
                  <button key={u.id} onClick={() => addApprover(u)}
                    className="w-full flex items-center justify-between px-3 py-1.5 rounded hover:bg-gray-50 text-left group">
                    <div>
                      <span className="text-sm font-medium text-gray-800">
                        {u.branch ? `[${u.branch}] ` : ""}{u.name}
                      </span>
                      {u.position && <span className="text-xs text-gray-400 ml-1.5">{u.position}</span>}
                      {u.department && <span className="text-xs text-gray-300 ml-1">· {u.department}</span>}
                    </div>
                    <Plus size={13} className="text-gray-300 group-hover:text-blue-500" />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setLineEditOpen(false)}>취소</Button>
              <Button onClick={handleLineSave}>저장</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
