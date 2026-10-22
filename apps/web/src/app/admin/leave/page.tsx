"use client";

import { LEAVE_LABELS, leaveInfo, LIVE_SINGLE_DAY, LIVE_FIXED_DAYS } from "@/lib/leave-catalog";
import { useLeaveCatalog } from "@/components/leave/useLeaveCatalog";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLeaveDaysPreview } from "@/components/leave/useLeaveDaysPreview";
import LeaveDaysPreviewBox, { previewAllowsSubmit } from "@/components/leave/LeaveDaysPreviewBox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  UmbrellaOff, Plus, X, AlertCircle, CalendarDays,
  ClipboardList, Pencil, GitBranch,
  Trash2, Search, ArrowUp, ArrowDown, RefreshCw, Calculator,
  Upload, Download,
} from "lucide-react";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import { getPermissionSummary, type UserRole } from "@/lib/permissions";
import LeaveTabs, { isLeaveTab, type LeaveTab } from "@/components/leave/LeaveTabs";
import { PageHead, Btn, Box, Tiles, Tile, FilterRow, Chip, inputClass, tableClass, Cell2, StatusPill, FlowDots, MoreMenu, type PillTone, type MoreItem } from "@/components/kit";
import LeaveReport from "@/components/leave/LeaveReport";
import LeaveGrantBoard from "@/components/leave/LeaveGrantBoard";
import LeaveImport from "@/components/leave/LeaveImport";
import LeaveSettlement from "@/components/leave/LeaveSettlement";
import { postLeaveApprove } from "@/lib/leave-approve-client";

/* ── 타입 ── */
type ApprovalStepInfo = {
  id: string; order: number; status: string;
  approver: { id: string; name: string; position: string | null } | null;
  approverRole?: string | null; branch?: string | null;
  comment?: string | null;
};
// 역할 기반 단계 라벨: 결재자 미정 시 역할/지점으로 표시
function stepLabel(s: { approver: { name: string } | null; approverRole?: string | null; branch?: string | null }) {
  if (s.approver) return s.approver.name;
  if (s.approverRole === "MANAGER") return `${s.branch ? `[${s.branch}] ` : ""}원장`;
  if (s.approverRole === "ADMIN") return "관리자";
  return "결재자";
}
type LeaveRequest = {
  id: string; type: string; startDate: string; endDate: string;
  days: number; reason: string | null; status: string;
  rejectedReason: string | null;
  user: { id?: string; name: string; department: string | null; branch?: string | null };
  approver: { name: string } | null;
  approvalSteps?: ApprovalStepInfo[];
  canCancel?: boolean;   // 서버 판정(lib/leave-cancel.ts)
  canRequestCancel?: boolean;   // 취소 결재를 올릴 수 있나(본인·승인건·시작 전날까지 — 서버 판정)
  pendingCancel?: { id: string; mine: boolean } | null;   // 진행 중인 취소 결재
  attachmentUrl?: string | null;    // 신청 때 붙인 증빙(선택) — GET /api/leave 가 그대로 내려준다
  attachmentName?: string | null;
};
type Balance  = { total: number; used: number; remaining: number };
type EmpBalance = {
  userId: string; name: string; email?: string; department: string | null; position: string | null;
  branch?: string | null; hireDate?: string | null; tenure?: string; recommended?: number | null; accrualBasis?: string | null; leaveNote?: string | null;
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
const TYPE_LABEL: Record<string, string> = LEAVE_LABELS;   // 공용 객체(복사 아님) — useLeaveCatalog 가 본부 유형 이름을 채운다(#216-1)
// 하루짜리·고정 일수·미차감 — 기준표(lib/leave-catalog.ts, 본부 답변 #19)에서. 직원 신청 화면과 같은 표
// 공용 라이브 객체(lib/leave-catalog) — useLeaveCatalog 가 본부 유형까지 채운다(#216-1). 복사하면 새 유형이 빠진다
const SINGLE_DAY_TYPES = LIVE_SINGLE_DAY;
const FIXED_DAYS: Record<string, number> = LIVE_FIXED_DAYS;
const STATUS_CFG: Record<string, { label: string; tone: PillTone }> = {
  PENDING:   { label: "대기", tone: "wait" },
  APPROVED:  { label: "승인", tone: "done" },
  REJECTED:  { label: "반려", tone: "rej" },
  CANCELLED: { label: "취소", tone: "gray" },
};

const CURRENT_YEAR = new Date().getFullYear();
// 내년도 둔다 — 12월에 승인된 내년 휴가를 1월 전에도 볼 수 있게(휴가를 쓰는 해 기준, 9/11 검증 D3)
const YEARS        = [CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

/* ── 결재 진행 점(kit FlowDots) — 끝난 사람 파랑 · 지금 차례 주황 · 남은 사람 회색 ── */
function ApprovalChain({ steps }: { steps: ApprovalStepInfo[] }) {
  if (!steps || steps.length === 0) return null;
  return <FlowDots steps={steps.map((s) => ({ label: stepLabel(s), state: s.status === "APPROVED" ? "done" : s.status === "PENDING" ? "now" : "todo" }))} />;
}

export default function LeavePage() {
  const leaveCat = useLeaveCatalog();   // 기본 + 본부가 만든 유형·숨김(GET /api/leave/types, #216-1) — 받으면 다시 그린다
  const [role, setRole]   = useState("EMPLOYEE");
  const [myId, setMyId]   = useState("");

  /* 신청 목록 */
  const [requests, setRequests]         = useState<LeaveRequest[]>([]);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterYear, setFilterYear]     = useState(String(CURRENT_YEAR));
  const [filterMonth, setFilterMonth]   = useState("all");
  // 목록 검색(#85) — 이름·지점·유형·사유. 불러온 목록 안에서 거른다
  const [listQuery, setListQuery]       = useState("");

  /* 잔여 현황 */
  const [balance, setBalance]       = useState<Balance | null>(null);
  const [empBalances, setEmpBalances] = useState<EmpBalance[]>([]);

  /* 내 결재 대기(숫자 칸 「승인 대기」) — 처리는 결재 › 결재함에서 */
  const [mySteps, setMySteps]       = useState<MyStep[]>([]);

  /* 알약 탭(R13) — ?tab= 으로 들어오면 그 탭(휴가 유형 화면에서 돌아올 때) */
  const [tab, setTab] = useState<LeaveTab>("list");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    Promise.resolve().then(() => { if (isLeaveTab(t)) setTab(t); });
  }, []);
  /* 「휴가 한눈에」 — 오늘 휴가(승인·오늘 걸친 사람 수) · 이번 달 사용(이번 달 시작·승인 일수 합). 목록 필터와 따로 센다 */
  const [glance, setGlance] = useState<{ today: number | null; month: number | null }>({ today: null, month: null });

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
  // targetUserId — 본부 대리 등록(#37). 비우면 본인 신청
  const [form, setForm]         = useState({ type: "ANNUAL", startDate: "", endDate: "", reason: "", attachmentUrl: "", attachmentName: "", targetUserId: "" });
  // 신청 일수·막힘은 서버 미리보기(GET /api/leave/days — 신청 검사와 같은 함수, 근무일정·공휴일 반영, #219-10·11·12).
  // 대리 등록이면 그 직원의 근무일정·잔여로 센다
  const daysPreview = useLeaveDaysPreview({ enabled: addOpen, type: form.type, start: form.startDate, end: form.endDate, singleDay: SINGLE_DAY_TYPES.has(form.type), userId: form.targetUserId || undefined });
  const canSubmit = previewAllowsSubmit(daysPreview);

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

  // 관리자(서브 포함) 포함 여부 — 관리자는 본부 소속이라 기본 미포함. 선택은 브라우저에 기억된다
  // + 테스트 지점(지점 관리에서 「통계 포함」을 끈 지점) 포함 여부 — 기본 미포함(2026-10-06). 둘 다 브라우저에 기억
  const [incl, setIncl] = useState({ admins: false, test: false });
  useEffect(() => {
    setIncl({
      admins: localStorage.getItem("leaveBalanceInclAdmins") === "1",
      test: localStorage.getItem("leaveInclTest") === "1",
    });
  }, []);
  const inclAdmins = incl.admins, inclTest = incl.test;
  const toggleInclAdmins = (v: boolean) => {
    setIncl((x) => ({ ...x, admins: v }));
    localStorage.setItem("leaveBalanceInclAdmins", v ? "1" : "0");
  };
  const toggleInclTest = (v: boolean) => {
    setIncl((x) => ({ ...x, test: v }));
    localStorage.setItem("leaveInclTest", v ? "1" : "0");
  };

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
    const p = new URLSearchParams();
    if (inclAdmins) p.set("includeAdmins", "true");
    if (inclTest) p.set("includeTest", "true");
    const q = p.toString() ? `?${p}` : "";
    const data = await fetch(`/api/leave/balance${q}`).then(r => r.json());
    if (data.balance)  setBalance(data.balance);
    if (data.balances) setEmpBalances(data.balances);
  }, [inclAdmins, inclTest]);

  const fetchGlance = useCallback(async () => {
    const now = new Date(Date.now() + 9 * 3600 * 1000);   // 한국 날짜(UTC 면 오전 9시 전엔 어제)
    const today = now.toISOString().slice(0, 10);
    const get = (q: string) => fetch(`/api/leave?${q}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const [cur, mon] = await Promise.all([
      get("current=1&status=APPROVED"),
      get(`status=APPROVED&year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`),
    ]);
    const ymd = (v: string) => v.slice(0, 10);   // @db.Date = UTC 자정
    const todayIds = cur
      ? new Set((cur.requests as LeaveRequest[]).filter(r => ymd(r.startDate) <= today && ymd(r.endDate) >= today).map(r => r.user.id ?? r.user.name))
      : null;
    const monthDays = mon ? (mon.requests as LeaveRequest[]).reduce((sum, r) => sum + (Number(r.days) || 0), 0) : null;
    setGlance({ today: todayIds ? todayIds.size : null, month: monthDays === null ? null : Math.round(monthDays * 100) / 100 });
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
  useEffect(() => { fetchGlance();       }, [fetchGlance]);
  // 결재라인 탭은 결재 › 결재 규칙으로 옮겼지만(R13), 이 조회가 「휴가 등록」 창 대상 직원 목록(allUsers)도 채운다 — 지우면 대리 등록이 막힌다(검증)
  useEffect(() => { fetchApprovalLines();}, [fetchApprovalLines]);

  /* ── 휴가 신청 ── */
  const [submitting, setSubmitting] = useState(false);   // 두 번 눌러 두 건이 생기지 않게(대리 등록은 바로 승인·차감)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (daysPreview.status === "ok" && daysPreview.data.blocked) { toast.error(daysPreview.data.reason || "신청할 수 없습니다."); return; }
    if (!canSubmit) { toast.error("올바른 날짜 범위를 선택해주세요."); return; }
    { const ti = leaveInfo(form.type); if (ti?.attachRequired && !form.attachmentUrl && !form.targetUserId) { toast.error(`${ti.label}은(는) ${ti.attachRequired} 첨부가 필요합니다.`); return; } }
    setSubmitting(true);
    let res: Response, data: { error?: string; days?: number; proxy?: boolean };
    try {
      res  = await fetch("/api/leave", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      toast.error("네트워크 오류로 신청하지 못했습니다."); return;
    } finally {
      setSubmitting(false);
    }
    if (!res.ok) { toast.error(data.error || "신청하지 못했습니다."); return; }
    toast.success(data.proxy ? `${data.days}일 휴가를 등록·승인했습니다. 직원에게 알림을 보냈습니다.` : `${data.days}일 휴가 신청이 완료되었습니다.`);
    setAddOpen(false);
    setForm({ type: "ANNUAL", startDate: "", endDate: "", reason: "", attachmentUrl: "", attachmentName: "", targetUserId: "" });
    fetchRequests(); fetchBalance(); fetchMySteps(); fetchGlance();
  }

  // 첨부(동의서·증빙) — 직원 신청 화면과 같은 업로드 경로
  async function handleAttachUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/work/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error || "첨부 업로드에 실패했습니다."); return; }
    setForm(f => ({ ...f, attachmentUrl: data.fileUrl, attachmentName: data.fileName }));
    e.target.value = "";
  }

  /* ── 승인 ── */
  async function handleApprove(id: string) {
    // 잔여 부족이면 관리자는 한 번 더 확인하고 예외 승인(lib/leave-approve-client)
    const r = await postLeaveApprove(id);
    if (!r.ok) { if (!r.cancelled) toast.error(r.error); return; }
    toast.success("승인되었습니다.");
    fetchRequests(); fetchBalance(); fetchMySteps(); fetchGlance();
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
    if (!window.confirm("이 휴가 신청을 취소할까요?")) return;   // ⋮ 안으로 옮기며 확인 한 번(옆 메뉴와 헷갈리지 않게)
    const res = await fetch(`/api/leave/${id}`, { method: "PATCH" });
    if (!res.ok) { toast.error((await res.json()).error); return; }
    toast.success("신청이 취소되었습니다.");
    fetchRequests(); fetchBalance(); fetchGlance();
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
      body: JSON.stringify({ userId: editTarget.userId, total: editForm.total, used: editForm.used, leaveNote: editForm.leaveNote }),
    });
    if (!res.ok) { toast.error((await res.json()).error); return; }
    toast.success("잔여 휴가가 조정되었습니다.");
    setEditOpen(false); fetchBalance();
  }

  /* ── 연차 일괄 업로드 (이름/이메일/연차 엑셀 → 미리보기 → 적용) ── */
  type BulkRow = {
    name: string; email: string; total: number | null;
    systemName?: string; prevTotal?: number | null; used?: number; newRemaining?: number;
    status: "ok" | "name_mismatch" | "not_found" | "invalid"; message?: string;
  };
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFileName, setBulkFileName] = useState("");
  const [bulkPreview, setBulkPreview] = useState<BulkRow[] | null>(null);
  const [bulkApplying, setBulkApplying] = useState(false);

  function downloadBulkTemplate() {
    const data = empBalances.length
      ? empBalances.map(b => ({ 이름: b.name, 이메일: b.email || "", 연차: b.total }))
      : [{ 이름: "홍길동", 이메일: "hong@cubetee.co.kr", 연차: 15 }];
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "연차");
    XLSX.writeFile(wb, `연차_일괄업로드_${CURRENT_YEAR}.xlsx`);
  }

  async function handleBulkFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const workbook = XLSX.read(buf, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const pick = (row: Record<string, unknown>, keys: string[]) => {
        for (const k of keys) if (row[k] !== undefined && row[k] !== "") return row[k];
        return undefined;
      };
      const rows = json.map(r => ({
        name: pick(r, ["이름", "성명", "직원명"]) ?? "",
        email: pick(r, ["이메일", "이메일 주소", "이메일주소", "email", "Email", "E-mail"]) ?? "",
        total: pick(r, ["연차", "총 연차", "총연차", "연차수", "연차 수", "잔여 연차", "잔여연차", "남은 연차", "남은연차"]),
      })).filter(r => r.email || r.name);
      if (!rows.length) { toast.error("읽을 수 있는 행이 없습니다. 이름/이메일/연차 컬럼명을 확인해주세요."); return; }
      const res = await fetch("/api/leave/balance/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, apply: false }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || "파일 확인에 실패했습니다."); return; }
      setBulkFileName(file.name);
      setBulkPreview(d.results);
    } catch {
      toast.error("파일을 읽지 못했습니다. 엑셀(.xlsx) 파일인지 확인해주세요.");
    }
  }

  async function applyBulk() {
    if (!bulkPreview) return;
    const rows = bulkPreview
      .filter(r => r.status === "ok" || r.status === "name_mismatch")
      .map(r => ({ name: r.name, email: r.email, total: r.total }));
    if (!rows.length) { toast.error("적용할 수 있는 행이 없습니다."); return; }
    setBulkApplying(true);
    try {
      const res = await fetch("/api/leave/balance/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, apply: true }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || "적용에 실패했습니다."); return; }
      toast.success(`${d.applied}명의 연차를 적용했습니다.`);
      setBulkOpen(false); setBulkPreview(null); setBulkFileName("");
      fetchBalance();
    } finally { setBulkApplying(false); }
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

  /* ── 연차 연도 전환 (소멸 + 신년도 재부여) ── */
  const [rollingOver, setRollingOver] = useState(false);
  async function rolloverYear() {
    if (!window.confirm(
      `${CURRENT_YEAR}년도로 연차를 전환합니다.\n` +
      `전년도 잔여 연차는 소멸되고, 근속 기간 기준으로 새로 부여됩니다.\n` +
      `(이미 올해 연차가 있는 직원은 건드리지 않습니다)\n진행할까요?`
    )) return;
    setRollingOver(true);
    try {
      const res = await fetch("/api/leave/rollover", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: CURRENT_YEAR }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || "연도 전환 실패"); return; }
      toast.success(`${d.year}년도 전환 완료 — 생성 ${d.created}명, 건너뜀 ${d.skipped}명`);
      if (d.noHireDate?.length) toast.info(`입사일 미입력(기본 15일 부여): ${d.noHireDate.join(", ")}`);
      fetchBalance();
    } finally { setRollingOver(false); }
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

  const shownRequests = listQuery.trim()
    ? requests.filter(r => [r.user?.name ?? "", r.user?.branch ?? "", TYPE_LABEL[r.type] ?? r.type, r.reason ?? ""].some(v => v.includes(listQuery.trim())))
    : requests;

  // 머리 「엑셀」(R13) — 지금 보이는 신청 목록(연·월·상태·검색 그대로)을 받는다
  function exportList() {
    if (!shownRequests.length) { toast.error("내보낼 신청이 없습니다."); return; }
    const rows = shownRequests.map(r => ({
      직원: r.user.name, 지점: r.user.branch ?? "", 유형: TYPE_LABEL[r.type] ?? r.type,
      시작일: r.startDate.slice(0, 10), 종료일: r.endDate.slice(0, 10), 일수: r.days,
      상태: STATUS_CFG[r.status]?.label ?? r.status, 사유: r.reason ?? "", 반려사유: r.rejectedReason ?? "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "휴가 신청");
    XLSX.writeFile(wb, `휴가신청_${filterYear}${filterMonth !== "all" ? `_${filterMonth}월` : ""}.xlsx`);
  }
  // 숫자 칸 「이번 달 사용」을 누르면 목록이 이번 달 승인 건으로
  function showThisMonth() {
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    setFilterYear(String(now.getUTCFullYear())); setFilterMonth(String(now.getUTCMonth() + 1)); setFilterStatus("APPROVED"); setListQuery(""); setTab("list");
  }
  const yearUsed = empBalances.length ? Math.round(empBalances.reduce((sum, b) => sum + (Number(b.used) || 0), 0) * 100) / 100 : null;
  const minusCount = empBalances.length ? empBalances.filter(b => b.remaining < 0).length : null;

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

  /* ── 신청 목록 칸(표·카드 공용, #219-16) — 원래 표 칸에 있던 그대로. 모양만 둘이고 내용·조건은 여기 하나 ── */
  const leavePeriod = (r: LeaveRequest) => (
    <>
      {format(new Date(r.startDate), "yyyy.MM.dd")}
      {r.startDate !== r.endDate && ` ~ ${format(new Date(r.endDate), "MM.dd")}`}
    </>
  );
  const leaveApproval = (r: LeaveRequest) => (
    <>
      {r.approvalSteps && r.approvalSteps.length > 0
        ? <ApprovalChain steps={r.approvalSteps} />
        : <span className="text-xs text-gray-400">-</span>}
      {r.status === "REJECTED" && r.rejectedReason && (
        <p className="mt-0.5 text-[12.5px] text-[#be123c]">반려: {r.rejectedReason}</p>
      )}
    </>
  );
  // 첨부 증빙 — 결재가 끝난 뒤에도 여기서 연다(2026-10-19 디렉터). 결재 화면과 같은 주소를 그대로 연다:
  // 열람 권한은 /uploads 쪽 lib/work-file-access 가 판정한다(본부·신청자·결재자·담당 원장). 휴가 한 건에 첨부는 하나다.
  const leaveAttach = (r: LeaveRequest) => r.attachmentUrl ? (
    <a href={r.attachmentUrl} target="_blank" rel="noreferrer" title={r.attachmentName || "첨부 보기"}
      className="inline-block whitespace-nowrap text-[12.5px] font-semibold text-[#4f46e5] hover:underline">첨부 1</a>
  ) : null;
  const leaveStatus = (r: LeaveRequest) => {
    const s = STATUS_CFG[r.status] ?? STATUS_CFG.CANCELLED;
    return (
      <>
        <StatusPill tone={s.tone}>{s.label}</StatusPill>
        {r.pendingCancel && <span className="mt-0.5 block whitespace-nowrap text-[12px] font-semibold text-[#b45309]">취소 결재 중</span>}
      </>
    );
  };
  // 처리 — 관리자의 대기 건은 글자 버튼 「승인」 하나 + ⋮(반려 · 첨부), 나머지는 ⋮ 안(취소 · 취소 요청 · 철회).
  // 취소 가능 여부는 서버가 판정해 내려준다(lib/leave-cancel.ts) — 화면이 조건을 따로 들고 있으면 누르면 403 인 버튼이 생긴다.
  // 관리자의 대기 건에는 확인창 없는 「취소」를 두지 않는다(승인·반려 옆에서 잘못 누르기 쉽다 — 취소는 결재함에서)
  const leaveActions = (r: LeaveRequest) => {
    const pendingAdmin = isAdmin && r.status === "PENDING";
    const more: MoreItem[] = [
      { label: "첨부 보기", onClick: () => window.open(r.attachmentUrl!, "_blank", "noopener"), hidden: !r.attachmentUrl },
      { label: "취소 요청", onClick: () => handleRequestCancel(r.id), hidden: !r.canRequestCancel },   // 승인된 휴가는 취소 결재로만
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
  return (
    <div>
      {/* 머리(R13) — 흰 「엑셀」 + 인디고 「＋ 휴가 등록」(본부가 직원 대신 넣는 것 — 검정 「휴가 신청」 대신) */}
      <PageHead crumb="휴가 › 휴가 관리" title="휴가 관리">
        {isAdmin && tab === "list" && <Btn onClick={exportList}><Download size={14} />엑셀</Btn>}
        <Btn kind="primary" onClick={() => setAddOpen(true)}><Plus size={15} />{role === "ADMIN" ? "휴가 등록" : "휴가 신청"}</Btn>
      </PageHead>

      {/* 직원 잔여 카드 */}
      {!isAdmin && balance && (
        <Card className="mb-4 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
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

      {/* 「휴가 한눈에」 숫자 칸 5(R13 — 대시보드와 같은 칸). 승인 대기 1 이상 빨강, 잔여 마이너스는 누르면 직원별 잔여 */}
      {isAdmin && (
        <Box icon={<CalendarDays />} tone="amb" title="휴가 한눈에" sub={`${CURRENT_YEAR}년`}>
          <Tiles cols={5}>
            <Tile label="오늘 휴가" value={glance.today} unit="명" />
            <Tile label="승인 대기" value={mySteps.length} unit="건" note="내 결재 대기" alert onClick={() => { window.location.href = "/admin/leave-approvals?tab=leave"; }} />
            <Tile label="이번 달 사용" value={glance.month} unit="일" note="이번 달 시작 · 승인" onClick={showThisMonth} />
            <Tile label="올해 연차 차감" value={yearUsed} unit="일" note="시프티 이관분 포함" />
            <Tile label="잔여 마이너스" value={minusCount} unit="명" note="확인 필요" hl onClick={() => setTab("balance")} active={tab === "balance"} />
          </Tiles>
        </Box>
      )}

      {/* ── 알약 탭 한 줄(R13) — 「내 결재함」은 결재 › 결재함, 「결재라인 설정」은 결재 › 결재 규칙으로 옮겼다 ── */}
      {isAdmin && <LeaveTabs active={tab} superAdmin={role === "ADMIN"} onSelect={setTab} />}
      <Tabs value={tab} onValueChange={(v) => setTab(v as LeaveTab)}>
        {/* ═══ 신청 목록 ═══ */}
        <TabsContent value="list">
          <Box icon={<ClipboardList />} tone="sky" title="신청 목록" sub={`${shownRequests.length}건`} className="!mb-0">
            <FilterRow right={[
              { value: "all", label: "전체" },
              { value: "PENDING",   label: "대기" },
              { value: "APPROVED",  label: "승인" },
              { value: "REJECTED",  label: "반려" },
              { value: "CANCELLED", label: "취소" },
            ].map(({ value, label }) => <Chip key={value} on={filterStatus === value} onClick={() => setFilterStatus(value)}>{label}</Chip>)}>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                <input value={listQuery} onChange={e => setListQuery(e.target.value)} placeholder="이름 · 지점 · 유형 · 사유로 찾기" aria-label="신청 찾기"
                  className={`${inputClass} w-56 pl-8`} />
              </div>
              <select value={filterYear} onChange={e => { setFilterYear(e.target.value); setFilterMonth("all"); }} aria-label="연도" className={inputClass}>
                {YEARS.map(y => <option key={y} value={String(y)}>{y}년</option>)}
              </select>
              <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} aria-label="월" className={inputClass}>
                <option value="all">전체 월</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={String(m)}>{m}월</option>)}
              </select>
            </FilterRow>

            {/* 넓은 화면은 표, 휴대폰(md 미만)은 카드(2026-10-16 이예지 QA #219-16 — 390px 에서 결재 현황·상태·처리 칸이 잘렸다).
                두 모양이 같은 칸 함수(leaveApproval·leaveStatus·leaveActions)를 쓴다 — 버튼 동작·조건을 한 곳에서만 고친다 */}
            {shownRequests.length === 0 ? (
              <div className="py-16 text-center text-[14px] text-[#596578]">
                <UmbrellaOff size={32} className="mx-auto mb-2 opacity-30" />{requests.length ? "검색에 맞는 신청이 없습니다." : "신청 내역이 없습니다."}
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
                    {shownRequests.map(r => (
                      <tr key={r.id} className="hover:bg-[#fafbfd]">
                        {isAdmin && <td><Cell2 main={r.user.name} sub={[r.user.branch, r.user.department].filter(Boolean).join(" · ") || undefined} /></td>}
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
                {shownRequests.map(r => (
                  <div key={r.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {isAdmin && <p className="text-[12.5px] text-[#596578]">{r.user.name}{[r.user.branch, r.user.department].filter(Boolean).length ? ` · ${[r.user.branch, r.user.department].filter(Boolean).join(" · ")}` : ""}</p>}
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

        {/* ═══ 휴가 리포트(#29 #84 #85) — 기간·지점·재직 조건, 사용 내역·유형별·월별, 엑셀 ═══ */}
        {isAdmin && (
          <TabsContent value="report">
            <LeaveReport />
          </TabsContent>
        )}

        {/* ═══ 종류별 잔여(#50 #56) — 보상휴가·대체휴일 부여/사용/잔여, 자동 부여 점검, 수동 조정. 본부(ADMIN)만 — isAdmin 은 원장도 참이라 role 로 ═══ */}
        {role === "ADMIN" && (
          <TabsContent value="grants">
            <LeaveGrantBoard />
          </TabsContent>
        )}

        {/* ═══ 휴가 가져오기(#2) — 시프티 사용 내역 엑셀 → 승인 완료 휴가. 본부(ADMIN)만 ═══ */}
        {role === "ADMIN" && (
          <TabsContent value="import">
            <LeaveImport />
          </TabsContent>
        )}

        {/* ═══ 연차 정산(#57 #58 #59 #60) — 재직자 미사용·퇴사자 정산 + 엑셀 3종. 본부(ADMIN)만 ═══ */}
        {role === "ADMIN" && (
          <TabsContent value="settlement">
            <LeaveSettlement />
          </TabsContent>
        )}

        {/* ═══ 직원별 잔여 현황 (관리자) ═══ */}
        {isAdmin && (
          <TabsContent value="balance">
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between gap-2">
                <CardTitle className="text-sm text-gray-600 font-medium flex items-center gap-3">
                  <span>전체 {empBalances.length}명 · {CURRENT_YEAR}년 기준</span>
                  <label className="flex items-center gap-1.5 text-xs font-normal text-gray-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-indigo-600 cursor-pointer"
                      checked={inclAdmins}
                      onChange={e => toggleInclAdmins(e.target.checked)}
                    />
                    관리자 포함
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-normal text-gray-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-indigo-600 cursor-pointer"
                      checked={inclTest}
                      onChange={e => toggleInclTest(e.target.checked)}
                    />
                    통계 제외 지점(본부·테스트) 포함
                  </label>
                </CardTitle>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="sm" className="gap-1" onClick={recalcAll} disabled={recalcing}>
                    <RefreshCw size={13} className={recalcing ? "animate-spin" : ""} />연차 자동계산
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1 text-indigo-600 border-indigo-200" onClick={rolloverYear} disabled={rollingOver}>
                    <RefreshCw size={13} className={rollingOver ? "animate-spin" : ""} />{CURRENT_YEAR}년도 전환
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1 text-emerald-600 border-emerald-200" onClick={() => setBulkOpen(true)}>
                    <Upload size={13} />연차 일괄 업로드
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
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
                            {/* 있는 값만(#219-9 — 「- · 주임매니저」로 보였다) */}
                            <p className="text-xs text-gray-400">{[b.department, b.position].filter(Boolean).join(" · ")}</p>
                            {b.leaveNote && <p className="text-[11px] text-amber-600 mt-0.5">※ {b.leaveNote}</p>}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{b.branch || "-"}</td>
                          <td className="px-4 py-3 text-gray-600">{b.tenure || "-"}</td>
                          <td className="px-4 py-3 text-gray-700 font-medium">
                            {b.total}일
                            {b.recommended != null && b.recommended !== b.total && (
                              <span className="text-[11px] text-amber-600 ml-1" title={b.accrualBasis || "회계연도 기준 계산"}>(계산 {b.recommended})</span>
                            )}
                            {/* 산정 근거(#31) — 회계연도 기준: 월차·첫 해 비례·1/1 기준 근속 가산 */}
                            {b.accrualBasis && <p className="text-[10px] font-normal text-gray-400 mt-0.5 max-w-[16rem] leading-snug">{b.accrualBasis}</p>}
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
                              onClick={() => { setAllowTarget(b); setAllowSalary(""); setAllowBaseDate(new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)); /* 한국 날짜(UTC 면 오전 9시 전엔 어제) */ }}>
                              <Calculator size={12} />계산
                            </Button>
                            {/* 연차 대장 — 그 해 휴가 전부·결재 기록·잔여 조정 이력 + PDF(관리자만, 디렉터 9/11) */}
                            <Button variant="ghost" size="sm" className="h-7 gap-1 text-gray-500 hover:text-gray-800"
                              onClick={() => { window.location.href = `/admin/leave-ledger?userId=${b.userId}&year=${CURRENT_YEAR}`; }}>
                              대장
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
      <Dialog open={addOpen} onOpenChange={o => {
        setAddOpen(o);
        // 닫으면 비운다 — 다시 열었을 때 앞서 고른 대상 직원이 남아 있지 않게(검증 #6)
        if (!o) setForm({ type: "ANNUAL", startDate: "", endDate: "", reason: "", attachmentUrl: "", attachmentName: "", targetUserId: "" });
      }}>
        <DialogContent className="max-w-xl sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CalendarDays size={18} />휴가 신청</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 본부 대리 등록(#37, 본부 답변 #28) — 관리자만. 고르면 그 직원 이름으로 바로 승인·차감 */}
            {role === "ADMIN" && (
              <div className="space-y-2">
                <Label>대상 직원</Label>
                <Select value={form.targetUserId || "SELF"} onValueChange={v => v && setForm(f => ({ ...f, targetUserId: v === "SELF" ? "" : v }))}>
                  <SelectTrigger>
                    <SelectValue>
                      {(() => { if (!form.targetUserId) return "본인 신청"; const u = allUsers.find(x => x.id === form.targetUserId); return u ? `${u.name}${u.branch ? ` · ${u.branch}` : ""}` : "직원 선택"; })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SELF">본인 신청</SelectItem>
                    {allUsers.filter(u => u.id !== myId).map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.name}{u.branch ? ` · ${u.branch}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.targetUserId && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">본부 대리 등록 — 결재 없이 바로 승인되고 연차 차감 유형은 바로 차감됩니다. 직원에게 알림이 갑니다.</p>
                )}
              </div>
            )}
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
                {/* 목록 폭을 창 폭에 맞춘다(#219-9 — 설명이 잘렸다). 이 화면의 선택칸만 — 공용 select 는 그대로 */}
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
            <LeaveDaysPreviewBox state={daysPreview} fixed={!!FIXED_DAYS[form.type]} />
            <div className="space-y-2">
              <Label>사유 <span className="text-gray-400 font-normal text-xs">(선택)</span></Label>
              <Textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="휴가 사유를 입력하세요" rows={2} />
            </div>
            <div className="space-y-2">
              <Label>
                첨부파일{leaveInfo(form.type)?.attachRequired
                  ? (form.targetUserId
                    ? <span className="text-gray-400 font-normal text-xs"> ({leaveInfo(form.type)?.attachRequired} — 대리 등록은 선택)</span>
                    : <span className="text-red-500"> ({leaveInfo(form.type)?.attachRequired} 필수)</span>)
                  : <span className="text-gray-400 font-normal text-xs"> (선택)</span>}
              </Label>
              {leaveInfo(form.type)?.notice && <p className="text-xs text-gray-500">{leaveInfo(form.type)?.notice}</p>}
              {form.attachmentUrl ? (
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm">
                  <span className="flex-1 truncate text-gray-700">{form.attachmentName}</span>
                  <button type="button" className="text-gray-400 hover:text-red-500"
                    onClick={() => setForm(f => ({ ...f, attachmentUrl: "", attachmentName: "" }))}>✕</button>
                </div>
              ) : (
                <Input type="file" accept="image/*,.pdf,.doc,.docx,.hwp" onChange={handleAttachUpload} />
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => {
                setAddOpen(false);
                setForm({ type: "ANNUAL", startDate: "", endDate: "", reason: "", attachmentUrl: "", attachmentName: "", targetUserId: "" });
              }}>취소</Button>
              <Button type="submit" className="bg-[#4f46e5] text-white hover:bg-[#4338ca]" disabled={!canSubmit || submitting}>{submitting ? "처리 중..." : form.targetUserId ? "등록·승인" : "신청"}</Button>
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
      {/* 연차 일괄 업로드 */}
      <Dialog open={bulkOpen} onOpenChange={(o) => { setBulkOpen(o); if (!o) { setBulkPreview(null); setBulkFileName(""); } }}>
        <DialogContent className="max-w-3xl overflow-hidden">
          <DialogHeader><DialogTitle>연차 일괄 업로드 · {CURRENT_YEAR}년</DialogTitle></DialogHeader>
          <div className="space-y-3 min-w-0">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">💡 이름 · 이메일 · 연차 3개 컬럼이면 됩니다</p>
              <p>이메일로 직원을 찾아 <b>총 연차</b>를 파일의 숫자로 바꿉니다. 이미 사용한 일수는 그대로 두고 잔여만 다시 계산합니다.</p>
              <p>템플릿을 내려받으면 현재 직원 명단과 연차가 채워져 있어 숫자만 고쳐 올리면 됩니다.</p>
            </div>
            <div className="flex gap-2 items-center">
              <Button variant="outline" size="sm" className="gap-1" onClick={downloadBulkTemplate}>
                <Download size={13} />템플릿 다운로드
              </Button>
              <input id="leave-bulk-file" type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBulkFile(f); e.target.value = ""; }} />
              <Button size="sm" className="gap-1" onClick={() => document.getElementById("leave-bulk-file")?.click()}>
                <Upload size={13} />파일 선택
              </Button>
              {bulkFileName && <span className="text-xs text-gray-500 truncate">{bulkFileName}</span>}
            </div>
            {bulkPreview && (
              <>
                <div className="max-h-72 overflow-y-auto overflow-x-auto border rounded-lg">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="text-left text-gray-500 border-b">
                        <th className="px-3 py-2 font-medium">이름</th>
                        <th className="px-3 py-2 font-medium">이메일</th>
                        <th className="px-3 py-2 font-medium">총 연차</th>
                        <th className="px-3 py-2 font-medium">잔여 예상</th>
                        <th className="px-3 py-2 font-medium">상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkPreview.map((r, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-1.5">{r.name || r.systemName || "-"}</td>
                          <td className="px-3 py-1.5 text-gray-500">{r.email || "-"}</td>
                          <td className="px-3 py-1.5">
                            {r.status === "ok" || r.status === "name_mismatch"
                              ? <>{r.prevTotal ?? "-"}일 → <b>{r.total}일</b></>
                              : (r.total ?? "-")}
                          </td>
                          <td className="px-3 py-1.5">{r.newRemaining !== undefined ? `${r.newRemaining}일 (사용 ${r.used ?? 0}일)` : "-"}</td>
                          <td className="px-3 py-1.5">
                            {r.status === "ok" && <span className="text-emerald-600">적용됨</span>}
                            {r.status === "name_mismatch" && <span className="text-amber-600" title={r.message}>적용 (이름 확인: {r.message})</span>}
                            {r.status === "not_found" && <span className="text-red-500">건너뜀 · {r.message}</span>}
                            {r.status === "invalid" && <span className="text-red-500">건너뜀 · {r.message}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    적용 {bulkPreview.filter(r => r.status === "ok" || r.status === "name_mismatch").length}명 ·
                    건너뜀 {bulkPreview.filter(r => r.status === "not_found" || r.status === "invalid").length}행
                  </p>
                  <Button onClick={applyBulk} disabled={bulkApplying || bulkPreview.every(r => r.status === "not_found" || r.status === "invalid")}
                    className="bg-emerald-600 hover:bg-emerald-700">
                    {bulkApplying ? "적용 중..." : "적용"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
