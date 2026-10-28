"use client";
// 원장 「결재 › 결재함」(탭 휴가 · 근무일정 · 휴가 취소 · 출퇴근 요청)과 「휴가 › 지점 휴가」(?tab=history) — 본부 시안 R11 · R13(2026-10-21 「디자인 통일」).
//  · 결재함 = 관리자 결재함(R11)과 같은 모양: 알약 탭 한 줄 · 박스 안 표 · 줄마다 흰 「반려」 + 인디고 「승인」(의견은 승인 확인 창에 선택 입력), 「신청 취소」는 ⋮ 안
//  · 지점 휴가 = 휴가 관리(R13)와 같은 표(범위 우리 지점): 숫자 칸 · 상태 알약 · 결재 점. 원장 차례인 대기 건은 그 줄에서 바로 승인 · 반려
//  · 10/23 오픈 전 요청(■0-4 · ■2): 대기 건이 있는 탭이 먼저 열림(?tab= 우선) · 기간 끝 날짜에도 요일 · 시간 두 번 표기 정리(lib/schedule-label) ·
//    찾기 칸은 「찾기」를 눌러 열기 · 지점 휴가는 오늘 → 다가오는 순 + 이어진 날 한 줄(화면에서만 묶음, lib/leave-period) · 의견 · 취소 안내는 줄을 눌렀을 때만
//  · 원장대행으로 들어온 직원(/approvals)은 결재만 — 지점 휴가는 숨긴다(2026-10-07 #3)
import { LEAVE_LABELS } from "@/lib/leave-catalog";
import { useLeaveCatalog } from "@/components/leave/useLeaveCatalog";
import { Fragment, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CheckSquare, CalendarDays, UmbrellaOff, Search } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import LeaveCancelInbox from "@/components/leave/LeaveCancelInbox";
import AttendanceRequestInbox from "@/components/attendance/AttendanceRequestInbox";
import { postLeaveApprove } from "@/lib/leave-approve-client";
import { fmtRangeKo, groupContiguous, upcomingFirst, type LeaveGroup } from "@/lib/leave-period";
import { templateLabel } from "@/lib/schedule-label";
import {
  PageHead, Btn, Box, Tiles, Tile, PillTabs, FilterRow, Chip, inputClass, tableClass, Cell2, StatusPill, FlowDots, MoreMenu,
  type FlowStep, type MoreItem, type PillTab,
} from "@/components/kit";

/* ── 타입 ── */
type ApprovalStep = {
  id: string;
  order: number;
  status: string;
  approver: { id: string; name: string; position: string | null } | null;
  approverRole?: string | null;
  branch?: string | null;
  comment?: string | null;   // 결재자 의견(승인·반려 때 남긴 것)
};

// 역할/지점 기반 단계는 승인 전까지 approver가 null → 역할 라벨로 표시
function stepLabel(s: ApprovalStep): string {
  if (s.approver) return s.approver.name;
  if (s.approverRole === "MANAGER") return `${s.branch ? `[${s.branch}] ` : ""}원장`;
  if (s.approverRole === "ADMIN") return "관리자";
  return "결재자";
}
// 결재 진행 점(끝남 파랑 · 지금 차례 주황 · 남음 회색) + 결재자 의견 줄 — 옛 초록 · 주황 글자 알약 대신(R11 · R13)
const dotsOf = (steps: ApprovalStep[] | undefined): FlowStep[] =>
  (steps ?? []).map((s) => ({ label: stepLabel(s), state: s.status === "APPROVED" ? "done" : s.status === "PENDING" ? "now" : "todo" }));
const commentsOf = (steps: ApprovalStep[] | undefined) => (steps ?? []).filter((s) => s.comment).map((s) => `${stepLabel(s)}: ${s.comment}`);
function Flow({ steps, comments = true }: { steps?: ApprovalStep[]; comments?: boolean }) {
  const dots = dotsOf(steps);
  return (
    <>
      {dots.length ? <FlowDots steps={dots} /> : <span className="text-[#94a3b8]">—</span>}
      {comments && commentsOf(steps).map((c, i) => <span key={i} className="block text-[12px] text-[#596578]">의견 · {c}</span>)}
    </>
  );
}

type LeaveRequest = {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  user: { name: string; department: string | null; position: string | null; branch?: string | null };
  canCancel?: boolean;   // 서버 판정(lib/leave-cancel.ts) — 이 값으로만 취소를 보인다
  approvalSteps?: ApprovalStep[];
  attachmentUrl?: string | null;   // 신청 때 붙인 증빙(선택) — /api/leave/my-approvals 가 그대로 내려준다
  attachmentName?: string | null;
};

type LeaveApprovalStep = {
  id: string;
  order: number;
  status: string;
  leaveRequest: LeaveRequest;
};

// 지점 휴가(휴가 내역) — GET /api/leave (원장이면 담당 지점). canCancel 은 서버가 판정해 내려준다
type HistoryLeave = {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  canCancel?: boolean;
  cancelBlock?: string | null;   // 못 하는 이유 코드(서버) — 화면이 조건을 다시 쓰지 않게
  pendingCancel?: { id: string; mine: boolean } | null;   // 진행 중인 취소 결재(9/11)
  user: { id: string; name: string; branch: string | null };
  approvalSteps?: ApprovalStep[];
  attachmentUrl?: string | null;   // 증빙 — GET /api/leave 가 그대로 내려준다(승인된 뒤에도 연다, 2026-10-19)
  attachmentName?: string | null;
};

// 휴가 증빙 링크(결재 대기·지점 휴가 공용) — 결재 화면과 같은 주소를 그대로 연다(2026-10-19 디렉터).
// 열람 권한은 /uploads 쪽 lib/work-file-access 가 판정한다 — 담당 지점 밖 직원의 첨부는 원장에게 열리지 않는다.
// 휴가 한 건에 첨부는 하나다.
function LeaveAttachLink({ url, name }: { url?: string | null; name?: string | null }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" title={name || "첨부 보기"}
      className="mt-0.5 block whitespace-nowrap text-[12.5px] font-semibold text-[#4f46e5] hover:underline">첨부 1</a>
  );
}

type ScheduleRequest = {
  id: string;
  userId: string;
  templateName: string;
  startDate: string;
  endDate: string;
  totalHours: number;
  status: string;
  user: { id: string; name: string; department: string | null; position: string | null; branch?: string | null };
  canCancel?: boolean;   // 서버 판정(lib/leave-cancel.ts) — 이 값으로만 취소를 보인다
  approvalSteps?: ApprovalStep[];
};

type ScheduleApprovalStep = {
  id: string;
  order: number;
  status: string;
  scheduleRequest: ScheduleRequest;
};

/* ── 상수 ── */
const LEAVE_TYPE_LABEL: Record<string, string> = LEAVE_LABELS;   // 공용 객체 — useLeaveCatalog 가 본부 유형 이름을 채운다(#216-1)

// 취소 불가 사유(서버 cancelBlock) → 짧은 표시. 없는 코드는 "-"
const CANCEL_BLOCK_LABEL: Record<string, string> = {
  PAST: "지난 휴가",
  NEEDS_REQUEST: "본인 취소 요청으로만",
  IN_REVIEW: "원장 승인 후 — 본인 취소 불가",
  MAIN_ONLY: "대표원장만 취소 가능",
};

// 기간 표시 — 하루면 「10월 23일 (목)」, 여러 날이면 「10월 26일 (월) ~ 11월 30일 (월)」, 해가 바뀌면 연도까지(10/23 ■0-4 · ■2, lib/leave-period)
const rangeOf = (s: string, e: string) => fmtRangeKo(s, e);

/** 결재 대기 표 · 카드 한 줄(휴가 · 근무일정 공용) */
type DecideRow = {
  key: string; kind: "leave" | "schedule"; id: string; domId: string; cardId: string;
  name: string; nameSub: string; typeLabel: string; attach?: { url?: string | null; name?: string | null };
  period: string; periodSub: string; steps?: ApprovalStep[]; more: MoreItem[];
};

type TabKey = "leave" | "schedule" | "history" | "cancel" | "attendance";

/* ── 원장 결재 페이지 ── */
export default function ManagerApprovalsPage() {
  useLeaveCatalog();   // 본부가 만든 휴가 유형 이름을 받아 다시 그린다(#216-1)
  const [branch, setBranch] = useState<string>("");
  const [leaveSteps, setLeaveSteps] = useState<LeaveApprovalStep[]>([]);
  const [scheduleSteps, setScheduleSteps] = useState<ScheduleApprovalStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchName, setSearchName] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectKind, setRejectKind] = useState<"leave" | "schedule">("leave");   // 반려할 건의 종류 — 탭과 따로 둔다(지점 휴가 줄에서도 반려한다)
  const [rejectTitle, setRejectTitle] = useState("");
  // 승인 확인 — 의견은 선택(옛 「의견」 버튼 대신, 시안 R11 · 2026-10-07 #64 의견 남기고 승인)
  const [approveTarget, setApproveTarget] = useState<{ id: string; type: "leave" | "schedule"; title: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  // 메일의 "승인하기" 로 들어오면(?id=…) 그 건으로 스크롤·강조한다
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // 오늘(KST 기기 날짜) — 지점 휴가 「오늘 휴가」 칸. 그리는 중에 시계를 읽지 않게 처음 한 번 받아 둔다
  const [today, setToday] = useState("");
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    Promise.resolve().then(() => {
      if (id) setHighlightId(id);
      setToday(format(new Date(Date.now()), "yyyy-MM-dd"));
    });
  }, []);
  useEffect(() => {
    if (!highlightId) return;
    // 넓은 화면은 표 줄, 휴대폰은 카드 — 보이는 쪽으로(#219-16)
    const el = [document.getElementById("leave-" + highlightId), document.getElementById("leave-card-" + highlightId)]
      .find((e) => e && e.offsetParent !== null);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    // 의존성 배열이 없으면 **매 렌더마다** 스크롤한다 — 짝인 admin/leave-approvals 와 같게 둔다
  }, [highlightId, leaveSteps]);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [activeTab, setActiveTabState] = useState<TabKey>("leave");
  // 탭 = 주소 ?tab= (R8 검증 2 — 「휴가 내역」 탭은 레일 「휴가 › 지점 휴가」, 나머지는 「결재 › 결재함」). 다른 쿼리(?id= 강조)는 그대로 둔다
  // 사람이 탭을 골랐거나 주소에 ?tab= 이 있으면 true — 그때는 아래 「대기 건이 있는 탭 먼저」가 탭을 바꾸지 않는다(10/23 ■0-4)
  const tabPinned = useRef(false);
  const setActiveTab = (t: string) => {
    tabPinned.current = true;
    setActiveTabState(t as TabKey);
    const q = new URLSearchParams(window.location.search);
    if (t === "leave") q.delete("tab"); else q.set("tab", t);
    const qs = q.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
    window.dispatchEvent(new Event("rail:search"));
  };
  // 휴가 취소 결재 건수 — 탭 내용은 열 때만 그려지므로 숫자는 따로 받아 둔다(내용·처리는 LeaveCancelInbox)
  const [cancelCount, setCancelCount] = useState(0);
  // 출퇴근 요청 건수(2026-10-07 #9 #13 #15) — 휴가 취소와 같은 방식으로 숫자만 먼저 받는다(내용·처리는 AttendanceRequestInbox)
  const [attReqCount, setAttReqCount] = useState(0);
  // 건수를 다 받았는지 — 처음 열 탭(대기 건이 있는 탭)을 고를 때 쓴다
  const [attLoaded, setAttLoaded] = useState(false);
  const [cancelLoaded, setCancelLoaded] = useState(false);
  useEffect(() => {
    fetch("/api/attendance-requests?scope=inbox")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAttReqCount(d?.requests?.length ?? 0))
      .catch(() => {})
      .finally(() => setAttLoaded(true));
  }, []);
  // 대시보드·알림에서 ?tab=cancel 처럼 들어오면 그 탭을 연다(관리자 대시보드 "휴가 취소 승인 대기" 줄)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && ["leave", "schedule", "history", "cancel", "attendance"].includes(t)) {
      tabPinned.current = true;
      Promise.resolve().then(() => setActiveTabState(t as TabKey));
    }
  }, []);
  useEffect(() => {
    fetch("/api/leave/cancel-requests/my-approvals")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCancelCount(d?.steps?.length ?? 0))
      .catch(() => {})
      .finally(() => setCancelLoaded(true));
  }, []);
  const [history, setHistory] = useState<HistoryLeave[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyStatus, setHistoryStatus] = useState<"all" | "PENDING" | "APPROVED">("all");   // 지점 휴가 오른쪽 알약 필터(R13)
  const [myId, setMyId] = useState("");
  // 원장대행으로 들어온 직원(/approvals) — 결재만 하고, 지점 휴가 내역은 원장 화면 몫이라 숨긴다(2026-10-07 #3)
  const [myRole, setMyRole] = useState("");
  const delegateOnly = myRole === "EMPLOYEE";

  // 세션에서 지점 정보 가져오기
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          // 응답은 { user: {...} } 다 — 종전 data.branch 는 늘 undefined 라 머리글 지점명이 비어 있었다
          setBranch(data.user?.branch || "");
          setMyId(data.user?.id || "");
          setMyRole(data.user?.role || "");
        }
      } catch (error) {
        console.error("세션 조회 오류:", error);
      }
    };
    fetchSession();
  }, []);

  // 휴가 내역 — 결재함은 **내 차례인 대기 건**만 보여서, 내가 승인해 관리자에게 넘긴 대기 건을
  // 거둘 자리가 없었다(2026-09-10). 승인된 휴가는 본인의 취소 결재로만(9/11) — 여기선 표시만 한다.
  // 취소 가능 여부(canCancel)는 서버가 취소 라우트와 같은 함수로 판정한다.
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/leave?current=1");   // 진행 중·앞으로만 — 서버가 거른다
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setHistory(((data.requests || []) as HistoryLeave[])
        .filter((r) => r.status === "PENDING" || r.status === "APPROVED"));
    } catch (error) {
      // 실패를 빈 목록으로 보이면 "취소할 휴가가 없다"로 오해한다
      console.error("휴가 내역 조회 오류:", error);
      toast.error("휴가 내역을 불러오지 못했습니다");
      setHistory([]);   // 실패하면 비운다 — 옛 목록이 남아 있으면 지금 상태로 오해한다
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // 결재 대기 요청 조회
  const fetchApprovals = useCallback(async () => {
    try {
      setLoading(true);
      const [leaveRes, scheduleRes] = await Promise.all([
        fetch("/api/leave/my-approvals"),
        fetch("/api/schedule-requests/my-approvals"),
      ]);

      if (leaveRes.ok) {
        const data = await leaveRes.json();
        setLeaveSteps(data.steps || []);
      }

      if (scheduleRes.ok) {
        const data = await scheduleRes.json();
        setScheduleSteps(data.steps || []);
      }
    } catch (error) {
      console.error("결재 요청 조회 오류:", error);
      toast.error("데이터를 불러올 수 없습니다");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchApprovals();
      fetchHistory();
    });
  }, [fetchApprovals, fetchHistory]);

  // 처음 열면 대기 건이 있는 탭부터(10/23 ■0-4 — 「결재 대기 3건」인데 휴가 탭(0건)이 열려 「없습니다」가 보였다).
  // 주소 ?tab= 이 있거나 사람이 탭을 이미 골랐으면 그대로. 네 건수를 다 받은 뒤 한 번만 고른다. 모두 0이면 휴가 탭 그대로
  useEffect(() => {
    if (tabPinned.current || loading || !attLoaded || !cancelLoaded) return;
    tabPinned.current = true;
    const counts: [TabKey, number][] = [["leave", leaveSteps.length], ["schedule", scheduleSteps.length], ["cancel", cancelCount], ["attendance", attReqCount]];
    const first = counts.find(([, n]) => n > 0)?.[0];
    if (first && first !== "leave") Promise.resolve().then(() => setActiveTabState(first));
  }, [loading, attLoaded, cancelLoaded, leaveSteps.length, scheduleSteps.length, cancelCount, attReqCount]);

  // 검색 필터링
  const filteredLeaveSteps = useMemo(() => {
    return leaveSteps.filter(step => {
      const req = step.leaveRequest;
      const nameMatch = req.user.name.toLowerCase().includes(searchName.toLowerCase());
      const dateMatch = !searchDate || req.startDate.includes(searchDate) || req.endDate.includes(searchDate);
      return nameMatch && dateMatch;
    });
  }, [leaveSteps, searchName, searchDate]);

  const filteredScheduleSteps = useMemo(() => {
    return scheduleSteps.filter(step => {
      const req = step.scheduleRequest;
      const nameMatch = req.user.name.toLowerCase().includes(searchName.toLowerCase());
      const dateMatch = !searchDate || req.startDate.includes(searchDate) || req.endDate.includes(searchDate);
      return nameMatch && dateMatch;
    });
  }, [scheduleSteps, searchName, searchDate]);

  const filteredHistory = useMemo(() => {
    return history.filter(req => {
      const nameMatch = req.user.name.toLowerCase().includes(searchName.toLowerCase());
      const dateMatch = !searchDate || req.startDate.includes(searchDate) || req.endDate.includes(searchDate);
      return nameMatch && dateMatch;
    });
  }, [history, searchName, searchDate]);
  const shownHistory = useMemo(
    () => (historyStatus === "all" ? filteredHistory : filteredHistory.filter((r) => r.status === historyStatus)),
    [filteredHistory, historyStatus],
  );

  // 휴가 신청 취소 — 근무일정과 **같은 기준**이다(원장은 담당 지점 직원의 건, 서버가 재확인).
  // 근무일정에만 붙이고 휴가를 빠뜨렸던 것을 맞춘다(2026-09-09 검증에서 적발).
  const handleCancelLeave = async (requestId: string, who: string, approved = false, ownerId?: string) => {
    // 본인 건인지는 누르는 순간에 판단한다 — 내 정보가 아직 안 왔으면 그 자리에서 받아 온다
    // (종전엔 로딩 전에 누르면 본인 건에도 "신청자에게 알림이 갑니다"가 떴다)
    let me = myId;
    if (ownerId && !me) {
      me = (await fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).catch(() => null))?.user?.id || "";
    }
    const mine = !!ownerId && ownerId === me;
    // 승인된 휴가는 여기로 오지 않는다(취소 결재로만 — 9/11). 대기 건만 거둔다.
    const note = approved ? "" : "";
    const ask = mine
      ? "내 휴가 신청을 취소할까요?"   // 본인 건은 알림이 가지 않는다
      : `${who}님의 휴가 신청을 취소할까요?${note}\n\n취소하면 신청자에게 알림이 갑니다.`;
    if (!confirm(ask)) return;
    try {
      setProcessingId(requestId);
      const res = await fetch(`/api/leave/${requestId}`, { method: "PATCH" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("신청을 취소했습니다");
        setLeaveSteps(prev => prev.filter(s => s.leaveRequest.id !== requestId));
        setHistory(prev => prev.filter(h => h.id !== requestId));
      } else {
        toast.error(data.error || "취소하지 못했습니다");
      }
    } catch {
      toast.error("오류가 발생했습니다");
    } finally {
      setProcessingId(null);
    }
  };

  // 신청 취소 — 원장은 담당 지점 직원의 **대기 중** 신청만 취소할 수 있다(서버가 재확인).
  // 반려와 다르다: 반려는 "안 된다"는 결재 결과로 기록에 남고, 취소는 신청 자체를 거둔다.
  const handleCancelSchedule = async (requestId: string, who: string) => {
    if (!confirm(`${who}님의 근무 변경 요청을 취소할까요?\n\n취소하면 신청자에게 알림이 갑니다.`)) return;
    try {
      setProcessingId(requestId);
      const res = await fetch(`/api/schedule-requests/${requestId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("신청을 취소했습니다");
        setScheduleSteps(scheduleSteps.filter(s => s.scheduleRequest.id !== requestId));
      } else {
        toast.error(data.error || "취소하지 못했습니다");
      }
    } catch {
      toast.error("오류가 발생했습니다");
    } finally {
      setProcessingId(null);
    }
  };

  const handleApprove = async (requestId: string, type: "leave" | "schedule", note?: string) => {
    try {
      setProcessingId(requestId);
      const endpoint = type === "leave"
        ? `/api/leave/${requestId}/approve`
        : `/api/schedule-requests/${requestId}/approve`;

      // 휴가는 잔여 부족이면 관리자(원장 모드로 들어온 본부)만 한 번 더 확인하고 예외 승인 — 원장은 서버가 그대로 막는다(lib/leave-approve-client)
      const r = type === "leave"
        ? await postLeaveApprove(requestId, note ? { reason: note } : {})
        : await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "approve", ...(note ? { reason: note } : {}) }),
          }).then(async (res) => ({ ok: res.ok, cancelled: false, error: res.ok ? "" : (await res.json().catch(() => ({}))).error || "처리 중 오류가 발생했습니다" }));

      if (r.ok) {
        toast.success("승인되었습니다");
        if (type === "leave") {
          setLeaveSteps(leaveSteps.filter(s => s.leaveRequest.id !== requestId));
          fetchHistory();
        } else {
          setScheduleSteps(scheduleSteps.filter(s => s.scheduleRequest.id !== requestId));
        }
      } else if (!r.cancelled) {
        toast.error(r.error);
      }
    } catch {
      toast.error("오류가 발생했습니다");
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectConfirm = async (type: "leave" | "schedule") => {
    if (!rejectingId) return;

    try {
      setProcessingId(rejectingId);
      const endpoint = type === "leave"
        ? `/api/leave/${rejectingId}/approve`
        : `/api/schedule-requests/${rejectingId}/approve`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reason: rejectReason }),
      });

      if (res.ok) {
        toast.success("반려되었습니다");
        if (type === "leave") {
          setLeaveSteps(leaveSteps.filter(s => s.leaveRequest.id !== rejectingId));
          fetchHistory();
        } else {
          setScheduleSteps(scheduleSteps.filter(s => s.scheduleRequest.id !== rejectingId));
        }
        setRejectOpen(false);
        setRejectReason("");
        setRejectingId(null);
      } else {
        const data = await res.json();
        toast.error(data.error || "반려 처리 중 오류가 발생했습니다");
      }
    } catch {
      toast.error("오류가 발생했습니다");
    } finally {
      setProcessingId(null);
    }
  };

  const totalCount = filteredLeaveSteps.length + filteredScheduleSteps.length + cancelCount + attReqCount;

  // 승인 · 반려 창 열기(결재 대기 표 · 지점 휴가 표 공용)
  const askApprove = (id: string, type: "leave" | "schedule", title: string) => { setNoteText(""); setApproveTarget({ id, type, title }); };
  const askReject = (id: string, type: "leave" | "schedule", title: string) => { setRejectReason(""); setRejectingId(id); setRejectKind(type); setRejectTitle(title); setRejectOpen(true); };

  /* ── 결재 대기 줄(휴가 · 근무일정) — 표 · 휴대폰 카드가 같은 줄을 쓴다(2026-10-16 이예지 QA #219-16 — 390px 에서 처리 칸이 잘렸다) ── */
  const leaveRows: DecideRow[] = filteredLeaveSteps.map((step) => {
    const req = step.leaveRequest;
    return {
      key: step.id, kind: "leave", id: req.id, domId: "leave-" + req.id, cardId: "leave-card-" + req.id,
      name: req.user.name, nameSub: [req.user.branch, req.user.position].filter(Boolean).join(" · ") || "-",
      typeLabel: LEAVE_TYPE_LABEL[req.type] || req.type, attach: { url: req.attachmentUrl, name: req.attachmentName },
      period: rangeOf(req.startDate, req.endDate), periodSub: `${req.days}일${req.reason ? ` · 사유 ${req.reason}` : ""}`,
      steps: req.approvalSteps,
      // 신청 자체를 거둔다(반려와 달리 결재 기록에 남지 않는다) — 서버 판정(canCancel)으로만
      more: [{ label: "신청 취소", danger: true, hidden: !req.canCancel, onClick: () => void handleCancelLeave(req.id, req.user.name) }],
    };
  });
  const scheduleRows: DecideRow[] = filteredScheduleSteps.map((step) => {
    const req = step.scheduleRequest;
    return {
      key: step.id, kind: "schedule", id: req.id, domId: "schedule-" + req.id, cardId: "schedule-card-" + req.id,
      name: req.user.name, nameSub: [req.user.branch, req.user.position].filter(Boolean).join(" · ") || "-",
      typeLabel: "근무 변경",
      period: rangeOf(req.startDate, req.endDate), periodSub: `계획 ${req.totalHours}시간 · ${templateLabel(req.templateName)}`,
      steps: req.approvalSteps,
      more: [{ label: "신청 취소", danger: true, hidden: !req.canCancel, onClick: () => void handleCancelSchedule(req.id, req.user.name) }],
    };
  });

  const decideActions = (r: DecideRow) => (
    <span className="inline-flex items-center gap-1.5">
      <Btn className="px-3.5 py-1.5" disabled={processingId === r.id} onClick={() => askReject(r.id, r.kind, `${r.name} — ${r.typeLabel} ${r.period}`)}>반려</Btn>
      <Btn kind="primary" className="px-3.5 py-1.5" disabled={processingId === r.id} onClick={() => askApprove(r.id, r.kind, `${r.name} — ${r.typeLabel} ${r.period}`)}>
        {processingId === r.id ? "처리 중…" : "승인"}
      </Btn>
      <MoreMenu items={r.more} />
    </span>
  );

  // 찾기 줄 — 탭마다 같은 줄(출퇴근 요청은 이름만 찾는다 — 그 목록은 날짜로 거르지 않는다).
  // 기본은 접어 두고 「찾기」를 눌러 연다(10/23 ■2 · ■4 — 목록보다 먼저 크게 자리를 차지했다). 값이 들어 있으면 열린 채로
  const findShown = findOpen || !!searchName || !!searchDate;
  const findToggle = (
    <Btn kind="text" className="min-h-11" aria-expanded={false} onClick={() => setFindOpen(true)}><Search size={14} />찾기</Btn>
  );
  const filters = (withDate: boolean, right?: ReactNode) => (!findShown ? (right ? <FilterRow right={right}>{findToggle}</FilterRow> : null) : (
    <FilterRow right={right}>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
        <input type="search" value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="직원 이름으로 찾기" aria-label="직원 이름"
          className={`${inputClass} w-52 pl-8`} />
      </div>
      {withDate && <input type="date" max="9999-12-31" value={searchDate} onChange={(e) => setSearchDate(e.target.value)} className={inputClass} aria-label="날짜" />}
      <Btn kind="text" className="min-h-11" onClick={() => { setSearchName(""); setSearchDate(""); setFindOpen(false); }}>{searchName || (withDate && searchDate) ? "지우고 닫기" : "닫기"}</Btn>
    </FilterRow>
  ));
  const emptyLine = (text: string) => <p className="px-6 py-10 text-center text-[14px] text-[#596578]">{text}</p>;

  const decideTable = (rows: DecideRow[], total: number, emptyText: string) => (
    loading ? emptyLine("불러오는 중…")
    : rows.length === 0 ? emptyLine(total === 0 ? emptyText : "검색 결과가 없습니다")
    : (<>
      {/* 넓은 화면 = 표 */}
      <div className="hidden overflow-x-auto md:block">
        <table className={tableClass}>
          <thead>
            <tr><th>직원</th><th>종류</th><th>기간</th><th>결재 진행</th><th className="text-right">처리</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} id={r.domId} className={highlightId === r.id ? "bg-[#eef2ff]" : "hover:bg-[#fafbfd]"}>
                <td><Cell2 main={r.name} sub={r.nameSub} /></td>
                <td>
                  <StatusPill tone="wait">{r.typeLabel}</StatusPill>
                  <LeaveAttachLink url={r.attach?.url} name={r.attach?.name} />
                </td>
                <td className="max-w-[22rem]">
                  <span className="text-[#0f172a]">{r.period}</span>
                  <span className="block truncate text-[12.5px] text-[#596578]" title={r.periodSub}>{r.periodSub}</span>
                </td>
                <td><Flow steps={r.steps} /></td>
                <td className="whitespace-nowrap text-right">{decideActions(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 휴대폰 = 카드 */}
      <div className="space-y-2 p-3 md:hidden">
        {rows.map((r) => (
          <div key={r.key} id={r.cardId} className={`rounded-xl border border-[#eef1f5] p-3 ${highlightId === r.id ? "bg-[#eef2ff]" : "bg-white"}`}>
            <div className="flex items-start justify-between gap-2">
              <Cell2 main={r.name} sub={r.nameSub} />
              <div className="text-right"><StatusPill tone="wait">{r.typeLabel}</StatusPill><LeaveAttachLink url={r.attach?.url} name={r.attach?.name} /></div>
            </div>
            <p className="mt-1.5 text-[14px] text-[#0f172a]">{r.period}</p>
            <p className="text-[12.5px] text-[#596578]">{r.periodSub}</p>
            {(r.steps ?? []).length > 0 && <div className="mt-1.5"><Flow steps={r.steps} /></div>}
            <div className="mt-2 flex justify-end">{decideActions(r)}</div>
          </div>
        ))}
      </div>
    </>)
  );

  /* ── 지점 휴가 줄(R13 · 10/23 S2-4) — 상태 알약 · 처리. 원장 차례인 대기 건은 승인 · 반려 두 개, 신청 취소는 ⋮.
        이어진 날(같은 사람 · 같은 유형 · 같은 상태, 사이 주말 · 공휴일만)은 한 줄로 묶고, 결재 의견 · 취소 안내는 줄을 눌렀을 때만 ── */
  const myTurnIds = useMemo(() => new Set(leaveSteps.map((s) => s.leaveRequest.id)), [leaveSteps]);
  // 묶음(이어진 날)이면 취소 결재 중인 건수를 붙인다 — 묶음 안 한 건만 취소 중이어도 전체가 취소되는 것처럼 보이지 않게(10/23 검증)
  const historyStatusPill = (req: Pick<HistoryLeave, "status" | "pendingCancel">, cancelCount?: number) => (
    <>
      <StatusPill tone={req.status === "APPROVED" ? "done" : "wait"}>{req.status === "APPROVED" ? "승인" : "승인 대기"}</StatusPill>
      {req.pendingCancel && <span className="mt-0.5 block whitespace-nowrap text-[12px] font-semibold text-[#b45309]">취소 결재 중{cancelCount ? ` ${cancelCount}건` : ""}</span>}
    </>
  );
  const groupCancelCount = (items: HistoryLeave[]) => (items.length > 1 ? items.filter((x) => x.pendingCancel).length : 0);
  const hasActions = (req: HistoryLeave) => !!req.canCancel || (req.status === "PENDING" && myTurnIds.has(req.id));
  const historyActions = (req: HistoryLeave) => {
    const approved = req.status === "APPROVED";
    const myTurn = req.status === "PENDING" && myTurnIds.has(req.id);
    const typeLabel = LEAVE_TYPE_LABEL[req.type] || req.type;
    const title = `${req.user.name} — ${typeLabel} ${rangeOf(req.startDate, req.endDate)}`;
    const more: MoreItem[] = [
      // 신청 자체를 거둔다 — 서버 판정(canCancel)으로만
      { label: "신청 취소", danger: true, hidden: !req.canCancel, onClick: () => void handleCancelLeave(req.id, req.user.name, approved, req.user.id) },
    ];
    // 할 수 있는 게 없으면 비워 둔다 — 못 하는 이유(「본인 취소 요청으로만」 등)는 줄을 눌렀을 때 안에서(10/23 ■2 반복 문구)
    if (!myTurn && !req.canCancel) return null;
    // 원장 차례인데 신청 취소는 못 하면 ⋮ 대신 못 하는 이유를 마우스를 올리면 보이게(검증 4)
    return (
      <span className="inline-flex items-center gap-1.5" title={!req.canCancel ? `신청 취소: ${CANCEL_BLOCK_LABEL[req.cancelBlock ?? ""] ?? "불가"}` : undefined}
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {myTurn && (<>
          <Btn className="px-3.5 py-1.5" disabled={processingId === req.id} onClick={() => askReject(req.id, "leave", title)}>반려</Btn>
          <Btn kind="primary" className="px-3.5 py-1.5" disabled={processingId === req.id} onClick={() => askApprove(req.id, "leave", title)}>
            {processingId === req.id ? "처리 중…" : "승인"}
          </Btn>
        </>)}
        {req.canCancel && <MoreMenu items={more} />}
      </span>
    );
  };

  // 이어진 날 묶기에 쓰는 공휴일(사이에 공휴일만 끼어 있으면 이어진 것) — 목록에 나온 해만 받는다
  const [holidaySet, setHolidaySet] = useState<Set<string>>(() => new Set());
  const histYears = useMemo(() => [...new Set(history.flatMap((r) => [r.startDate.slice(0, 4), r.endDate.slice(0, 4)]))].sort().join(","), [history]);
  useEffect(() => {
    if (!histYears) return;
    let alive = true;
    Promise.all(histYears.split(",").map((y) => fetch(`/api/holidays?year=${y}`).then((r) => (r.ok ? r.json() : { holidays: [] })).catch(() => ({ holidays: [] }))))
      .then((list) => { if (alive) setHolidaySet(new Set(list.flatMap((d) => ((d.holidays || []) as { date: string }[]).map((h) => h.date)))); });
    return () => { alive = false; };
  }, [histYears]);
  // 오늘 → 다가오는 순으로 줄 세운 뒤 묶는다(묶음 순서 = 묶음 첫 날 순). DB 는 그대로 — 화면에서만
  type HistoryRow = HistoryLeave & { userId: string };
  const historyGroups: LeaveGroup<HistoryRow>[] = useMemo(
    () => groupContiguous(upcomingFirst(shownHistory.map((r) => ({ ...r, userId: r.user.id })), today), holidaySet),
    [shownHistory, today, holidaySet],
  );
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const toggleGroup = (key: string) => setOpenGroup((k) => (k === key ? null : key));
  const groupRowProps = (key: string) => ({
    role: "button" as const, tabIndex: 0, "aria-expanded": openGroup === key,
    onClick: () => toggleGroup(key),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(key); } },
  });
  // 눌렀을 때 보이는 안쪽 — 날짜별 건(묶음이면) · 결재 진행과 의견 · 취소 안내 · 첨부 · 건별 처리
  const groupDetail = (g: LeaveGroup<HistoryRow>) => (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      {g.items.map((req) => {
        const block = !req.canCancel ? CANCEL_BLOCK_LABEL[req.cancelBlock ?? ""] : undefined;
        return (
          <div key={req.id} className="flex flex-wrap items-start justify-between gap-2 rounded-[10px] border border-[#eef1f5] bg-[#fafbfd] px-3 py-2">
            <div className="min-w-0 text-[13.5px] text-[#475569]">
              {g.items.length > 1 && <p className="font-semibold text-[#0f172a]">{rangeOf(req.startDate, req.endDate)} <span className="font-normal text-[#596578]">· {req.days}일</span></p>}
              <Flow steps={req.approvalSteps} />
              {block && <span className="block text-[12.5px] text-[#596578]">{block}</span>}
              <LeaveAttachLink url={req.attachmentUrl} name={req.attachmentName} />
            </div>
            {g.items.length > 1 && <div className="shrink-0">{historyActions(req)}</div>}
          </div>
        );
      })}
    </div>
  );
  // 묶음 줄의 처리 칸 — 한 건이면 그 건의 버튼, 여러 건이면 눌러서 안에서(건마다 결재 · 취소가 따로라)
  const groupActions = (g: LeaveGroup<HistoryRow>) => g.items.length === 1
    ? historyActions(g.first)
    : g.items.some(hasActions) ? <span className="text-[12.5px] font-semibold text-[#4f46e5]">{openGroup === g.key ? "접기" : `${g.items.length}건 · 눌러서 처리`}</span> : null;
  const todayCount = today ? history.filter((r) => r.status === "APPROVED" && r.startDate.slice(0, 10) <= today && today <= r.endDate.slice(0, 10)).length : null;

  const isHistory = activeTab === "history" && !delegateOnly;
  const inboxTab = delegateOnly && activeTab === "history" ? "leave" : activeTab;
  const inboxTabs: PillTab[] = [
    { key: "leave", label: "휴가", count: filteredLeaveSteps.length },
    { key: "schedule", label: "근무 변경", count: filteredScheduleSteps.length },
    { key: "cancel", label: "휴가 취소", count: cancelCount },
    { key: "attendance", label: "출퇴근 수정", count: attReqCount },
    // 처리한 요청 — 같은 결재함 안 탭(관리자 R11 과 같다), 화면은 내 요청 › 내가 처리한 것
    { key: "decided", label: "처리한 요청", href: "/requests?who=decided" },
  ];

  return (
    <div>
      {/* 제목 = 메뉴 이름(R8 — 원장 결재 › 결재함, 「휴가 내역」 탭 = 휴가 › 지점 휴가) */}
      <PageHead
        crumb={isHistory ? "휴가 › 지점 휴가" : "결재 › 결재함"}
        title={isHistory ? "지점 휴가" : "결재함"}
        note={isHistory
          ? `${branch ? `${branch} · ` : ""}지점 직원의 진행 중 · 예정 휴가`
          : delegateOnly ? `원장대행 · 지정된 지점 · 결재 대기 ${totalCount}건` : `${branch ? `${branch} · ` : ""}결재 대기 ${totalCount}건`}
      />

      {isHistory ? (<>
        {/* 지점 휴가 숫자 칸(R13) — 승인 대기 1 이상 빨강(누르면 결재함 휴가 탭), 나머지는 누르면 아래 표가 그 상태로 */}
        <Box icon={<CalendarDays />} tone="amb" title="휴가 현황" sub="진행 중 · 예정 휴가 기준">
          <Tiles cols={5}>
            <Tile label="오늘 휴가" value={historyLoading ? null : todayCount} unit="명" />
            <Tile label="승인 대기" value={loading ? null : leaveSteps.length} unit="건" note="내 결재 대기" alert onClick={() => setActiveTab("leave")} />
            <Tile label="결재 진행 중" value={historyLoading ? null : history.filter((r) => r.status === "PENDING").length} unit="건" active={historyStatus === "PENDING"} onClick={() => setHistoryStatus("PENDING")} />
            <Tile label="승인 완료" value={historyLoading ? null : history.filter((r) => r.status === "APPROVED").length} unit="건" active={historyStatus === "APPROVED"} onClick={() => setHistoryStatus("APPROVED")} />
            <Tile label="진행 · 예정 전체" value={historyLoading ? null : history.length} unit="건" note="우리 지점" hl active={historyStatus === "all"} onClick={() => setHistoryStatus("all")} />
          </Tiles>
        </Box>

        {/* 지점 휴가 표 — 결재함에서 빠진 대기 건(내가 승인해 넘긴 건)을 여기서 거둔다. 승인된 휴가는 본인의 취소 결재로만(9/11). 버튼은 서버 판정(canCancel)으로만 */}
        <Box icon={<UmbrellaOff />} tone="sky" title="신청 목록" sub={historyLoading ? "불러오는 중…" : `${historyGroups.length}건 · 오늘부터 다가오는 순`}>
          {filters(true, ([
            { value: "all", label: "전체" },
            { value: "PENDING", label: "대기" },
            { value: "APPROVED", label: "승인" },
          ] as const).map(({ value, label }) => <Chip key={value} on={historyStatus === value} onClick={() => setHistoryStatus(value)}>{label}</Chip>))}
          {historyLoading ? emptyLine("불러오는 중…")
          : shownHistory.length === 0 ? emptyLine(history.length && (searchName || searchDate || historyStatus !== "all") ? "검색 결과가 없습니다" : "진행 중이거나 예정된 휴가가 없습니다")
          : (<>
            <div className="hidden overflow-x-auto md:block">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th>직원</th>
                    <th className="whitespace-nowrap">유형</th>
                    <th>기간</th>
                    <th className="whitespace-nowrap">일수</th>
                    <th>결재</th>
                    <th>상태</th>
                    <th className="text-right">처리</th>
                  </tr>
                </thead>
                <tbody>
                  {historyGroups.map((g) => {
                    const req = g.first;
                    const lit = g.items.some((x) => x.id === highlightId);
                    return (
                      <Fragment key={g.key}>
                        <tr {...groupRowProps(g.key)} className={`cursor-pointer outline-none ${lit ? "bg-[#eef2ff]" : openGroup === g.key ? "bg-[#fafbfd]" : "hover:bg-[#fafbfd] focus-visible:bg-[#fafbfd]"}`}>
                          <td><Cell2 main={req.user.name} sub={req.user.branch || "-"} /></td>
                          <td className="whitespace-nowrap font-semibold text-[#0f172a]">{LEAVE_TYPE_LABEL[req.type] || req.type}</td>
                          <td className="whitespace-nowrap text-[#475569]">{rangeOf(g.startDate, g.endDate)}</td>
                          <td className="whitespace-nowrap tabular-nums text-[#475569]">{g.days}일</td>
                          <td><Flow steps={req.approvalSteps} comments={false} /></td>
                          <td>{historyStatusPill({ status: req.status, pendingCancel: g.items.find((x) => x.pendingCancel)?.pendingCancel ?? null }, groupCancelCount(g.items))}</td>
                          <td className="whitespace-nowrap text-right">{groupActions(g)}</td>
                        </tr>
                        {openGroup === g.key && (
                          <tr className="bg-[#fafbfd]"><td colSpan={7} className="!pt-0">{groupDetail(g)}</td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* 휴대폰 = 한두 줄 카드 「이름 · 연차 / 11월 2일 (월) ~ 4일 (수) · 3일 · 승인」, 누르면 안쪽 */}
            <div className="divide-y divide-[#f1f5f9] md:hidden">
              {historyGroups.map((g) => {
                const req = g.first;
                const lit = g.items.some((x) => x.id === highlightId);
                return (
                  <div key={g.key} {...groupRowProps(g.key)} className={`cursor-pointer px-4 py-3 outline-none ${lit ? "bg-[#eef2ff]" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-[#0f172a]">{req.user.name} <span className="text-[13.5px] font-semibold text-[#475569]">· {LEAVE_TYPE_LABEL[req.type] || req.type}</span></p>
                        <p className="text-[13.5px] text-[#475569]">{rangeOf(g.startDate, g.endDate)} · {g.days}일</p>
                      </div>
                      <div className="shrink-0 text-right">{historyStatusPill({ status: req.status, pendingCancel: g.items.find((x) => x.pendingCancel)?.pendingCancel ?? null }, groupCancelCount(g.items))}</div>
                    </div>
                    {openGroup === g.key && <div className="mt-2">{groupDetail(g)}</div>}
                    {(() => { const a = groupActions(g); return a ? <div className="mt-2 flex justify-end">{a}</div> : null; })()}
                  </div>
                );
              })}
            </div>
          </>)}
        </Box>
      </>) : (<>
        {/* 결재함 알약 탭 한 줄(R11) — 옛 위 검색 카드 + 다섯 칸 탭 두 겹 대신 */}
        <PillTabs tabs={inboxTabs} value={inboxTab} onChange={setActiveTab} />

        {inboxTab === "leave" && (
          <Box icon={<CheckSquare />} tone="rose" title="휴가" count={filteredLeaveSteps.length} sub="내 결재 대기" right={findShown ? undefined : findToggle}>
            {filters(true)}
            {decideTable(leaveRows, leaveSteps.length, "결재 대기 중인 휴가 요청이 없습니다")}
          </Box>
        )}
        {inboxTab === "schedule" && (
          <Box icon={<CheckSquare />} tone="rose" title="근무 변경" count={filteredScheduleSteps.length} sub="내 결재 대기" right={findShown ? undefined : findToggle}>
            {filters(true)}
            {decideTable(scheduleRows, scheduleSteps.length, "결재 대기 중인 근무 변경 요청이 없습니다")}
          </Box>
        )}
        {/* 휴가 취소 결재 — 관리자·원장 결재함이 **같은 컴포넌트**를 쓴다(짝 누락 방지) */}
        {inboxTab === "cancel" && (
          <Box icon={<CheckSquare />} tone="rose" title="휴가 취소" count={cancelCount} sub="승인하면 휴가가 취소되고 연차가 돌아갑니다" right={findShown ? undefined : findToggle}>
            {filters(true)}
            <div className="px-6 py-4"><LeaveCancelInbox onCount={setCancelCount} searchName={searchName} searchDate={searchDate} /></div>
          </Box>
        )}
        {/* 출퇴근 요청 — 관리자·원장(대행) 결재함이 **같은 컴포넌트**를 쓴다 */}
        {inboxTab === "attendance" && (
          <Box icon={<CheckSquare />} tone="rose" title="출퇴근 수정" count={attReqCount} sub="지점 밖 · 사진 · 본부 요청 · 기록 수정 · 퇴근 누락" right={findShown ? undefined : findToggle}>
            {filters(false)}
            <div className="px-6 py-4"><AttendanceRequestInbox onCount={setAttReqCount} searchName={searchName} /></div>
          </Box>
        )}
      </>)}

      {/* 승인 확인 — 의견은 선택(옛 「의견」 버튼 대신, 시안 R11) */}
      <Dialog open={!!approveTarget} onOpenChange={(o) => { if (!o) setApproveTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>승인</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-700">{approveTarget?.title}</p>
            <div>
              <Label className="mb-1 block text-sm">의견 <span className="text-xs font-normal text-gray-400">(선택 — 다음 결재자와 본부가 봅니다)</span></Label>
              <Textarea value={noteText} maxLength={300} onChange={(e) => setNoteText(e.target.value)} rows={3} />
            </div>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setApproveTarget(null)}>닫기</Btn>
              <Btn kind="primary" disabled={processingId !== null} onClick={async () => {
                if (!approveTarget) return;
                const t = approveTarget;
                setApproveTarget(null);
                await handleApprove(t.id, t.type, noteText.trim() || undefined);
              }}>승인</Btn>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 반려 사유 */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>반려</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {rejectTitle && <p className="text-sm text-gray-700">{rejectTitle}</p>}
            <div>
              <Label className="mb-1 block text-sm">반려 사유</Label>
              <Textarea
                placeholder="반려 사유를 입력해 주세요"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={4}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setRejectOpen(false)}>닫기</Btn>
              <Btn kind="primary" onClick={() => handleRejectConfirm(rejectKind)} disabled={processingId !== null}>
                {processingId !== null ? "처리 중…" : "반려하기"}
              </Btn>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
