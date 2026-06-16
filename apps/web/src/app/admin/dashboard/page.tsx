"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Users,
  Clock,
  AlertTriangle,
  FileText,
  Calendar,
  TrendingUp,
  Eye,
  CheckCircle2,
  Clock3,
  LogOut,
} from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

type AttendanceStats = {
  present: number;
  late: number;
  absent: number;
  earlyLeave: number;
  onLeave: number;
};

type MissingAttendance = {
  id: string;
  name: string;
  email: string;
  date: string;
  type: string;
};

type PendingApproval = {
  id: string;
  type: "leave" | "schedule" | "contract";
  title: string;
  requester: string;
  requestedAt: string;
};

export default function AdminDashboardPage() {
  const [attendanceStats, setAttendanceStats] = useState<AttendanceStats | null>(null);
  const [totalEmployees, setTotalEmployees] = useState<number | null>(null);
  const [pendingCounts, setPendingCounts] = useState({ leave: 0, schedule: 0 });
  const [missingAttendance, setMissingAttendance] = useState<MissingAttendance[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);

  // 출퇴근 누락 보정 확인
  const [fillTarget, setFillTarget] = useState<MissingAttendance | null>(null);
  const [filling, setFilling] = useState(false);

  // 오늘 날짜
  const today = new Date();
  const dateStr = format(today, "yyyy년 M월 d일 (EEEE)", { locale: ko });

  // 데이터 불러오기
  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);

      // 1. 관리자 대시보드 통계 (오늘 근무 현황 + 대기 결재 + 직원 수)
      const statsRes = await fetch("/api/admin/dashboard-stats");
      let leaveScheduleItems: PendingApproval[] = [];
      if (statsRes.ok) {
        const data = await statsRes.json();
        setAttendanceStats(data.attendance || null);
        setTotalEmployees(data.totalEmployees ?? null);
        setPendingCounts(data.pending || { leave: 0, schedule: 0 });
        setMissingAttendance(data.missingAttendance || []);
        leaveScheduleItems = data.pendingItems || [];
      }

      // 2. 대기 중인 계약 결재
      let contractItems: PendingApproval[] = [];
      const approvalRes = await fetch("/api/contracts/my-approvals");
      if (approvalRes.ok) {
        const data = await approvalRes.json();
        contractItems = (data.contracts || []).map((c: any) => ({
          id: c.id,
          type: "contract" as const,
          title: c.title,
          requester: c.user?.name || "미상",
          requestedAt: c.createdAt,
        }));
      }

      setPendingApprovals([...contractItems, ...leaveScheduleItems].slice(0, 10));
    } catch (error) {
      console.error("Dashboard data fetch error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
    // 5분마다 새로고침
    const interval = setInterval(fetchDashboardData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  // 출퇴근 누락 자동 보정 (퇴실 누락→출근+9h, 입실 누락→퇴근-9h)
  async function handleAutoFill() {
    if (!fillTarget) return;
    setFilling(true);
    try {
      const res = await fetch(`/api/attendance/${fillTarget.id}/auto-fill`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "보정에 실패했습니다."); return; }
      toast.success(data.mode === "out" ? "퇴근 시간이 자동 입력되었습니다." : "출근 시간이 자동 입력되었습니다.");
      setFillTarget(null);
      fetchDashboardData();
    } finally {
      setFilling(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 헤더 - 날짜 및 통계 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{dateStr}</h1>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchDashboardData} variant="outline" className="gap-2">
            <Eye size={16} /> 새로고침
          </Button>
          <Button
            onClick={() => window.location.href = "/dashboard"}
            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            직원 모드로 전환
          </Button>
        </div>
      </div>

      {/* 오늘의 근무 현황 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <Users size={14} /> 출근
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">
              {attendanceStats ? attendanceStats.present : "--"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <AlertTriangle size={14} /> 지각
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">
              {attendanceStats ? attendanceStats.late : "--"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <LogOut size={14} /> 미출근
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">
              {attendanceStats ? attendanceStats.absent : "--"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <Clock3 size={14} /> 조퇴
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600">
              {attendanceStats ? attendanceStats.earlyLeave : "--"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <Calendar size={14} /> 휴가
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">
              {attendanceStats ? attendanceStats.onLeave : "--"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 주요 업무 현황 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="cursor-pointer hover:border-blue-300 transition" onClick={() => window.location.href = "/admin/contract-approvals"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">대기 중인 계약</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {pendingApprovals.filter(p => p.type === "contract").length}
            </div>
            <p className="text-xs text-gray-500 mt-1">승인 대기</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-green-300 transition" onClick={() => window.location.href = "/admin/leave-approvals"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">대기 중인 휴가</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {pendingCounts.leave}
            </div>
            <p className="text-xs text-gray-500 mt-1">승인 대기 · 근무일정 {pendingCounts.schedule}건</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">전체 직원</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-700">
              {totalEmployees === null ? "--" : totalEmployees}
            </div>
            <p className="text-xs text-gray-500 mt-1">명 (관리자 제외)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">관리 알림</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {attendanceStats ? attendanceStats.absent + attendanceStats.late : "--"}
            </div>
            <p className="text-xs text-gray-500 mt-1">미출근 + 지각</p>
          </CardContent>
        </Card>
      </div>

      {/* 출퇴근 누락/미이행 현황 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-orange-600" />
            출퇴근 누락 현황
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">
              데이터를 불러오는 중...
            </div>
          ) : missingAttendance.length === 0 ? (
            <div className="text-center py-8 text-green-600">
              <CheckCircle2 className="inline-block mb-2" size={32} />
              <p>최근 7일간 출퇴근 누락이 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">※ 항목을 클릭하면 9시간 기준으로 출퇴근 시간을 자동 보정할 수 있습니다.</p>
              {missingAttendance.map(record => (
                <button
                  key={record.id}
                  onClick={() => setFillTarget(record)}
                  className="w-full flex items-center justify-between p-3 bg-orange-50 border border-orange-200 rounded-lg text-left hover:bg-orange-100 transition-colors"
                >
                  <div>
                    <p className="font-medium text-gray-900">{record.name}</p>
                    <p className="text-sm text-gray-600">{record.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">
                      {format(new Date(record.date), "M월 d일")}
                    </span>
                    <Badge variant="outline" className="border-orange-300 text-orange-700">
                      {record.type}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 공지사항 및 알림 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText size={18} />
            최근 공지사항
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="text-yellow-900">시스템 점검 예정</strong>
                <p className="text-sm text-yellow-800">2026년 6월 10일 야간 중 서버 점검이 예정되어 있습니다.</p>
              </div>
            </div>
            <div className="flex gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <FileText className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="text-blue-900">새로운 기능 추가</strong>
                <p className="text-sm text-blue-800">휴가 신청 시 증명서류 첨부 기능이 추가되었습니다.</p>
              </div>
            </div>
            <div className="flex gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <TrendingUp className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="text-green-900">월간 리포트</strong>
                <p className="text-sm text-green-800">5월 월간 보고서가 발행되었습니다. 상세 내용을 확인하세요.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 승인 대기 항목 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock size={18} className="text-blue-600" />
            승인 대기 항목
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">
              데이터를 불러오는 중...
            </div>
          ) : pendingApprovals.length === 0 ? (
            <div className="text-center py-8 text-gray-600">
              <CheckCircle2 className="inline-block mb-2 text-green-600" size={32} />
              <p>승인 대기 항목이 없습니다.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">항목</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">신청자</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">신청일</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingApprovals.map(approval => (
                    <tr
                      key={approval.id}
                      className="border-b hover:bg-gray-50 cursor-pointer"
                      onClick={() =>
                        window.location.href =
                          approval.type === "contract" ? "/admin/contract-approvals" : "/admin/leave-approvals"
                      }
                    >
                      <td className="px-4 py-3 font-medium">{approval.title}</td>
                      <td className="px-4 py-3 text-gray-600">{approval.requester}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {format(new Date(approval.requestedAt), "M월 d일")}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className="bg-yellow-100 text-yellow-800">
                          {approval.type === "contract" ? "계약 승인 대기"
                            : approval.type === "schedule" ? "근무일정 승인 대기"
                            : "휴가 승인 대기"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 빠른 액세스 */}
      <Card>
        <CardHeader>
          <CardTitle>빠른 액세스</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <a
              href="/admin/employees"
              className="p-4 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition text-center"
            >
              <Users className="mx-auto mb-2" size={24} />
              <div className="font-medium text-gray-900">직원 관리</div>
              <div className="text-xs text-gray-600">직원 조회 및 관리</div>
            </a>

            <a
              href="/admin/leave"
              className="p-4 border border-gray-200 rounded-lg hover:bg-green-50 hover:border-green-300 transition text-center"
            >
              <Calendar className="mx-auto mb-2" size={24} />
              <div className="font-medium text-gray-900">휴가 관리</div>
              <div className="text-xs text-gray-600">휴가 신청 및 승인</div>
            </a>

            <a
              href="/admin/contracts"
              className="p-4 border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition text-center"
            >
              <FileText className="mx-auto mb-2" size={24} />
              <div className="font-medium text-gray-900">계약서 관리</div>
              <div className="text-xs text-gray-600">계약서 작성 및 승인</div>
            </a>

            <a
              href="/admin/attendance"
              className="p-4 border border-gray-200 rounded-lg hover:bg-orange-50 hover:border-orange-300 transition text-center"
            >
              <Clock size={24} className="mx-auto mb-2" />
              <div className="font-medium text-gray-900">출퇴근 관리</div>
              <div className="text-xs text-gray-600">출퇴근 기록 조회</div>
            </a>
          </div>
        </CardContent>
      </Card>

      {/* 리포트 섹션 */}
      <Card>
        <CardHeader>
          <CardTitle>월간 리포트</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-gray-600 text-sm">
              {format(today, "yyyy년 M월")} 월간 리포트를 다운로드할 수 있습니다.
            </p>
            <Button variant="outline" className="gap-2 w-full md:w-auto">
              <FileText size={16} /> 리포트 다운로드
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 출퇴근 누락 자동 보정 확인 다이얼로그 */}
      <Dialog open={!!fillTarget} onOpenChange={(o) => !o && setFillTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>출퇴근 누락 자동 보정</DialogTitle>
          </DialogHeader>
          {fillTarget && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <p className="font-medium">{fillTarget.name}</p>
                <p className="text-gray-500 text-xs">
                  {format(new Date(fillTarget.date), "yyyy년 M월 d일")} · {fillTarget.type}
                </p>
              </div>
              <p className="text-sm text-gray-700">
                {fillTarget.type === "퇴실 누락"
                  ? "출근 시각 기준 9시간 뒤 시간으로 퇴근 처리하겠습니까?"
                  : "퇴근 시각 기준 9시간 전 시간으로 출근 처리하겠습니까?"}
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setFillTarget(null)} disabled={filling}>
                  아니오
                </Button>
                <Button onClick={handleAutoFill} disabled={filling}>
                  {filling ? "처리 중..." : "네"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
