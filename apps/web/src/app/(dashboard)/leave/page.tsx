"use client";

import { LEAVE_CATALOG, LEAVE_LABELS, leaveInfo, LIVE_SINGLE_DAY, LIVE_FIXED_DAYS } from "@/lib/leave-catalog";
import { useLeaveCatalog } from "@/components/leave/useLeaveCatalog";
import { useLeaveDaysPreview } from "@/components/leave/useLeaveDaysPreview";
import LeaveDaysPreviewBox, { previewAllowsSubmit } from "@/components/leave/LeaveDaysPreviewBox";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  UmbrellaOff, Plus, X, CalendarDays,
  ClipboardList, Pencil, GitBranch, ChevronRight,
  Trash2, Search, ArrowUp, ArrowDown, Paperclip,
} from "lucide-react";
import { toast } from "sonner";
import { fmtDayShort, fmtRangeKo } from "@/lib/leave-period";
import { postLeaveApprove } from "@/lib/leave-approve-client";
import { PageHead, Btn, Box, Tiles, Tile, FilterRow, Chip, inputClass, tableClass, StatusPill, FlowDots, MoreMenu, type PillTone, type MoreItem } from "@/components/kit";

/* ── 타입 ── */
type ApprovalStepInfo = {
  id: string; order: number; status: string;
  approver: { id: string; name: string; position: string | null } | null;
  approverRole?: string | null; branch?: string | null;
  comment?: string | null;
};
type LeaveRequest = {
  id: string; type: string; startDate: string; endDate: string;
  days: number; reason: string | null; status: string;
  attachmentUrl?: string | null; attachmentName?: string | null;
  rejectedReason: string | null;
  user: { name: string; department: string | null };
  approver: { name: string } | null;
  approvalSteps?: ApprovalStepInfo[];
  canCancel?: boolean;   // 서버 판정(lib/leave-cancel.ts)
  cancelBlock?: string | null;   // 취소 못 하는 이유 코드(IN_REVIEW = 원장이 이미 승인 — 본인은 바로 취소 불가)
  canRequestCancel?: boolean;   // 취소 결재를 올릴 수 있나(본인·승인건·시작 전날까지 — 서버 판정)
  pendingCancel?: { id: string; mine: boolean } | null;   // 진행 중인 취소 결재
};
type Balance  = { total: number; used: number; remaining: number };
type EmpBalance = {
  userId: string; name: string; department: string; position: string;
  balanceId: string | null; year: number; total: number; used: number; remaining: number;
};
type LineUser = {
  id: string; name: string; department: string | null; position: string | null; branch?: string | null;
  approvalLine: { steps: { order: number; approver: { id: string; name: string; position: string | null; department: string | null; branch?: string | null } }[] } | null;
};
type AllUser  = { id: string; name: string; department: string | null; position: string | null; branch?: string | null };
type MyStep   = {
  id: string; order: number;
  leaveRequest: LeaveRequest & { approvalSteps: ApprovalStepInfo[] };
};

/* ── 상수 ── */
// 휴가 유형 — 기준표(lib/leave-catalog.ts, 본부 답변 #19)에서
const TYPE_LABEL: Record<string, string> = LEAVE_LABELS;   // 공용 객체 — useLeaveCatalog 가 본부 유형 이름을 채운다(#216-1)
// 공용 라이브 객체(lib/leave-catalog) — useLeaveCatalog 가 본부 유형까지 채운다(#216-1). 복사하면 새 유형이 빠진다
const SINGLE_DAY_TYPES = LIVE_SINGLE_DAY;
const FIXED_DAYS: Record<string, number> = LIVE_FIXED_DAYS;
// 연차 미차감 유형 (승인되어도 잔여 연차에서 차감되지 않음)
const NON_DEDUCT_TYPES = new Set(LEAVE_CATALOG.filter((t) => !t.deducts).map((t) => t.code));
// 상태 알약(kit, 시안 R13과 같은 말·색) — 대기 주황 · 승인 파랑 · 반려 분홍 · 취소 회색
const STATUS_CFG: Record<string, { label: string; tone: PillTone }> = {
  PENDING:   { label: "대기", tone: "wait" },
  APPROVED:  { label: "승인", tone: "done" },
  REJECTED:  { label: "반려", tone: "rej" },
  CANCELLED: { label: "취소", tone: "gray" },
};

const CURRENT_YEAR = new Date().getFullYear();
// 내년도 둔다 — 12월에 승인된 내년 휴가를 1월 전에도 볼 수 있게(휴가를 쓰는 해 기준, 9/11 검증 D3)
const YEARS        = [CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];
// 연차 연도 — 서버 currentLeaveYear() 와 같은 KST 달력 연도
// 매번 계산한다 — 모듈을 불러올 때 한 번만 계산하면 해를 넘겨 열어 둔 탭에서 올해가 "내년"으로 뜬다(9/11 검증 E2)
const kstYearNow   = () => new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();

/* ── 결재 진행 점(kit FlowDots, 관리자 휴가 관리 R13과 같은 모양) — 끝난 사람 파랑 · 지금 차례 주황 · 남은 사람 회색 ── */
function stepLabel(s: ApprovalStepInfo) {
  if (s.approver) return s.approver.name;
  if (s.approverRole === "MANAGER") return `${s.branch ? `[${s.branch}] ` : ""}원장`;
  if (s.approverRole === "ADMIN") return "관리자";
  return "결재자";
}
function ApprovalChain({ steps, status }: { steps: ApprovalStepInfo[]; status?: string }) {
  if (!steps || steps.length === 0) return null;
  // 본인이 취소한 신청은 남은 단계가 닫히며(REJECTED · 「신청 취소」) 「관리자 반려」로 보였다 — 상태와 같은 말 「취소함」 하나로(2026-10-23 ■1)
  if (status === "CANCELLED") {
    const done = steps.filter((s) => s.status === "APPROVED");
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {done.length > 0 && <FlowDots steps={done.map((s) => ({ label: stepLabel(s), state: "done" as const }))} />}
        <span className="text-[13px] font-semibold text-[#475569]">취소함</span>
      </span>
    );
  }
  // 반려한 사람은 「반려」를 이름 옆에 붙인다 — 점 색만으로는 반려와 남음이 구분되지 않는다
  return <FlowDots steps={steps.map((s) => ({ label: s.status === "REJECTED" ? `${stepLabel(s)} 반려` : stepLabel(s), state: s.status === "APPROVED" ? "done" : s.status === "PENDING" ? "now" : "todo" }))} />;
}

/* ── 날짜 버튼(S1-3) — 「연도-월-일」 빈 칸 대신 「달력 11/5 (목)」 버튼. 누르면 달력(showPicker), 아이폰은 칸을 눌러 바로 열린다 ── */
function DateButton({ value, label, min, onChange }: { value: string; label: string; min?: string; onChange: (v: string) => void }) {
  return (
    <div className="relative flex-1">
      <span aria-hidden className={`flex min-h-11 items-center gap-2 rounded-[10px] border border-[#e2e8f0] bg-white px-3 py-2 text-[14.5px] font-semibold ${value ? "text-[#0f172a]" : "text-[#94a3b8]"}`}>
        <CalendarDays size={16} className="shrink-0 text-[#4f46e5]" />{value ? fmtDayShort(value) : label}
      </span>
      {/* 실제 날짜 칸은 버튼 위에 투명하게 겹친다 — 누르는 자리 전체가 칸이라 휴대폰은 그대로 열리고, PC 는 showPicker 로 연다 */}
      <input type="date" max="9999-12-31" value={value} min={min} required aria-label={label}
        onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* 지원하지 않는 브라우저는 기본 동작 */ } }}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
    </div>
  );
}

export default function LeavePage() {
  const leaveCat = useLeaveCatalog();   // 기본 + 본부가 만든 유형·숨김(GET /api/leave/types, #216-1) — 받으면 다시 그린다
  const [role, setRole]   = useState("EMPLOYEE");
  const [myId, setMyId]   = useState("");

  /* 신청 목록 */
  const [requests, setRequests]         = useState<LeaveRequest[]>([]);
  // 메일 링크(/leave?id=…)로 들어오면 그 건을 찾아 스크롤·강조한다
  const [highlightId, setHighlightId]   = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterYear, setFilterYear]     = useState(String(CURRENT_YEAR));
  const [filterMonth, setFilterMonth]   = useState("all");

  /* 잔여 현황 */
  const [balance, setBalance]       = useState<Balance | null>(null);
  // 잔여 숫자 숨김(2026-10-16 #219-1) — 서버가 balanceHidden 을 주면 숫자 자리에 「연차 정리 중」. 신청·잔여 초과 막기는 그대로
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [empBalances, setEmpBalances] = useState<EmpBalance[]>([]);
  // 숫자 칸 「대기」 — 결재를 기다리는 내 휴가 신청 수. 목록 필터(연·월·상태)와 따로 센다(관리자 R13 「휴가 현황」과 같은 방식)
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  /* 내 결재함 */
  const [mySteps, setMySteps]       = useState<MyStep[]>([]);

  /* 결재라인 설정 */
  const [lineUsers, setLineUsers]   = useState<LineUser[]>([]);
  const [allUsers, setAllUsers]     = useState<AllUser[]>([]);
  const [lineEditOpen, setLineEditOpen]   = useState(false);
  const [lineEditTarget, setLineEditTarget] = useState<LineUser | null>(null);
  const [lineSteps, setLineSteps]   = useState<AllUser[]>([]); // 편집 중인 결재자 목록
  const [userSearch, setUserSearch] = useState("");

  /* 휴가 신청 */
  const [addOpen, setAddOpen]   = useState(false);
  const [form, setForm]         = useState({ type: "ANNUAL", startDate: "", endDate: "", reason: "", attachmentUrl: "", attachmentName: "" });
  // 신청 일수·막힘은 서버 미리보기(GET /api/leave/days — 신청 검사와 같은 함수, 근무일정·공휴일 반영)로만(#219-10·11·12).
  // 종전 calcWorkdays 는 주말만 빼서 공휴일이 든 기간이 화면에서 하루 더 많게 보였다
  const daysPreview = useLeaveDaysPreview({ enabled: addOpen, type: form.type, start: form.startDate, end: form.endDate, singleDay: SINGLE_DAY_TYPES.has(form.type) });
  const canSubmit = previewAllowsSubmit(daysPreview);
  // 내년 날짜를 고르면 그 해 잔여를 따로 보여준다(9/11 디렉터) — 휴가는 쓰는 해(시작일) 연차에서 차감되고,
  // 서버 신청 검사와 같은 함수(yearBalanceFor)의 값을 받아 온다. 연도를 빨리 바꿔도 늦게 온 응답은 버린다.
  const reqYear = /^\d{4}-/.test(form.startDate) ? Number(form.startDate.slice(0, 4)) : 0;
  const [yearBal, setYearBal] = useState<{ year: number; b: Balance | null } | null>(null);
  useEffect(() => {
    if (!addOpen || reqYear <= kstYearNow()) { setYearBal(null); return; }
    let alive = true;
    fetch(`/api/leave/balance?scope=self&forLeave=1&year=${reqYear}&type=${encodeURIComponent(form.type)}`)
      .then(r => r.json())
      // 연차 미차감 유형(경조사·대체휴무 등)은 띄우지 않는다 — 판정은 서버(9/11 검증 E1)
      .then(d => { if (alive) setYearBal(d.deductible === false || d.balanceHidden ? null : { year: reqYear, b: d.balance ?? null }); })
      .catch(() => { if (alive) setYearBal(null); });
    return () => { alive = false; };
  }, [addOpen, reqYear, form.type]);

  /* 반려 다이얼로그 */
  const [rejectOpen, setRejectOpen]     = useState(false);
  const [rejectTarget, setRejectTarget] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  /* 잔여 조정 */
  const [editOpen, setEditOpen]     = useState(false);
  const [editTarget, setEditTarget] = useState<EmpBalance | null>(null);
  const [editForm, setEditForm]     = useState({ total: 15, used: 0 });

  // 개인 페이지: 역할과 무관하게 본인 휴가만 표시 (결재/관리는 관리자·원장 페이지에서)
  const isAdmin = false;

  /* ── 데이터 로드 ── */
  const fetchRequests = useCallback(async () => {
    const p = new URLSearchParams();
    if (filterStatus !== "all") p.set("status", filterStatus);
    p.set("year", filterYear);
    if (filterMonth !== "all") p.set("month", filterMonth);
    p.set("scope", "self");
    const data = await fetch(`/api/leave?${p}`).then(r => r.json());
    setRequests(data.requests || []);
  }, [filterStatus, filterYear, filterMonth]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setHighlightId(id);
  }, []);
  useEffect(() => {
    if (!highlightId || requests.length === 0) return;
    // 넓은 화면은 표 줄, 휴대폰은 카드 — 보이는 쪽으로(#219-16)
    const el = [document.getElementById(`leave-${highlightId}`), document.getElementById(`leave-card-${highlightId}`)]
      .find((e) => e && e.offsetParent !== null);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, requests]);

  const fetchBalance = useCallback(async () => {
    const data = await fetch("/api/leave/balance?scope=self").then(r => r.json());
    setBalanceHidden(!!data.balanceHidden);
    if (data.balance)  setBalance(data.balance);
    if (data.balances) setEmpBalances(data.balances);
  }, []);

  const fetchMySteps = useCallback(async () => {
    setMySteps([]);
  }, []);

  const fetchPending = useCallback(async () => {
    const data = await fetch("/api/leave?scope=self&status=PENDING").then(r => (r.ok ? r.json() : null)).catch(() => null);
    setPendingCount(data ? (data.requests || []).length : null);
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
  useEffect(() => { Promise.resolve().then(fetchPending); }, [fetchPending]);

  /* ── 휴가 신청 ── */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (daysPreview.status === "ok" && daysPreview.data.blocked) { toast.error(daysPreview.data.reason || "신청할 수 없습니다."); return; }
    if (!canSubmit) { toast.error("올바른 날짜 범위를 선택해주세요."); return; }
    // 사유는 증빙이 필요한 휴가만 필수(연차 등은 선택 — 서버 api/leave POST 와 같은 기준, 2026-10-23 ■1)
    if (leaveInfo(form.type)?.attachRequired && !form.reason.trim()) { toast.error("신청 사유를 입력해주세요."); return; }
    { const ti = leaveInfo(form.type); if (ti?.attachRequired && !form.attachmentUrl) { toast.error(`${ti.label}은(는) ${ti.attachRequired} 첨부가 필요합니다.`); return; } }
    const res  = await fetch("/api/leave", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success(`${data.days}일 휴가 신청이 완료되었습니다.`);
    setAddOpen(false);
    setForm({ type: "ANNUAL", startDate: "", endDate: "", reason: "", attachmentUrl: "", attachmentName: "" });
    fetchRequests(); fetchBalance(); fetchMySteps(); fetchPending();
  }

  const [uploading, setUploading] = useState(false);
  async function handleAttachUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setUploading(true);
    try {
      const res = await fetch("/api/work/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "첨부 업로드에 실패했습니다."); return; }
      setForm(f => ({ ...f, attachmentUrl: data.fileUrl, attachmentName: data.fileName }));
    } catch {
      toast.error("네트워크 오류로 올리지 못했습니다.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  /* ── 승인 ── */
  async function handleApprove(id: string) {
    // 잔여 부족이면 관리자는 한 번 더 확인하고 예외 승인(lib/leave-approve-client)
    const r = await postLeaveApprove(id);
    if (!r.ok) { if (!r.cancelled) toast.error(r.error); return; }
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
    if (!window.confirm("이 휴가 신청을 취소할까요?")) return;   // ⋮ 안 빨간 「신청 취소」 — 한 번 더 확인(관리자 R13과 같음)
    const res = await fetch(`/api/leave/${id}`, { method: "PATCH" });
    if (!res.ok) { toast.error((await res.json()).error); return; }
    toast.success("신청이 취소되었습니다.");
    fetchRequests(); fetchBalance(); fetchPending();
  }

  /* ── 취소 결재 (승인된 휴가 — 9/11 디렉터: 버튼으로 바로 취소하지 않고 관리자까지 결재) ── */
  async function handleRequestCancel(id: string) {
    const reason = window.prompt(
      "승인된 휴가의 취소 결재를 올립니다.\n관리자까지 승인되면 휴가가 취소되고 연차가 복구됩니다.\n\n취소 사유 (선택)",
      ""
    );
    if (reason === null) return;
    const res = await fetch(`/api/leave/${id}/cancel-request`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
    });
    if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error || "취소 요청을 올리지 못했습니다."); return; }
    toast.success("취소 결재를 올렸습니다. 관리자까지 승인되면 연차가 복구됩니다.");
    fetchRequests(); fetchBalance();
  }
  async function handleWithdrawCancel(cancelId: string) {
    if (!confirm("취소 요청을 철회할까요? 휴가는 그대로 유지됩니다.")) return;
    const res = await fetch(`/api/leave/cancel-requests/${cancelId}`, { method: "DELETE" });
    if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error || "철회하지 못했습니다."); return; }
    toast.success("취소 요청을 철회했습니다.");
    fetchRequests();
  }

  /* ── 잔여 조정 ── */
  async function handleEditSave() {
    if (!editTarget) return;
    const res = await fetch("/api/leave/balance", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: editTarget.userId, total: editForm.total, used: editForm.used }),
    });
    if (!res.ok) { toast.error((await res.json()).error); return; }
    toast.success("잔여 휴가가 조정되었습니다.");
    setEditOpen(false); fetchBalance();
  }

  /* ── 결재라인 편집 열기 ── */
  function openLineEdit(emp: LineUser) {
    setLineEditTarget(emp);
    setLineSteps(emp.approvalLine?.steps.map(s => s.approver as AllUser) ?? []);
    setUserSearch("");
    setLineEditOpen(true);
  }

  /* ── 결재라인 저장 ── */
  async function handleLineSave() {
    if (!lineEditTarget) return;
    const res = await fetch(`/api/approval-line/${lineEditTarget.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approverIds: lineSteps.map(u => u.id) }),
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

  /* ── 신청 내역 칸(표·카드 공용, #219-16) — 원래 표 칸에 있던 그대로. 모양만 둘이고 내용·조건은 여기 하나 ── */
  // 「10월 5일 (월) ~ 7일 (수)」 — 해가 바뀌는 기간만 연도(lib/leave-period, ■4)
  const leavePeriod = (r: LeaveRequest) => <>{fmtRangeKo(r.startDate, r.endDate)}</>;
  const leaveApproval = (r: LeaveRequest) => (
    <>
      {r.approvalSteps && r.approvalSteps.length > 0
        ? <ApprovalChain steps={r.approvalSteps} status={r.status} />
        : <span className="text-[13px] text-[#94a3b8]">—</span>}
      {r.status === "REJECTED" && r.rejectedReason && (
        <p className="mt-0.5 text-[12.5px] font-semibold text-[#be123c]">반려: {r.rejectedReason}</p>
      )}
    </>
  );
  // 첨부 증빙 — 관리자 R13과 같은 글자 링크(이모지 없음). 열람 권한은 /uploads 쪽이 판정한다
  const leaveAttach = (r: LeaveRequest) => r.attachmentUrl ? (
    <a href={r.attachmentUrl} target="_blank" rel="noreferrer" title={r.attachmentName || "첨부 보기"}
      className="inline-block max-w-[14rem] truncate align-bottom text-[12.5px] font-semibold text-[#4f46e5] hover:underline">첨부 · {r.attachmentName || "첨부 보기"}</a>
  ) : null;
  const leaveStatus = (r: LeaveRequest) => {
    const s = STATUS_CFG[r.status] ?? STATUS_CFG.CANCELLED;
    return (
      <>
        <StatusPill tone={s.tone}>{s.label}</StatusPill>
        {r.pendingCancel && <span className="mt-0.5 block whitespace-nowrap text-[12px] font-semibold text-[#b45309]">취소 결재 중</span>}
        {/* 원장이 승인해 본부 결재만 남은 건 — 취소가 이유 없이 사라지지 않게 알려 준다(2026-10-06) */}
        {r.cancelBlock === "IN_REVIEW" && (
          <span className="mt-0.5 block text-[12px] text-[#596578]" title="취소가 필요하면 원장·본부에 반려를 요청해 주세요">원장 승인됨 · 취소는 원장·본부에 요청</span>
        )}
      </>
    );
  };
  // 처리 — 관리자 R13과 같은 줄 끝 ⋮(첨부 보기 · 취소 요청 · 취소 요청 철회 · 맨 아래 빨간 「신청 취소」).
  // 취소 가능 여부는 서버가 판정해 내려준다(lib/leave-cancel.ts) — 화면이 조건을 따로 들고 있으면 누르면 403 인 버튼이 생긴다.
  // 승인된 휴가는 **취소 결재로만**(canRequestCancel). 관리자의 대기 건에는 확인창 없는 취소를 두지 않는다(승인·반려 옆에서 잘못 누르기 쉽다)
  const leaveActions = (r: LeaveRequest) => {
    const pendingAdmin = isAdmin && r.status === "PENDING";
    const more: MoreItem[] = [
      { label: "첨부 보기", onClick: () => window.open(r.attachmentUrl!, "_blank", "noopener"), hidden: !r.attachmentUrl },
      { label: "취소 요청", onClick: () => handleRequestCancel(r.id), hidden: !r.canRequestCancel },
      { label: "취소 요청 철회", onClick: () => handleWithdrawCancel(r.pendingCancel!.id), hidden: !r.pendingCancel?.mine },
      { label: "반려", onClick: () => openReject(r.id), danger: true, hidden: !pendingAdmin },
      { label: "신청 취소", onClick: () => handleCancel(r.id), danger: true, hidden: !r.canCancel || pendingAdmin },
    ];
    if (!pendingAdmin && more.every(i => i.hidden)) return null;   // 카드에서 빈 줄이 생기지 않게
    return (
      <div className="flex items-center justify-end gap-1">
        {pendingAdmin && <Btn kind="text" onClick={() => handleApprove(r.id)}>승인</Btn>}
        <MoreMenu items={more} />
      </div>
    );
  };

  /* ── 렌더 ── */
  // 메일 링크(/leave?id=…)로 들어온 건 강조 — 연노랑 바탕 + 테두리
  const highlightCls = (id: string) => highlightId === id ? "bg-[#fffbeb] ring-2 ring-inset ring-[#fcd34d]" : "hover:bg-[#fafbfd]";
  return (
    <div>
      {/* 머리 — 왼쪽 메뉴 이름 「내 휴가」 + 인디고 「＋ 휴가 신청」 하나 */}
      <PageHead crumb="휴가 › 내 휴가" title="내 휴가">
        <Btn kind="primary" onClick={() => setAddOpen(true)}><Plus size={15} />휴가 신청</Btn>
      </PageHead>

      {/* 숫자 칸(직원 내 휴가 — 남은 연차 · 올해 사용 · 대기). 잔여 숫자 숨김(#219-1)이면 남은 연차 = 「연차 정리 중」,
          올해 사용 = 「—」(서버가 숫자를 주지 않는다). 신청·잔여 초과 막기는 그대로 */}
      {!isAdmin && (
        <Box icon={<CalendarDays />} tone="amb" title="나의 연차" sub={`${kstYearNow()}년`}
          right={<a href="/leave/ledger" className="text-[#4f46e5] hover:underline">연차 대장 보기 ›</a>}>
          <Tiles cols={3}>
            <Tile label="남은 연차" value={balanceHidden ? "연차 정리 중" : balance ? balance.remaining : null} unit={balanceHidden ? undefined : "일"}
              note={balanceHidden ? "시프티 사용 내역을 옮기는 중 · 휴가 신청은 그대로 됩니다" : balance ? `총 ${balance.total}일` : undefined} />
            <Tile label="올해 사용" value={balanceHidden ? null : balance ? balance.used : null} unit="일"
              note={balanceHidden ? "연차 정리 중" : "연차에서 차감된 일수"} />
            <Tile label="대기" value={pendingCount} unit="건" note="결재를 기다리는 신청" hl />
          </Tiles>
        </Box>
      )}

      {/* 알약 탭 없음(직원은 신청 목록 하나) — 아래 관리자용 탭 내용은 isAdmin 이 거짓이라 그려지지 않는다 */}
      <Tabs value="list">
        {/* ═══ 신청 목록 ═══ */}
        <TabsContent value="list">
          <Box icon={<ClipboardList />} tone="sky" title="신청 목록" sub={`${requests.length}건`} className="!mb-0">
            <FilterRow right={[
              { value: "all", label: "전체" },
              { value: "PENDING",   label: "대기" },
              { value: "APPROVED",  label: "승인" },
              { value: "REJECTED",  label: "반려" },
              { value: "CANCELLED", label: "취소" },
            ].map(({ value, label }) => <Chip key={value} on={filterStatus === value} onClick={() => setFilterStatus(value)}>{label}</Chip>)}>
              <select value={filterYear} onChange={e => { setFilterYear(e.target.value); setFilterMonth("all"); }} aria-label="연도" className={inputClass}>
                {YEARS.map(y => <option key={y} value={String(y)}>{y}년</option>)}
              </select>
              <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} aria-label="월" className={inputClass}>
                <option value="all">전체 월</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={String(m)}>{m}월</option>)}
              </select>
            </FilterRow>

            {/* 신청 내역 — 넓은 화면은 표, 휴대폰(md 미만)은 카드(2026-10-16 이예지 QA #219-16 — 390px 에서 결재 현황·상태·처리 칸이 잘렸다).
                두 모양이 같은 칸 함수(leaveApproval·leaveStatus·leaveActions)를 쓴다 — 버튼 동작·조건을 한 곳에서만 고친다 */}
            {requests.length === 0 ? (
              <div className="py-16 text-center text-[14px] text-[#596578]">
                <UmbrellaOff size={32} className="mx-auto mb-2 opacity-30" />신청 내역이 없습니다.
                {/* 빈 화면에도 그 화면의 버튼을(■4) */}
                <div className="mt-3"><Btn kind="primary" onClick={() => setAddOpen(true)}><Plus size={15} />휴가 신청</Btn></div>
              </div>
            ) : (<>
              <div className="hidden overflow-x-auto md:block">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      {isAdmin && <th>직원</th>}
                      <th className="whitespace-nowrap">유형</th>
                      <th>기간</th>
                      <th className="whitespace-nowrap">일수</th>
                      <th>결재</th>
                      <th>상태</th>
                      <th className="w-24"><span className="sr-only">처리</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map(r => (
                      <tr key={r.id} id={`leave-${r.id}`} className={`transition-colors ${highlightCls(r.id)}`}>
                        {isAdmin && (
                          <td>
                            <p className="font-bold text-[#0f172a]">{r.user.name}</p>
                            <p className="text-[12.5px] text-[#596578]">{r.user.department}</p>
                          </td>
                        )}
                        <td className="whitespace-nowrap font-semibold text-[#0f172a]">
                          {TYPE_LABEL[r.type] ?? r.type}
                          {r.attachmentUrl && <div>{leaveAttach(r)}</div>}
                        </td>
                        <td className="whitespace-nowrap text-[#475569]">{leavePeriod(r)}</td>
                        <td className="whitespace-nowrap text-[#475569] tabular-nums">{r.days}일</td>
                        <td>{leaveApproval(r)}</td>
                        <td>{leaveStatus(r)}</td>
                        <td className="text-right">{leaveActions(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-[#f1f5f9] md:hidden">
                {requests.map(r => (
                  <div key={r.id} id={`leave-card-${r.id}`} className={`px-4 py-3 ${highlightId === r.id ? "bg-[#fffbeb] ring-2 ring-inset ring-[#fcd34d]" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {isAdmin && <p className="text-[12.5px] text-[#596578]">{r.user.name}{r.user.department ? ` · ${r.user.department}` : ""}</p>}
                        <p className="font-bold text-[#0f172a]">{TYPE_LABEL[r.type] ?? r.type} <span className="text-[13px] font-normal text-[#596578]">· {r.days}일</span></p>
                        <p className="text-[13.5px] text-[#475569]">{leavePeriod(r)}</p>
                        {leaveAttach(r)}
                      </div>
                      <div className="shrink-0 text-right">{leaveStatus(r)}</div>
                    </div>
                    <div className="mt-2">{leaveApproval(r)}</div>
                    <div className="mt-1 empty:hidden">{leaveActions(r)}</div>
                  </div>
                ))}
              </div>
            </>)}
          </Box>
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
                      <th className="px-4 py-3 font-medium">직원</th>
                      <th className="px-4 py-3 font-medium">결재라인</th>
                      <th className="px-4 py-3 font-medium w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineUsers.map(emp => (
                      <tr key={emp.id} className="border-b last:border-0 hover:bg-gray-50/70">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{emp.name}</p>
                          <p className="text-xs text-gray-400">{emp.department} · {emp.position}</p>
                        </td>
                        <td className="px-4 py-3">
                          {emp.approvalLine && emp.approvalLine.steps.length > 0 ? (
                            <div className="flex items-center gap-1 flex-wrap">
                              {emp.approvalLine.steps.map((s, i) => (
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
                            <span className="text-xs text-gray-400">미설정 (관리자 직접 승인)</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-gray-400 hover:text-gray-700"
                            onClick={() => openLineEdit(emp)}>
                            <Pencil size={12} />설정
                          </Button>
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
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-600 font-medium">
                  전체 {empBalances.length}명 · {CURRENT_YEAR}년 기준
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-gray-500 bg-gray-50/60 text-left">
                      <th className="px-4 py-3 font-medium">직원</th>
                      <th className="px-4 py-3 font-medium">총 연차</th>
                      <th className="px-4 py-3 font-medium">사용</th>
                      <th className="px-4 py-3 font-medium w-48">잔여</th>
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
                          </td>
                          <td className="px-4 py-3 text-gray-700 font-medium">{b.total}일</td>
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
                          <td className="px-4 py-3">
                            <Button variant="ghost" size="sm" className="h-7 gap-1 text-gray-400 hover:text-gray-700"
                              onClick={() => { setEditTarget(b); setEditForm({ total: b.total, used: b.used }); setEditOpen(true); }}>
                              <Pencil size={12} />조정
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
            {!isAdmin && (balanceHidden || balance) && (
              <div className="flex items-center justify-between rounded-[10px] border border-[#eef1f5] bg-[#f8fafc] px-4 py-2.5">
                <span className="text-[13.5px] font-semibold text-[#475569]">{yearBal ? `${kstYearNow()}년 잔여 연차` : "잔여 연차"}</span>
                <span className="font-bold text-[#0f172a]">{balanceHidden ? "연차 정리 중" : `${balance?.remaining}일`}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label>휴가 유형 *</Label>
              <Select value={form.type} onValueChange={v =>
                v && setForm(f => ({ ...f, type: v, endDate: SINGLE_DAY_TYPES.has(v) ? f.startDate : f.endDate }))
              }>
                {/* 목록 폭을 창 폭에 맞춘다(#219-9 — 설명 「유급 8h · 1…」이 잘렸다). 이 화면의 선택칸만 — 공용 select 는 그대로 */}
                <SelectTrigger className="w-full"><SelectValue>{TYPE_LABEL[form.type] ?? form.type}</SelectValue></SelectTrigger>
                <SelectContent className="min-w-[min(22rem,calc(100vw-2rem))]">
                  {/* 그룹별 — 기준표의 신청 목록(병가·옛 경조 세부 유형은 없음) */}
                  {leaveCat.groups.map((g, gi) => {
                    const items = leaveCat.catalog.filter((t) => t.selectable && t.group === g);
                    if (!items.length) return null;
                    return (
                      <div key={g}>
                        <div className={`px-2 py-1 text-xs text-gray-400 font-medium ${gi ? "border-t mt-1 pt-2" : ""}`}>{g}</div>
                        {items.map((t) => (
                          <SelectItem key={t.code} value={t.code}>
                            <span className="flex items-center justify-between w-full gap-4">
                              <span>{t.label}</span>
                              <span className="text-xs text-gray-400 whitespace-normal text-right">
                                {FIXED_DAYS[t.code] ? `${FIXED_DAYS[t.code]}일 ` : ""}{t.paidHours ? `유급 ${t.paidHours}h` : "무급"}{!t.deducts && " · 연차 미차감"}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </div>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            {/* 날짜 — 「연도-월-일」 빈 칸 대신 달력 버튼(누르면 달력, S1-3). 하루짜리 유형(반차 등)은 하루만 고르면 끝 */}
            {SINGLE_DAY_TYPES.has(form.type) ? (
              <div className="space-y-2">
                <Label>날짜 *</Label>
                <DateButton value={form.startDate} label="날짜 고르기"
                  onChange={v => setForm(f => ({ ...f, startDate: v, endDate: v }))} />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>날짜 *</Label>
                <div className="flex items-center gap-2">
                  <DateButton value={form.startDate} label="시작일"
                    onChange={v => setForm(f => ({ ...f, startDate: v, endDate: !f.endDate || f.endDate < v ? v : f.endDate }))} />
                  <span className="text-[#94a3b8]">~</span>
                  <DateButton value={form.endDate} label="종료일" min={form.startDate}
                    onChange={v => setForm(f => ({ ...f, endDate: v }))} />
                </div>
                <p className="text-[12.5px] text-[#596578]">하루만 쉬면 시작일만 고르면 됩니다.</p>
              </div>
            )}
            {/* 「연차 2일 사용 → 남은 연차 15일」(S1-3) — 서버 미리보기 값 그대로. 잔여 숫자 숨김(#219-1)이면 일수만 */}
            {daysPreview.status === "ok" && daysPreview.data.days > 0 && !daysPreview.data.blocked && leaveInfo(form.type)?.deducts && (() => {
              const d = daysPreview.data;
              // 연도를 걸친 휴가(해마다 몫이 둘 이상)는 남은 일수를 한 숫자로 말할 수 없어 일수만 — 해마다 몫은 아래 칸이 보여 준다
              const split = (d.limit?.years?.length ?? 0) > 1;
              const avail = !d.balanceHidden && !balanceHidden && !split && d.limit?.kind === "annual" ? d.limit.available : null;
              return (
                <div className="rounded-[10px] bg-[#eef2ff] px-4 py-2.5 text-[14px] font-bold text-[#4338ca]">
                  연차 {d.days}일 사용{avail !== null && avail !== undefined ? ` → 남은 연차 ${Math.round((avail - d.days) * 100) / 100}일` : ""}
                </div>
              );
            })()}
            {yearBal && (
              <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
                <span className="text-sm text-amber-800">
                  {yearBal.year}년 잔여 연차
                  {/* 연도를 걸친 휴가면 이 줄은 숨긴다 — 아래 신청 일수 칸의 「날짜별로 그 해 연차에서 차감」 안내 하나만(2026-10-19) */}
                  {!(form.endDate && form.endDate.slice(0, 4) !== form.startDate.slice(0, 4)) && (
                    <span className="block text-xs text-amber-600">{yearBal.year}년 휴가는 {yearBal.year}년 연차에서 차감됩니다</span>
                  )}
                </span>
                <span className="font-bold text-amber-900">{yearBal.b ? `${yearBal.b.remaining}일` : "—"}</span>
              </div>
            )}
            <LeaveDaysPreviewBox state={daysPreview} fixed={!!FIXED_DAYS[form.type]} />
            <div className="space-y-2">
              {leaveInfo(form.type)?.attachRequired
                ? <Label>사유 <span className="text-red-500">*</span></Label>
                : <Label>사유 <span className="text-gray-400 font-normal text-xs">(선택)</span></Label>}
              <Textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                placeholder={leaveInfo(form.type)?.attachRequired ? "신청 사유를 적어 주세요 (필수)" : "적지 않아도 됩니다"} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>
                첨부파일{leaveInfo(form.type)?.attachRequired
                  ? <span className="text-red-500"> ({leaveInfo(form.type)?.attachRequired} 필수)</span>
                  : <span className="text-gray-400 font-normal text-xs"> (선택)</span>}
              </Label>
              {leaveInfo(form.type)?.notice && <p className="text-xs text-gray-500">{leaveInfo(form.type)?.notice}</p>}
              {form.attachmentUrl ? (
                <div className="flex items-center gap-2 rounded-[10px] border border-[#c7d2fe] bg-[#eef2ff] px-3 py-2 text-sm">
                  <span className="flex-1 truncate text-[#334155]">{form.attachmentName}</span>
                  <button type="button" aria-label="첨부 빼기" className="text-[#94a3b8] hover:text-[#dc2626]"
                    onClick={() => setForm(f => ({ ...f, attachmentUrl: "", attachmentName: "" }))}><X size={15} /></button>
                </div>
              ) : (
                // 「파일 선택 선택된 파일 없음」 기본 칸 대신 버튼 하나(■1 · ■4). 실제 input 은 숨기고 label 로 연다
                <label className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-[#e2e8f0] bg-white px-4 py-2 text-[14px] font-semibold text-[#4f46e5] hover:bg-[#f8fafc] ${uploading ? "pointer-events-none opacity-60" : ""}`}>
                  <Paperclip size={15} />{uploading ? "올리는 중…" : "사진 · 파일 올리기"}
                  <input type="file" accept="image/*,.pdf,.doc,.docx,.hwp" onChange={handleAttachUpload} className="sr-only" disabled={uploading} />
                </label>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Btn onClick={() => setAddOpen(false)}>취소</Btn>
              <Btn kind="primary" type="submit" disabled={!canSubmit}>신청</Btn>
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

      {/* ═══ 결재라인 편집 다이얼로그 ═══ */}
      <Dialog open={lineEditOpen} onOpenChange={setLineEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch size={18} />
              결재라인 설정 — {lineEditTarget?.name}
              {lineEditTarget?.department && (
                <span className="text-sm font-normal text-gray-400">({lineEditTarget.department})</span>
              )}
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
