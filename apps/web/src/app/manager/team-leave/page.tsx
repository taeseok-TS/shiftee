"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Check, X, AlertCircle, ChevronRight, Search, Loader2, Calendar, UmbrellaOff,
} from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

/* ── 타입 ── */
type ApprovalStep = {
  id: string;
  order: number;
  status: string;
  approver: { id: string; name: string; position: string | null } | null;
  approverRole?: string | null;
  branch?: string | null;
};

// 역할/지점 기반 단계는 승인 전까지 approver가 null → 역할 라벨로 표시
function stepLabel(s: ApprovalStep): string {
  if (s.approver) return s.approver.name;
  if (s.approverRole === "MANAGER") return `${s.branch ? `[${s.branch}] ` : ""}원장`;
  if (s.approverRole === "ADMIN") return "관리자";
  return "결재자";
}

type LeaveRequest = {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  user: { name: string; department: string | null; position: string | null };
  canCancel?: boolean;   // 서버 판정(lib/leave-cancel.ts) — 이 값으로만 취소 버튼을 그린다
  approvalSteps?: ApprovalStep[];
};

type LeaveApprovalStep = {
  id: string;
  order: number;
  status: string;
  leaveRequest: LeaveRequest;
};

// 휴가 내역 탭 — GET /api/leave (원장이면 담당 지점). canCancel 은 서버가 판정해 내려준다
type HistoryLeave = {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  canCancel?: boolean;
  cancelBlock?: string | null;   // 못 하는 이유 코드(서버) — 화면이 조건을 다시 쓰지 않게
  user: { id: string; name: string; branch: string | null };
  approvalSteps?: ApprovalStep[];
};

type ScheduleRequest = {
  id: string;
  userId: string;
  templateName: string;
  startDate: string;
  endDate: string;
  totalHours: number;
  status: string;
  user: { id: string; name: string; department: string | null; position: string | null };
  canCancel?: boolean;   // 서버 판정(lib/leave-cancel.ts) — 이 값으로만 취소 버튼을 그린다
  approvalSteps?: ApprovalStep[];
};

type ScheduleApprovalStep = {
  id: string;
  order: number;
  status: string;
  scheduleRequest: ScheduleRequest;
};

/* ── 상수 ── */
const LEAVE_TYPE_LABEL: Record<string, string> = {
  ANNUAL: "연차",
  HALF_AM: "오전반차",
  HALF_PM: "오후반차",
  QUARTER_AM: "오전반반차",
  QUARTER_PM: "오후반반차",
  COMPENSATORY: "대체휴무",
  COMPENSATORY_HALF: "대체휴무반차",
  SICK: "병가",
  SPECIAL: "특별휴가",
  CIVIL_DEFENSE: "민방위",
  RESERVE_FORCES: "예비군훈련",
  FAMILY_EVENT: "경조사",
  FAMILY_MARRIAGE: "결혼",
  FAMILY_BIRTH: "출산",
  FAMILY_BEREAVEMENT: "사망(조사)",
};

// 취소 불가 사유(서버 cancelBlock) → 짧은 표시. 없는 코드는 "-"
const CANCEL_BLOCK_LABEL: Record<string, string> = {
  PAST: "지난 휴가",
  ADMIN_ONLY: "관리자만 취소 가능",
  SELF_APPROVED: "관리자에게 요청",
  MAIN_ONLY: "메인 원장만 취소 가능",
};

/* ── 원장 결재 페이지 ── */
export default function ManagerApprovalsPage() {
  const [branch, setBranch] = useState<string>("");
  const [leaveSteps, setLeaveSteps] = useState<LeaveApprovalStep[]>([]);
  const [scheduleSteps, setScheduleSteps] = useState<ScheduleApprovalStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchName, setSearchName] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  // 메일의 "승인하기" 로 들어오면(?id=…) 그 건으로 스크롤·강조한다
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setHighlightId(id);
  }, []);
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById("leave-" + highlightId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    // 의존성 배열이 없으면 **매 렌더마다** 스크롤한다 — 짝인 admin/leave-approvals 와 같게 둔다
  }, [highlightId, leaveSteps]);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("leave");
  const [history, setHistory] = useState<HistoryLeave[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [myId, setMyId] = useState("");

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
        }
      } catch (error) {
        console.error("세션 조회 오류:", error);
      }
    };
    fetchSession();
  }, []);

  // 휴가 내역 — 결재함은 **내 차례인 대기 건**만 보여서, 내가 승인해 관리자에게 넘긴 건이나
  // 원장 선에서 최종 승인된 1일 휴가를 취소할 자리가 없었다(2026-09-10 디렉터 지시).
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
    fetchApprovals();
    fetchHistory();
  }, [fetchApprovals, fetchHistory]);

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

  // 승인/거절 처리


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
    const note = approved ? "\n승인된 휴가라 차감된 연차가 되돌아갑니다." : "";
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
    if (!confirm(`${who}님의 근무일정 신청을 취소할까요?\n\n취소하면 신청자에게 알림이 갑니다.`)) return;
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

  const handleApprove = async (requestId: string, type: "leave" | "schedule") => {
    try {
      setProcessingId(requestId);
      const endpoint = type === "leave"
        ? `/api/leave/${requestId}/approve`
        : `/api/schedule-requests/${requestId}/approve`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });

      if (res.ok) {
        toast.success("승인되었습니다");
        if (type === "leave") {
          setLeaveSteps(leaveSteps.filter(s => s.leaveRequest.id !== requestId));
          fetchHistory();
        } else {
          setScheduleSteps(scheduleSteps.filter(s => s.scheduleRequest.id !== requestId));
        }
      } else {
        const data = await res.json();
        toast.error(data.error || "처리 중 오류가 발생했습니다");
      }
    } catch (error) {
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
        toast.success("거절되었습니다");
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
        toast.error(data.error || "거절 처리 중 오류가 발생했습니다");
      }
    } catch (error) {
      toast.error("오류가 발생했습니다");
    } finally {
      setProcessingId(null);
    }
  };

  const totalCount = filteredLeaveSteps.length + filteredScheduleSteps.length;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">결재 (휴가, 근무일정)</h1>
          <p className="text-gray-600 mt-2">{branch} - 팀의 휴가 및 근무일정 신청 결재</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-600">
            대기 중: <span className="font-semibold text-amber-600">{totalCount}건</span>
          </div>
        </div>
      </div>

      {/* 검색 영역 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-sm mb-2 block">직원명 검색</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 text-gray-400" size={16} />
                <Input
                  placeholder="직원 이름으로 검색..."
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-sm mb-2 block">날짜 검색</Label>
              <Input
                type="date"
                value={searchDate}
                onChange={(e) => setSearchDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => {
                  setSearchName("");
                  setSearchDate("");
                }}
              >
                초기화
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 탭 */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="leave" className="flex items-center gap-2">
            <UmbrellaOff size={16} />
            휴가 ({filteredLeaveSteps.length})
          </TabsTrigger>
          <TabsTrigger value="schedule" className="flex items-center gap-2">
            <Calendar size={16} />
            근무일정 ({filteredScheduleSteps.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <UmbrellaOff size={16} />
            휴가 내역 ({filteredHistory.length})
          </TabsTrigger>
        </TabsList>

        {/* 휴가 탭 */}
        <TabsContent value="leave" className="space-y-6 mt-6">
          {loading ? (
            <Card>
              <CardContent className="pt-6 text-center text-gray-500">
                <Loader2 className="inline-block animate-spin mb-2" />
                <p>로드 중...</p>
              </CardContent>
            </Card>
          ) : filteredLeaveSteps.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-gray-500">
                {leaveSteps.length === 0 ? (
                  <>
                    <AlertCircle className="inline-block mb-2 text-gray-400" size={24} />
                    <p>결재 대기 중인 휴가 요청이 없습니다</p>
                  </>
                ) : (
                  <>
                    <Search className="inline-block mb-2 text-gray-400" size={24} />
                    <p>검색 결과가 없습니다</p>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">직원</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">유형</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">기간</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">사유</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">결재</th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">처리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredLeaveSteps.map((step) => {
                      const req = step.leaveRequest;
                      const typeLabel = LEAVE_TYPE_LABEL[req.type] || req.type;
                      const startDate = new Date(req.startDate);
                      const endDate = new Date(req.endDate);
                      const dateRange = `${format(startDate, "MM월 dd일", { locale: ko })} ~ ${format(endDate, "MM월 dd일", { locale: ko })}`;

                      return (
                        <tr
                          key={step.id}
                          id={"leave-" + req.id}
                          className={highlightId === req.id ? "bg-amber-50 ring-2 ring-amber-300" : "hover:bg-gray-50"}
                        >
                          <td className="px-6 py-4">
                            <div className="font-medium text-gray-900">{req.user.name}</div>
                            <div className="text-xs text-gray-500">{req.user.position || "-"}</div>
                          </td>
                          <td className="px-6 py-4">
                            <Badge variant="outline" className="bg-blue-50">{typeLabel}</Badge>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">
                            <div>{dateRange}</div>
                            <div className="text-xs text-gray-500">{req.days}일</div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700 max-w-xs truncate">
                            {req.reason || "-"}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1 text-xs flex-wrap">
                              {req.approvalSteps?.map((s, idx) => (
                                <span key={s.id} className="flex items-center gap-1">
                                  {idx > 0 && <ChevronRight size={12} className="text-gray-300" />}
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    s.status === "APPROVED" ? "bg-green-100 text-green-700" :
                                    s.status === "REJECTED" ? "bg-red-100 text-red-700" :
                                    s.status === "PENDING" ? "bg-amber-100 text-amber-700" :
                                    "bg-gray-100 text-gray-600"
                                  }`}>
                                    {stepLabel(s)}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex gap-2 justify-end">
                              {req.canCancel && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-gray-500 hover:bg-gray-100"
                                disabled={processingId === req.id}
                                title="신청 자체를 거둡니다 (반려와 달리 결재 기록에 남지 않습니다)"
                                onClick={() => handleCancelLeave(req.id, req.user.name)}
                              >
                                취소
                              </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-green-600 hover:bg-green-50"
                                disabled={processingId === req.id}
                                onClick={() => handleApprove(req.id, "leave")}
                              >
                                {processingId === req.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                승인
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600 hover:bg-red-50"
                                disabled={processingId === req.id}
                                onClick={() => {
                                  setRejectingId(req.id);
                                  setActiveTab("leave");
                                  setRejectOpen(true);
                                }}
                              >
                                {processingId === req.id ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                                거절
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* 근무일정 탭 */}
        <TabsContent value="schedule" className="space-y-6 mt-6">
          {loading ? (
            <Card>
              <CardContent className="pt-6 text-center text-gray-500">
                <Loader2 className="inline-block animate-spin mb-2" />
                <p>로드 중...</p>
              </CardContent>
            </Card>
          ) : filteredScheduleSteps.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-gray-500">
                {scheduleSteps.length === 0 ? (
                  <>
                    <AlertCircle className="inline-block mb-2 text-gray-400" size={24} />
                    <p>결재 대기 중인 근무일정 요청이 없습니다</p>
                  </>
                ) : (
                  <>
                    <Search className="inline-block mb-2 text-gray-400" size={24} />
                    <p>검색 결과가 없습니다</p>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">직원</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">템플릿</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">기간</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">계획시간</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">결재</th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">처리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredScheduleSteps.map((step) => {
                      const req = step.scheduleRequest;
                      const startDate = new Date(req.startDate);
                      const endDate = new Date(req.endDate);
                      const dateRange = `${format(startDate, "MM월 dd일", { locale: ko })} ~ ${format(endDate, "MM월 dd일", { locale: ko })}`;

                      return (
                        <tr key={step.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4">
                            <div className="font-medium text-gray-900">{req.user.name}</div>
                            <div className="text-xs text-gray-500">{req.user.position || "-"}</div>
                          </td>
                          <td className="px-6 py-4">
                            <Badge variant="outline" className="bg-purple-50">{req.templateName}</Badge>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">{dateRange}</td>
                          <td className="px-6 py-4 text-sm text-gray-700">{req.totalHours}시간</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1 text-xs flex-wrap">
                              {req.approvalSteps?.map((s, idx) => (
                                <span key={s.id} className="flex items-center gap-1">
                                  {idx > 0 && <ChevronRight size={12} className="text-gray-300" />}
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    s.status === "APPROVED" ? "bg-green-100 text-green-700" :
                                    s.status === "REJECTED" ? "bg-red-100 text-red-700" :
                                    s.status === "PENDING" ? "bg-amber-100 text-amber-700" :
                                    "bg-gray-100 text-gray-600"
                                  }`}>
                                    {stepLabel(s)}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex gap-2 justify-end">
                              {req.canCancel && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-gray-500 hover:bg-gray-100"
                                disabled={processingId === req.id}
                                title="신청 자체를 거둡니다 (반려와 달리 결재 기록에 남지 않습니다)"
                                onClick={() => handleCancelSchedule(req.id, req.user.name)}
                              >
                                취소
                              </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-green-600 hover:bg-green-50"
                                disabled={processingId === req.id}
                                onClick={() => handleApprove(req.id, "schedule")}
                              >
                                {processingId === req.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                승인
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600 hover:bg-red-50"
                                disabled={processingId === req.id}
                                onClick={() => {
                                  setRejectingId(req.id);
                                  setActiveTab("schedule");
                                  setRejectOpen(true);
                                }}
                              >
                                {processingId === req.id ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                                거절
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>
        {/* 휴가 내역 탭 — 진행 중·승인된 담당 지점 휴가. 결재함에서 빠진 건(내가 승인해 넘긴 건,
            원장 선에서 최종 승인된 1일 휴가)을 여기서 취소한다. 버튼은 서버 판정(canCancel)으로만 */}
        <TabsContent value="history" className="space-y-6 mt-6">
          {historyLoading ? (
            <Card>
              <CardContent className="pt-6 text-center text-gray-500">
                <Loader2 className="inline-block animate-spin mb-2" />
                <p>로드 중...</p>
              </CardContent>
            </Card>
          ) : filteredHistory.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-gray-500">
                <AlertCircle className="inline-block mb-2 text-gray-400" size={24} />
                <p>진행 중이거나 예정된 휴가가 없습니다</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">직원</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">유형</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">기간</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">상태</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">결재</th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">처리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredHistory.map((req) => {
                      const typeLabel = LEAVE_TYPE_LABEL[req.type] || req.type;
                      const dateRange = `${format(new Date(req.startDate), "MM월 dd일", { locale: ko })} ~ ${format(new Date(req.endDate), "MM월 dd일", { locale: ko })}`;
                      const approved = req.status === "APPROVED";
                      return (
                        <tr key={req.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4">
                            <div className="font-medium text-gray-900">{req.user.name}</div>
                            <div className="text-xs text-gray-500">{req.user.branch || "-"}</div>
                          </td>
                          <td className="px-6 py-4">
                            <Badge variant="outline" className="bg-blue-50">{typeLabel}</Badge>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">
                            <div>{dateRange}</div>
                            <div className="text-xs text-gray-500">{req.days}일</div>
                          </td>
                          <td className="px-6 py-4">
                            <Badge variant="outline" className={approved ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}>
                              {approved ? "승인" : "진행 중"}
                            </Badge>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1 text-xs flex-wrap">
                              {req.approvalSteps?.map((s, idx) => (
                                <span key={s.id} className="flex items-center gap-1">
                                  {idx > 0 && <ChevronRight size={12} className="text-gray-300" />}
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    s.status === "APPROVED" ? "bg-green-100 text-green-700" :
                                    s.status === "REJECTED" ? "bg-red-100 text-red-700" :
                                    s.status === "PENDING" ? "bg-amber-100 text-amber-700" :
                                    "bg-gray-100 text-gray-600"
                                  }`}>
                                    {stepLabel(s)}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            {req.canCancel ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-gray-500 hover:bg-gray-100"
                                disabled={processingId === req.id}
                                title={approved ? "취소하면 차감된 연차가 되돌아갑니다" : "신청 자체를 거둡니다"}
                                onClick={() => handleCancelLeave(req.id, req.user.name, approved, req.user.id)}
                              >
                                {processingId === req.id ? <Loader2 size={16} className="animate-spin" /> : null}
                                취소
                              </Button>
                            ) : (
                              <span className="text-xs text-gray-400">{CANCEL_BLOCK_LABEL[req.cancelBlock ?? ""] ?? "-"}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* 거절 사유 다이얼로그 */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>거절 사유</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="거절 사유를 입력해주세요"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setRejectOpen(false)}>
                취소
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700"
                onClick={() => handleRejectConfirm(activeTab as "leave" | "schedule")}
                disabled={processingId !== null}
              >
                {processingId !== null ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
                거절 확인
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
