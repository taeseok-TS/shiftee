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
  approvalSteps?: ApprovalStep[];
};

type LeaveApprovalStep = {
  id: string;
  order: number;
  status: string;
  leaveRequest: LeaveRequest;
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
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("leave");

  // 세션에서 지점 정보 가져오기
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          setBranch(data.branch || "");
        }
      } catch (error) {
        console.error("세션 조회 오류:", error);
      }
    };
    fetchSession();
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
  }, [fetchApprovals]);

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

  // 승인/거절 처리
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
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="leave" className="flex items-center gap-2">
            <UmbrellaOff size={16} />
            휴가 ({filteredLeaveSteps.length})
          </TabsTrigger>
          <TabsTrigger value="schedule" className="flex items-center gap-2">
            <Calendar size={16} />
            근무일정 ({filteredScheduleSteps.length})
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
                        <tr key={step.id} className="hover:bg-gray-50">
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
