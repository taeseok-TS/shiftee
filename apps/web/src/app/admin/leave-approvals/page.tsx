"use client";
// 결재 › 결재함 — 본부 시안 R11(2026-10-21 「디자인 통일」). 휴가 · 근무일정 · 휴가 취소 · 출퇴근 요청 · 계약을 한 곳에서.
//  · 알약 탭 한 줄(components/approvals/ApprovalsHeader) — 맨 앞 「결재 대기」 = 종류 상관없이 내가 처리할 것 모두(한 표)
//  · 줄마다 버튼 두 개 이하: 휴가·근무일정 = 흰 「반려」 + 인디고 「승인」(의견은 누르면 뜨는 확인 창에 선택 입력), 「취소」·첨부는 ⋮ 안.
//    계약 = 인디고 「열기」(승인 전체 창), 휴가 취소·출퇴근 요청 = 「열기」(그 탭 — 사진·위치·사유를 보고 처리)
//  · 결재 진행은 점(끝남 파랑 · 지금 차례 주황 · 남음 회색) — 보낸 계약서와 같은 표시
//  · 옛 계약 결재 화면(/admin/contract-approvals)은 이 화면 「계약」 탭으로 넘어온다(메일·알림 링크 그대로)
import { useLeaveCatalog } from "@/components/leave/useLeaveCatalog";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CheckSquare } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import LeaveCancelInbox from "@/components/leave/LeaveCancelInbox";
import AttendanceRequestInbox from "@/components/attendance/AttendanceRequestInbox";
import ApprovalFullViewHost, { type HostContract } from "@/components/contracts/ApprovalFullViewHost";
import ApprovalsHeader, { type ApprovalTab } from "@/components/approvals/ApprovalsHeader";
import { postLeaveApprove } from "@/lib/leave-approve-client";
import { fmtRangeKo } from "@/lib/leave-period";
import { templateLabel } from "@/lib/schedule-label";
import { Btn, Box, DateInput, FilterRow, inputClass, tableClass, Cell2, StatusPill, FlowDots, MoreMenu, type FlowStep, type PillTone, type MoreItem } from "@/components/kit";

/* ── 타입 ── */
type ApprovalStep = {
  id: string;
  order: number;
  status: string;
  approver: { id?: string; name: string; position?: string | null } | null;
  approverRole?: string | null;
  branch?: string | null;
  comment?: string | null;   // 결재자 의견(승인·반려 때 남긴 것)
  candidates?: string[];     // 승인 전 원장 단계 — 그 지점 원장 이름(서버 lib/approval-turn, 2026-10-27 이예지 ⑨)
};

// 역할/지점 기반 단계는 승인 전까지 approver가 null → 그 지점 원장 이름(서버가 candidates 로 준다, 둘이면 둘 다)으로. 없으면 역할 라벨
function stepLabel(s: ApprovalStep): string {
  // 결재한 사람은 「이름 직급」(예: 이예지 대리), 메인 관리자 계정(이름 「관리자」)이나 아직 사람이 안 정해진 본부 단계는 「본부」(2026-10-28 이예지 디자인 ⑤)
  if (s.approver && s.approver.name !== "관리자") return `${s.approver.name}${s.approver.position ? ` ${s.approver.position}` : ""}`;
  if (s.approver) return "본부";
  if (s.approverRole === "MANAGER" && s.candidates?.length) return `${s.candidates.join(" · ")} 원장`;
  if (s.approverRole === "MANAGER") return `${s.branch ? `[${s.branch}] ` : ""}원장`;
  if (s.approverRole === "ADMIN") return "본부";
  return "결재자";
}
const dotsOf = (steps: ApprovalStep[] | undefined): FlowStep[] =>
  (steps ?? []).map((s) => ({ label: stepLabel(s), state: s.status === "APPROVED" ? "done" : s.status === "PENDING" ? "now" : "todo" }));
const commentsOf = (steps: ApprovalStep[] | undefined) => (steps ?? []).filter((s) => s.comment).map((s) => `${stepLabel(s)}: ${s.comment}`);

type LeaveRequest = {
  id: string; type: string; startDate: string; endDate: string; days: number; reason: string | null;
  attachmentUrl?: string | null; attachmentName?: string | null; status: string;
  user: { name: string; department: string | null; position: string | null; branch?: string | null };
  canCancel?: boolean;   // 서버 판정(lib/leave-cancel.ts) — 이 값으로만 취소를 보인다
  approvalSteps?: ApprovalStep[];
};
type LeaveApprovalStep = { id: string; order: number; status: string; leaveRequest: LeaveRequest };
type ScheduleRequest = {
  id: string; userId: string; templateName: string; startDate: string; endDate: string; totalHours: number; status: string;
  user: { id: string; name: string; department: string | null; position: string | null; branch?: string | null };
  canCancel?: boolean;
  approvalSteps?: ApprovalStep[];
};
type ScheduleApprovalStep = { id: string; order: number; status: string; scheduleRequest: ScheduleRequest };
type CancelStep = {
  id: string;
  cancelRequest: {
    id: string; createdAt: string; reason: string | null;
    user: { name: string; position: string | null; branch: string | null };
    leaveRequest: { type: string; startDate: string; endDate: string; days: number };
    approvalSteps: ApprovalStep[];
  };
};
type AttReq = {
  outLate?: string | null;   // 퇴근 시각이 기준보다 늦은 만큼(본부만, 2026-10-29)
  id: string; status?: string; kindLabel?: string; workDate: string; userName?: string; userBranch?: string | null; userPosition?: string | null; requestedAt?: string | null;
  // 출퇴근 수정은 「지점 원장 → 본부」 두 단계(■0-11) — 서버가 줄마다 싣는다(옛 서버면 없음)
  steps?: number; currentStep?: "MANAGER" | "HQ" | null;
};
type ContractRow = {
  id: string; title: string; type?: string; createdAt: string; signDeadline?: string | null; fileUrl?: string | null; externalName?: string | null; sendMessage?: string | null;
  user: { id: string; name: string; department: string | null; branch: string | null };
  approvalLine: { steps: (ApprovalStep & { externalName?: string })[]; myStep?: { id: string; order: number; status: string } };
};

const CONTRACT_TYPE_LABEL: Record<string, string> = { EMPLOYMENT: "근로계약서", PART_TIME: "단시간근로계약서", CONFIDENTIAL: "비밀유지", OTHER: "계약" };
const ymdKst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const md = (iso: string) => format(new Date(`${iso.slice(0, 10)}T00:00:00`), "M월 d일 (EEE)", { locale: ko });
// 기간 — 끝 날짜에도 요일, 해 바뀌는 기간만 연도(10/23 ■3 · ■4, lib/leave-period)
const range = (s: string, e: string) => fmtRangeKo(s, e);
function firstFileUrl(fileUrl?: string | null): string {
  if (!fileUrl) return "";
  try { const a = JSON.parse(fileUrl); return Array.isArray(a) ? a[0] || "" : fileUrl; } catch { return fileUrl; }
}

/** 표·카드 공용 한 줄 */
type Row = {
  key: string; kind: Exclude<ApprovalTab, "all" | "decided">; id: string;
  name: string; nameSub: string; typeLabel: string; tone: PillTone;
  period: string; periodSub: string; dots: FlowStep[]; comments: string[];
  action: "decide" | "open"; onOpen?: () => void; more: MoreItem[]; at: number;
  /** 열기 버튼을 흰 「보기」로 — 본부 차례가 아닌 건(출퇴근 수정 원장 차례)이 본부가 처리할 것처럼 보이지 않게 */
  viewOnly?: boolean;
  s: string; e: string;   // 날짜 찾기용 "YYYY-MM-DD"(기간 안이면 맞음)
};

export default function ApprovalsPage() {
  const { labels: leaveLabels } = useLeaveCatalog();   // 본부가 만든 휴가 유형 이름(#216-1) — 늦게 와도 rows 를 다시 계산한다
  const [leaveSteps, setLeaveSteps] = useState<LeaveApprovalStep[]>([]);
  const [scheduleSteps, setScheduleSteps] = useState<ScheduleApprovalStep[]>([]);
  // 원장 승인 전인 건(서버 waiting) — 「원장 승인 전」 탭에만, 버튼 없이(2026-10-27 이예지 ⑬)
  const [waitingLeave, setWaitingLeave] = useState<LeaveApprovalStep[]>([]);
  const [waitingSchedule, setWaitingSchedule] = useState<ScheduleApprovalStep[]>([]);
  const [cancelSteps, setCancelSteps] = useState<CancelStep[]>([]);
  const [attReqs, setAttReqs] = useState<AttReq[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchName, setSearchName] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [tab, setTab] = useState<ApprovalTab>("all");
  // 승인 확인(의견 선택) · 반려 사유
  const [approveTarget, setApproveTarget] = useState<{ id: string; kind: "leave" | "schedule"; title: string } | null>(null);
  const [note, setNote] = useState("");
  const [rejectTarget, setRejectTarget] = useState<{ id: string; kind: "leave" | "schedule" | "contract"; title: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  // 계약 — 승인 전체 창
  const [fullTarget, setFullTarget] = useState<ContractRow | null>(null);
  const [myId, setMyId] = useState("");
  // 메일·대시보드의 「열기」로 들어오면(?id=…) 그 건으로 스크롤·강조, ?tab=… 이면 그 탭
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("id");
    const t = q.get("tab");
    Promise.resolve().then(() => {
      if (id) setHighlightId(id);
      if (t && ["all", "leave", "schedule", "cancel", "attendance", "contract", "waiting"].includes(t)) setTab(t as ApprovalTab);
    });
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMyId(d.user?.id || d.userId || "")).catch(() => {});
  }, []);

  // 처음엔 loading=true 로 시작한다 — 다시 부를 때(처리 뒤)는 목록을 그대로 두고 새 값으로 바꾼다
  const fetchApprovals = useCallback(async () => {
    try {
      const [leaveRes, scheduleRes, cancelRes, attRes, contractRes] = await Promise.all([
        fetch("/api/leave/my-approvals"),
        fetch("/api/schedule-requests/my-approvals"),
        fetch("/api/leave/cancel-requests/my-approvals"),
        fetch("/api/attendance-requests?scope=inbox"),
        fetch("/api/contracts/my-approvals"),
      ]);
      if (leaveRes.ok) { const d = await leaveRes.json(); setLeaveSteps(d.steps || []); setWaitingLeave(d.waiting || []); }
      if (scheduleRes.ok) { const d = await scheduleRes.json(); setScheduleSteps(d.steps || []); setWaitingSchedule(d.waiting || []); }
      if (cancelRes.ok) setCancelSteps((await cancelRes.json()).steps || []);
      if (attRes.ok) setAttReqs(((await attRes.json()).requests || []).filter((r: AttReq) => !r.status || r.status === "PENDING"));
      if (contractRes.ok) setContracts((await contractRes.json()).contracts || []);
      if (!leaveRes.ok || !scheduleRes.ok || !cancelRes.ok || !attRes.ok || !contractRes.ok) toast.error("결재 대기 일부를 불러오지 못했습니다. 새로고침해 주세요.");
    } catch (error) {
      console.error("결재 요청 조회 오류:", error);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void fetchApprovals(); }, [fetchApprovals]);

  useEffect(() => {
    if (!highlightId) return;
    // 넓은 화면은 표 줄, 휴대폰은 카드 — 보이는 쪽으로(#219-16)
    const el = [document.getElementById("row-" + highlightId), document.getElementById("card-" + highlightId)]
      .find((e) => e && e.offsetParent !== null);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, leaveSteps, scheduleSteps, contracts, tab]);

  // 휴가·근무일정 신청 취소 — 신청 자체를 거둔다(반려와 달리 결재 기록에 남지 않는다). 서버가 권한을 다시 본다
  const cancelRequest = async (kind: "leave" | "schedule", id: string, who: string) => {
    if (!confirm(`${who}님의 ${kind === "leave" ? "휴가 신청" : "근무 변경 요청"}을 취소할까요?\n\n취소하면 신청자에게 알림이 갑니다.`)) return;
    setProcessingId(id);
    try {
      const res = await fetch(kind === "leave" ? `/api/leave/${id}` : `/api/schedule-requests/${id}`, { method: kind === "leave" ? "PATCH" : "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "취소하지 못했습니다"); return; }
      toast.success("신청을 취소했습니다");
      if (kind === "leave") setLeaveSteps((p) => p.filter((s) => s.leaveRequest.id !== id));
      else setScheduleSteps((p) => p.filter((s) => s.scheduleRequest.id !== id));
    } catch { toast.error("오류가 발생했습니다"); } finally { setProcessingId(null); }
  };

  const approve = async (id: string, kind: "leave" | "schedule", memo?: string) => {
    setProcessingId(id);
    try {
      // 휴가는 잔여 부족이면 관리자가 한 번 더 확인하고 예외 승인(lib/leave-approve-client)
      const r = kind === "leave"
        ? await postLeaveApprove(id, memo ? { reason: memo } : {})
        : await fetch(`/api/schedule-requests/${id}/approve`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "approve", ...(memo ? { reason: memo } : {}) }),
          }).then(async (res) => ({ ok: res.ok, cancelled: false, error: res.ok ? "" : (await res.json().catch(() => ({}))).error || "처리 중 오류가 발생했습니다" }));
      if (r.ok) {
        toast.success("승인되었습니다");
        if (kind === "leave") setLeaveSteps((p) => p.filter((s) => s.leaveRequest.id !== id));
        else setScheduleSteps((p) => p.filter((s) => s.scheduleRequest.id !== id));
      } else if (!r.cancelled) toast.error(r.error);
    } catch { toast.error("오류가 발생했습니다"); } finally { setProcessingId(null); }
  };

  const reject = async () => {
    if (!rejectTarget) return;
    const t = rejectTarget;
    const reason = rejectReason.trim();
    if (t.kind === "contract" && !reason) { toast.error("반려 사유를 입력해주세요"); return; }
    setProcessingId(t.id);
    try {
      const res = t.kind === "contract"
        ? await fetch(`/api/contracts/${t.id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) })
        : await fetch(t.kind === "leave" ? `/api/leave/${t.id}/approve` : `/api/schedule-requests/${t.id}/approve`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reject", reason }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "반려 처리 중 오류가 발생했습니다"); return; }
      toast.success(t.kind === "contract" ? "반려했습니다. 작성자와 당사자에게 알림이 갑니다." : "반려되었습니다");
      if (t.kind === "leave") setLeaveSteps((p) => p.filter((s) => s.leaveRequest.id !== t.id));
      else if (t.kind === "schedule") setScheduleSteps((p) => p.filter((s) => s.scheduleRequest.id !== t.id));
      else setContracts((p) => p.filter((c) => c.id !== t.id));
      setRejectTarget(null); setRejectReason("");
    } catch { toast.error("오류가 발생했습니다"); } finally { setProcessingId(null); }
  };

  /* ── 줄 만들기 ── */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const step of leaveSteps) {
      const r = step.leaveRequest;
      const more: MoreItem[] = [
        { label: `첨부 보기${r.attachmentName ? ` (${r.attachmentName})` : ""}`, hidden: !r.attachmentUrl, onClick: () => window.open(r.attachmentUrl!, "_blank") },
        { label: "신청 취소", hidden: !r.canCancel, onClick: () => void cancelRequest("leave", r.id, r.user.name) },
      ];
      out.push({
        key: `leave-${r.id}`, kind: "leave", id: r.id, name: r.user.name, nameSub: [r.user.branch, r.user.position].filter(Boolean).join(" · "),
        typeLabel: leaveLabels[r.type] || r.type, tone: "wait",
        period: range(r.startDate, r.endDate), periodSub: `${r.days}일${r.reason ? ` · 사유 ${r.reason}` : ""}`,
        dots: dotsOf(r.approvalSteps), comments: commentsOf(r.approvalSteps), action: "decide", more, at: new Date(r.startDate).getTime(),
        s: r.startDate.slice(0, 10), e: r.endDate.slice(0, 10),
      });
    }
    for (const step of scheduleSteps) {
      const r = step.scheduleRequest;
      out.push({
        key: `schedule-${r.id}`, kind: "schedule", id: r.id, name: r.user.name, nameSub: [r.user.branch, r.user.position].filter(Boolean).join(" · "),
        typeLabel: "근무 변경", tone: "wait",
        period: range(r.startDate, r.endDate), periodSub: `계획 ${r.totalHours}시간 · ${templateLabel(r.templateName)}`,
        dots: dotsOf(r.approvalSteps), comments: commentsOf(r.approvalSteps), action: "decide",
        more: [{ label: "신청 취소", hidden: !r.canCancel, onClick: () => void cancelRequest("schedule", r.id, r.user.name) }], at: new Date(r.startDate).getTime(),
        s: r.startDate.slice(0, 10), e: r.endDate.slice(0, 10),
      });
    }
    for (const s of cancelSteps) {
      const c = s.cancelRequest;
      out.push({
        key: `cancel-${c.id}`, kind: "cancel", id: c.id, name: c.user.name, nameSub: [c.user.branch, c.user.position].filter(Boolean).join(" · "),
        typeLabel: "휴가 취소", tone: "wait",
        period: range(c.leaveRequest.startDate, c.leaveRequest.endDate), periodSub: `${leaveLabels[c.leaveRequest.type] || c.leaveRequest.type} ${c.leaveRequest.days}일 취소${c.reason ? ` · 사유 ${c.reason}` : ""}`,
        dots: dotsOf(c.approvalSteps), comments: commentsOf(c.approvalSteps), action: "open", onOpen: () => setTab("cancel"), more: [], at: new Date(c.leaveRequest.startDate).getTime(),
        s: c.leaveRequest.startDate.slice(0, 10), e: c.leaveRequest.endDate.slice(0, 10),
      });
    }
    for (const a of attReqs) {
      // 결재 진행 — 서버 steps · currentStep 으로(두 단계면 「지점 원장 → 본부」). 원장 차례인 건은 회색 알약 · 「원장 차례」 · 흰 「보기」
      const managerTurn = a.currentStep === "MANAGER";
      const dots: FlowStep[] = (a.steps ?? 1) > 1 && a.currentStep
        ? [{ label: "지점 원장", state: a.currentStep === "HQ" ? "done" : "now" }, { label: "본부", state: a.currentStep === "HQ" ? "now" : "todo" }]
        : a.currentStep ? [{ label: a.currentStep === "HQ" ? "본부" : "지점 원장", state: "now" }] : [];
      out.push({
        key: `att-${a.id}`, kind: managerTurn ? "waiting" : "attendance", id: a.id, name: a.userName || "", nameSub: [a.userBranch, a.userPosition].filter(Boolean).join(" · "),
        typeLabel: a.kindLabel || "출퇴근 수정", tone: managerTurn ? "gray" : "wait",
        period: md(a.workDate),
        periodSub: managerTurn ? "원장 차례 · 원장이 승인하면 본부 차례로 넘어옵니다" : a.outLate ? `⚠ ${a.outLate} · 사유를 보고 처리` : "출퇴근 수정 · 사진 · 위치 · 사유를 보고 처리",
        dots, comments: [], action: "open", onOpen: managerTurn ? undefined : () => setTab("attendance"), more: [], at: new Date(a.workDate).getTime(), viewOnly: managerTurn,
        s: a.workDate.slice(0, 10), e: a.workDate.slice(0, 10),
      });
    }
    // 원장 승인 전(본부 차례 아님) — 「원장 승인 전」 탭에만, 결재 · 반려 버튼 없이 진행 상태만 본다(2026-10-27 이예지 ⑬)
    for (const step of waitingLeave) {
      const r = step.leaveRequest;
      out.push({
        key: `wleave-${r.id}`, kind: "waiting", id: r.id, name: r.user.name, nameSub: [r.user.branch, r.user.position].filter(Boolean).join(" · "),
        typeLabel: leaveLabels[r.type] || r.type, tone: "gray",
        period: range(r.startDate, r.endDate), periodSub: `${r.days}일${r.reason ? ` · 사유 ${r.reason}` : ""} · 원장 승인 뒤 본부 차례`,
        dots: dotsOf(r.approvalSteps), comments: commentsOf(r.approvalSteps), action: "open", more: [], at: new Date(r.startDate).getTime(), viewOnly: true,
        s: r.startDate.slice(0, 10), e: r.endDate.slice(0, 10),
      });
    }
    for (const step of waitingSchedule) {
      const r = step.scheduleRequest;
      out.push({
        key: `wschedule-${r.id}`, kind: "waiting", id: r.id, name: r.user.name, nameSub: [r.user.branch, r.user.position].filter(Boolean).join(" · "),
        typeLabel: "근무 변경", tone: "gray",
        period: range(r.startDate, r.endDate), periodSub: `계획 ${r.totalHours}시간 · ${templateLabel(r.templateName)} · 원장 승인 뒤 본부 차례`,
        dots: dotsOf(r.approvalSteps), comments: commentsOf(r.approvalSteps), action: "open", more: [], at: new Date(r.startDate).getTime(), viewOnly: true,
        s: r.startDate.slice(0, 10), e: r.endDate.slice(0, 10),
      });
    }
    for (const c of contracts) {
      const file = firstFileUrl(c.fileUrl);
      out.push({
        key: `contract-${c.id}`, kind: "contract", id: c.id, name: c.externalName || c.user.name, nameSub: c.externalName ? "외부 계약자" : c.user.branch || "",
        typeLabel: CONTRACT_TYPE_LABEL[c.type || ""] || "계약", tone: "ind",
        period: c.signDeadline ? `기한 ${md(ymdKst(c.signDeadline))}` : md(ymdKst(c.createdAt)), periodSub: `${c.title} · 전체 창에서 읽고 서명`,
        dots: (c.approvalLine?.steps || []).map((st) => ({ label: (st.approver?.name === "관리자" ? "본부" : st.approver?.name) || st.externalName || "외부 서명자", state: st.status === "APPROVED" ? "done" : st.status === "PENDING" ? "now" : "todo" })),
        comments: c.sendMessage ? [`본부 메시지: ${c.sendMessage}`] : [], action: "open", onOpen: () => setFullTarget(c),
        more: [
          { label: "문서 보기", hidden: !file, onClick: () => window.open(/\.docx?$/i.test(file) ? `/docs/viewer?src=${encodeURIComponent(file)}` : file, "_blank") },
          { label: "반려", danger: true, onClick: () => { setRejectReason(""); setRejectTarget({ id: c.id, kind: "contract", title: `${c.externalName || c.user.name} — ${c.title}` }); } },
        ],
        at: new Date(c.createdAt).getTime(),
        s: ymdKst(c.createdAt), e: c.signDeadline ? ymdKst(c.signDeadline) : ymdKst(c.createdAt),
      });
    }
    return out;
  }, [leaveSteps, scheduleSteps, cancelSteps, attReqs, contracts, waitingLeave, waitingSchedule, leaveLabels]);

  const shown = useMemo(() => {
    const q = searchName.trim().toLowerCase();
    return rows.filter((r) => (tab === "all" ? r.kind !== "waiting" : r.kind === tab)
      && (!q || r.name.toLowerCase().includes(q))
      && (!searchDate || (r.s <= searchDate && searchDate <= r.e)))
      .sort((a, b) => a.at - b.at);
  }, [rows, tab, searchName, searchDate]);

  const attManagerTurn = attReqs.filter((a) => a.currentStep === "MANAGER").length;
  const counts = {
    leave: leaveSteps.length, schedule: scheduleSteps.length,
    cancel: cancelSteps.length, attendance: attReqs.length - attManagerTurn, contract: contracts.length,
    waiting: waitingLeave.length + waitingSchedule.length + attManagerTurn,
  };
  // 「결재 대기」 = 본부 차례만(원장 승인 전은 빼고, 2026-10-27 이예지 ⑬) — 메뉴 숫자(api/nav-counts)와 같은 기준
  const total = counts.leave + counts.schedule + counts.cancel + counts.attendance + counts.contract;
  const title = tab === "all" ? "결재 대기" : { leave: "휴가", schedule: "근무 변경", cancel: "휴가 취소", attendance: "출퇴근 수정", contract: "계약", waiting: "원장 승인 전", decided: "처리한 요청" }[tab];

  // 찾기 줄 — 모든 탭에 같은 줄(휴가 취소·출퇴근 요청 탭에서 보이지 않는 검색어로 걸러지지 않게). 출퇴근 요청은 이름만 찾는다
  const filters = (withDate: boolean) => (
    <FilterRow>
      <input type="search" value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="직원 이름으로 찾기" className={`${inputClass} w-52`} aria-label="직원 이름" />
      {withDate && <DateInput value={searchDate} onChange={setSearchDate} aria-label="날짜" />}
      {(searchName || (withDate && searchDate)) && <Btn kind="text" onClick={() => { setSearchName(""); setSearchDate(""); }}>초기화</Btn>}
    </FilterRow>
  );

  const actions = (r: Row) => (
    <span className="inline-flex items-center gap-1.5">
      {r.action === "decide" ? (<>
        <Btn className="px-3.5 py-1.5" disabled={processingId === r.id}
          onClick={() => { setRejectReason(""); setRejectTarget({ id: r.id, kind: r.kind as "leave" | "schedule", title: `${r.name} — ${r.typeLabel} ${r.period}` }); }}>반려</Btn>
        <Btn kind="primary" className="px-3.5 py-1.5" disabled={processingId === r.id}
          onClick={() => { setNote(""); setApproveTarget({ id: r.id, kind: r.kind as "leave" | "schedule", title: `${r.name} — ${r.typeLabel} ${r.period}` }); }}>
          {processingId === r.id ? "처리 중…" : "승인"}
        </Btn>
      </>) : r.kind === "waiting" && !r.onOpen ? (
        <span className="text-[12.5px] text-[#94a3b8]">원장 승인 전</span>
      ) : (
        r.viewOnly
          ? <Btn className="px-3.5 py-1.5" onClick={r.onOpen}>보기</Btn>
          : <Btn kind="primary" className="px-3.5 py-1.5" onClick={r.onOpen}>열기</Btn>
      )}
      <MoreMenu items={r.more} />
    </span>
  );

  return (
    <div>
      <ApprovalsHeader active={tab} onSelect={setTab} counts={{ all: total, ...counts }} />

      {tab === "cancel" ? (
        /* 휴가 취소 결재 — 관리자·원장 결재함이 같은 컴포넌트를 쓴다(짝 누락 방지) */
        <Box icon={<CheckSquare />} tone="rose" title="휴가 취소" count={counts.cancel} sub="승인하면 휴가가 취소되고 연차가 돌아갑니다">
          {filters(true)}
          <div className="px-6 py-4"><LeaveCancelInbox onChanged={() => void fetchApprovals()} searchName={searchName} searchDate={searchDate} /></div>
        </Box>
      ) : tab === "attendance" ? (
        <Box icon={<CheckSquare />} tone="rose" title="출퇴근 수정" count={counts.attendance} sub="지점 밖 · 사진 · 본부 요청 · 기록 수정 · 퇴근 누락">
          {filters(false)}
          <div className="px-6 py-4"><AttendanceRequestInbox onChanged={() => void fetchApprovals()} searchName={searchName} hideManagerTurn /></div>
        </Box>
      ) : (
        <Box icon={<CheckSquare />} tone={tab === "waiting" ? "sl" : "rose"} title={title} count={shown.length} sub={tab === "waiting" ? "원장이 승인하면 본부 차례로 넘어옵니다 — 여기서는 진행만 봅니다" : "내 결재 대기만"}>
          {filters(true)}
          {loading ? (
            <p className="px-6 py-8 text-center text-[14px] text-[#596578]">불러오는 중…</p>
          ) : shown.length === 0 ? (
            <p className="px-6 py-8 text-center text-[14px] text-[#596578]">{rows.length && (searchName || searchDate) ? "찾는 결과가 없습니다" : "처리할 요청 없음"}</p>
          ) : (<>
            {/* 넓은 화면 = 표 */}
            <div className="hidden overflow-x-auto md:block">
              <table className={tableClass}>
                <thead>
                  <tr><th>직원</th><th>종류</th><th>기간</th><th>결재 진행</th><th className="text-right">처리</th></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.key} id={"row-" + r.id} className={highlightId === r.id ? "bg-[#eef2ff]" : "hover:bg-[#fafbfd]"}>
                      <td><Cell2 main={r.name} sub={r.nameSub || undefined} /></td>
                      <td><StatusPill tone={r.tone}>{r.typeLabel}</StatusPill></td>
                      <td className="max-w-[22rem]">
                        <span className="text-[#0f172a]">{r.period}</span>
                        <span className="block truncate text-[12.5px] text-[#596578]" title={r.periodSub}>{r.periodSub}</span>
                      </td>
                      <td>
                        {r.dots.length ? <FlowDots steps={r.dots} /> : <span className="text-[#94a3b8]">—</span>}
                        {r.comments.map((c) => <span key={c} className="block text-[12px] text-[#596578]">의견 · {c}</span>)}
                      </td>
                      <td className="whitespace-nowrap text-right">{actions(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* 휴대폰 = 카드(390px 에서 처리 칸이 잘리던 것, #219-16) */}
            <div className="space-y-2 p-3 md:hidden">
              {shown.map((r) => (
                <div key={r.key} id={"card-" + r.id} className={`rounded-xl border border-[#eef1f5] p-3 ${highlightId === r.id ? "bg-[#eef2ff]" : "bg-white"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <Cell2 main={r.name} sub={r.nameSub || undefined} />
                    <StatusPill tone={r.tone}>{r.typeLabel}</StatusPill>
                  </div>
                  <p className="mt-1.5 text-[14px] text-[#0f172a]">{r.period}</p>
                  <p className="text-[12.5px] text-[#596578]">{r.periodSub}</p>
                  {r.dots.length > 0 && <div className="mt-1.5"><FlowDots steps={r.dots} /></div>}
                  {r.comments.map((c) => <p key={c} className="text-[12px] text-[#596578]">의견 · {c}</p>)}
                  <div className="mt-2 flex justify-end">{actions(r)}</div>
                </div>
              ))}
            </div>
          </>)}
        </Box>
      )}

      {/* 승인 확인 — 의견은 선택(옛 「의견」 버튼 대신, 시안 R11) */}
      <Dialog open={!!approveTarget} onOpenChange={(o) => { if (!o) setApproveTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>승인</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-700">{approveTarget?.title}</p>
            <div>
              <Label className="mb-1 block text-sm">의견 <span className="text-xs font-normal text-gray-400">(선택 — 다음 결재자와 본부가 봅니다)</span></Label>
              <Textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} rows={3} />
            </div>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setApproveTarget(null)}>닫기</Btn>
              <Btn kind="primary" disabled={processingId !== null} onClick={async () => {
                if (!approveTarget) return;
                const t = approveTarget;
                setApproveTarget(null);
                await approve(t.id, t.kind, note.trim() || undefined);
              }}>승인</Btn>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 반려 사유 */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{rejectTarget?.kind === "contract" ? "계약 반려" : "반려"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-700">{rejectTarget?.title}</p>
            {rejectTarget?.kind === "contract" && (
              <p className="text-sm text-[#be123c]">반려하면 결재가 멈추고 작성자·당사자에게 사유가 전달됩니다. 관리자가 고쳐 다시 보내면 1단계부터 다시 진행됩니다.</p>
            )}
            <div>
              <Label className="mb-1 block text-sm">{rejectTarget?.kind === "contract" ? <>반려 사유 <span className="text-red-500">*</span></> : "반려 사유"}</Label>
              <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4} maxLength={500} />
            </div>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => { setRejectTarget(null); setRejectReason(""); }}>닫기</Btn>
              <Btn kind="primary" disabled={processingId !== null || (rejectTarget?.kind === "contract" && !rejectReason.trim())} onClick={reject}>
                반려하기
              </Btn>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 계약 승인 — 전체 창(재요청 C). 창 안의 반려도 같은 사유 입력을 거친다 */}
      {fullTarget && (
        <ApprovalFullViewHost
          key={fullTarget.id}
          c={fullTarget as unknown as HostContract}
          docLabel={CONTRACT_TYPE_LABEL[fullTarget.type || ""] || "계약서"}
          myId={myId} myRole="본부"
          onClose={() => setFullTarget(null)}
          onDone={() => { setFullTarget(null); void fetchApprovals(); }}
        />
      )}
    </div>
  );
}
