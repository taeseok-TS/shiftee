"use client";

import { useState, useEffect } from "react";
import { format, eachDayOfInterval, getDay } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import Link from "next/link";

interface LeaveRequest {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  status: string;
  user: {
    id: string;
    name: string;
    department: string | null;
    branch: string | null;
    position: string | null;
  };
  approvalSteps: Array<{
    id: string;
    order: number;
    approverId: string;
    approver: {
      id: string;
      name: string;
      position: string | null;
    };
  }>;
}

export default function AdminLeaveManagementPage() {
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchLeaveRequests();
  }, []);

  const fetchLeaveRequests = async () => {
    try {
      const res = await fetch("/api/leave");
      if (res.ok) {
        const data = await res.json();
        console.log("휴가 데이터:", data);
        // API 응답 형식에 따라 조정
        const requestsList = Array.isArray(data) ? data : data.requests || data.leaveRequests || data.data || [];
        setLeaveRequests(requestsList);
      } else {
        console.error("API 응답 에러:", res.status);
        toast.error(`휴가 신청을 불러올 수 없습니다 (${res.status})`);
      }
    } catch (error) {
      toast.error("휴가 신청을 불러올 수 없습니다");
      console.error("fetch 에러:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 휴가 신청을 삭제하시겠습니까?")) return;

    setDeleting(id);
    try {
      const res = await fetch(`/api/leave/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("휴가 신청이 삭제되었습니다");
        setLeaveRequests(leaveRequests.filter(l => l.id !== id));
      } else {
        toast.error("휴가 신청 삭제에 실패했습니다");
      }
    } catch (error) {
      toast.error("오류가 발생했습니다");
      console.error(error);
    } finally {
      setDeleting(null);
    }
  };

  // 상태별 휴가 신청 집계
  const statusCounts = {
    PENDING: leaveRequests.filter(l => l.status === "PENDING").length,
    APPROVED: leaveRequests.filter(l => l.status === "APPROVED").length,
    REJECTED: leaveRequests.filter(l => l.status === "REJECTED").length,
    CANCELLED: leaveRequests.filter(l => l.status === "CANCELLED").length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-500">로딩 중...</p>
      </div>
    );
  }

  // 휴가 유형별 집계
  const typeCounts: { [key: string]: number } = {};
  const typeLabels: { [key: string]: string } = {
    ANNUAL: "연차",
    SICK: "병가",
    PERSONAL: "개인휴무",
    UNPAID: "무급휴가",
    HALF_AM: "오전반차",
    HALF_PM: "오후반차",
    QUARTER_AM: "오전반반차",
    QUARTER_PM: "오후반반차",
    COMPENSATORY: "대체휴무",
    SPECIAL: "특별휴가",
  };

  leaveRequests.forEach(l => {
    typeCounts[l.type] = (typeCounts[l.type] || 0) + 1;
  });

  const statusLabels: { [key: string]: string } = {
    PENDING: "대기",
    APPROVED: "승인",
    REJECTED: "반려",
    CANCELLED: "취소",
  };

  const getLeaveTypeName = (type: string) => {
    return typeLabels[type] || type;
  };

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: string } = {
      PENDING: "bg-yellow-100 text-yellow-800",
      APPROVED: "bg-green-100 text-green-800",
      REJECTED: "bg-red-100 text-red-800",
      CANCELLED: "bg-gray-100 text-gray-800",
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  const calcWorkdays = (start: string, end: string) => {
    if (!start || !end) return 0;
    try {
      const s = new Date(start);
      const e = new Date(end);
      if (s > e) return 0;
      return eachDayOfInterval({ start: s, end: e })
        .filter(d => getDay(d) !== 0 && getDay(d) !== 6).length;
    } catch {
      return 0;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">휴가 관리</h2>
          <p className="text-gray-600 mt-2">전사 모든 휴가 신청 - 총 {leaveRequests.length}건</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">준비 중</span>
          <button
            disabled
            className="px-4 py-2 bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed opacity-60"
            title="휴가 신청 기능은 준비 중입니다"
          >
            ➕ 휴가 신청
          </button>
        </div>
      </div>

      {/* 상태별 통계 */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600 mb-1">대기 중</p>
          <p className="text-2xl font-bold text-yellow-600">{statusCounts.PENDING}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600 mb-1">승인</p>
          <p className="text-2xl font-bold text-green-600">{statusCounts.APPROVED}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600 mb-1">반려</p>
          <p className="text-2xl font-bold text-red-600">{statusCounts.REJECTED}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600 mb-1">취소</p>
          <p className="text-2xl font-bold text-gray-600">{statusCounts.CANCELLED}</p>
        </div>
      </div>

      {/* 휴가 유형별 통계 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
          <p className="text-sm text-blue-600 font-medium mb-1">연차</p>
          <p className="text-2xl font-bold text-blue-900">{typeCounts.ANNUAL || 0}</p>
        </div>
        <div className="bg-red-50 rounded-lg border border-red-200 p-4">
          <p className="text-sm text-red-600 font-medium mb-1">병가</p>
          <p className="text-2xl font-bold text-red-900">{typeCounts.SICK || 0}</p>
        </div>
        <div className="bg-purple-50 rounded-lg border border-purple-200 p-4">
          <p className="text-sm text-purple-600 font-medium mb-1">기타</p>
          <p className="text-2xl font-bold text-purple-900">{Object.entries(typeCounts).filter(([k]) => !['ANNUAL', 'SICK'].includes(k)).reduce((sum, [, v]) => sum + v, 0)}</p>
        </div>
      </div>

      {/* 빠른 액세스 */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-gray-900 mb-3">빠른 액세스</h3>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => toast.info("결재 라인 설정 기능은 준비 중입니다")}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm cursor-pointer"
          >
            📋 결재 라인 설정
          </button>
          <button
            onClick={() => toast.info("휴가 통계 기능은 준비 중입니다")}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm cursor-pointer"
          >
            📊 휴가 통계
          </button>
          <button
            onClick={() => toast.info("연차 잔여 조정 기능은 준비 중입니다")}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm cursor-pointer"
          >
            💾 연차 잔여 조정
          </button>
          <button
            onClick={() => toast.info("휴가 현황 기능은 준비 중입니다")}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm cursor-pointer"
          >
            📁 휴가 현황
          </button>
        </div>
      </div>

      {/* 휴가 신청 목록 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">신청자</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">부서</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">휴가유형</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">기간</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">일수</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">상태</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">결재</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {leaveRequests.map((leave) => (
              <tr key={leave.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 font-medium text-gray-900">
                  {leave.user.name}
                </td>
                <td className="px-6 py-4 text-gray-600">
                  {leave.user.department || "-"}
                </td>
                <td className="px-6 py-4 text-gray-600">
                  {getLeaveTypeName(leave.type)}
                </td>
                <td className="px-6 py-4 text-gray-600 text-xs">
                  {format(new Date(leave.startDate), "MM.dd", { locale: ko })} ~ {format(new Date(leave.endDate), "MM.dd", { locale: ko })}
                </td>
                <td className="px-6 py-4 text-center">
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-semibold">
                    {calcWorkdays(leave.startDate, leave.endDate)}일
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(leave.status)}`}>
                    {statusLabels[leave.status] || leave.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-xs">
                  <span className="text-gray-600">
                    {leave.approvalSteps && leave.approvalSteps.length > 0
                      ? `${leave.approvalSteps.filter(s => s.status === "APPROVED").length}/${leave.approvalSteps.length}`
                      : "없음"}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm">
                  <div className="flex gap-3">
                    <Link
                      href={`/leave/${leave.id}`}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      보기
                    </Link>
                    <button
                      onClick={() => handleDelete(leave.id)}
                      disabled={deleting === leave.id}
                      className="text-red-600 hover:text-red-800 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deleting === leave.id ? "삭제 중..." : "삭제"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {leaveRequests.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">휴가 신청이 없습니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
