"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import Link from "next/link";

interface Contract {
  id: string;
  title: string;
  type: string;
  status: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    department: string | null;
    branch: string | null;
  };
  approvalLine?: {
    steps: Array<{
      id: string;
      approverId: string;
      approver: {
        id: string;
        name: string;
        branch: string | null;
      };
      order: number;
    }>;
  };
}

export default function AdminContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchContracts();
  }, []);

  const fetchContracts = async () => {
    try {
      const res = await fetch("/api/contracts");
      if (res.ok) {
        const data = await res.json();
        console.log("계약서 데이터:", data);
        // API 응답 형식에 따라 조정
        const contractsList = Array.isArray(data) ? data : data.contracts || data.data || [];
        setContracts(contractsList);
      } else {
        console.error("API 응답 에러:", res.status);
        toast.error(`계약서를 불러올 수 없습니다 (${res.status})`);
      }
    } catch (error) {
      toast.error("계약서를 불러올 수 없습니다");
      console.error("fetch 에러:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 계약서를 삭제하시겠습니까?")) return;

    setDeleting(id);
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("계약서가 삭제되었습니다");
        setContracts(contracts.filter(c => c.id !== id));
      } else {
        toast.error("계약서 삭제에 실패했습니다");
      }
    } catch (error) {
      toast.error("오류가 발생했습니다");
      console.error(error);
    } finally {
      setDeleting(null);
    }
  };

  // 상태별 계약서 집계
  const statusCounts = {
    DRAFT: contracts.filter(c => c.status === "DRAFT").length,
    SENT: contracts.filter(c => c.status === "SENT").length,
    APPROVED: contracts.filter(c => c.status === "APPROVED").length,
    SIGNED: contracts.filter(c => c.status === "SIGNED").length,
  };

  // 계약서 유형별 집계
  const typeCounts: { [key: string]: number } = {};
  contracts.forEach(c => {
    typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
  });

  const statusLabels: { [key: string]: string } = {
    DRAFT: "초안",
    SENT: "서명대기",
    APPROVED: "결재중",
    SIGNED: "완료",
    REJECTED: "반려",
    REVOKED: "철회",
  };

  const typeLabels: { [key: string]: string } = {
    EMPLOYMENT: "근로계약서",
    PART_TIME: "단시간근로계약서",
    CONFIDENTIAL: "비밀유지계약",
    OTHER: "기타",
  };

  const getTypeLabel = (type: string) => typeLabels[type] || type;

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: string } = {
      DRAFT: "bg-gray-100 text-gray-800",
      SENT: "bg-blue-100 text-blue-800",
      APPROVED: "bg-yellow-100 text-yellow-800",
      SIGNED: "bg-green-100 text-green-800",
      REJECTED: "bg-red-100 text-red-800",
      REVOKED: "bg-gray-100 text-gray-800",
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-500">로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">전자계약 관리</h2>
          <p className="text-gray-600 mt-2">전사 모든 계약서 - 총 {contracts.length}건</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">준비 중</span>
          <button
            disabled
            className="px-4 py-2 bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed opacity-60"
            title="계약서 작성 기능은 준비 중입니다"
          >
            ➕ 새 계약서 작성
          </button>
        </div>
      </div>

      {/* 상태별 통계 */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600 mb-1">초안</p>
          <p className="text-2xl font-bold text-gray-900">{statusCounts.DRAFT}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600 mb-1">서명대기</p>
          <p className="text-2xl font-bold text-blue-600">{statusCounts.SENT}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600 mb-1">결재중</p>
          <p className="text-2xl font-bold text-yellow-600">{statusCounts.APPROVED}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600 mb-1">완료</p>
          <p className="text-2xl font-bold text-green-600">{statusCounts.SIGNED}</p>
        </div>
      </div>

      {/* 계약서 유형별 통계 */}
      <div className="grid grid-cols-4 gap-4">
        {Object.entries(typeLabels).map(([type, label]) => (
          <div key={type} className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-sm text-gray-600 font-medium mb-1">{label}</p>
            <p className="text-2xl font-bold text-gray-900">{typeCounts[type] || 0}</p>
          </div>
        ))}
      </div>

      {/* 빠른 액세스 */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-gray-900 mb-3">빠른 액세스</h3>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/admin/contract-templates"
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm"
          >
            📋 계약 템플릿
          </Link>
          <button
            onClick={() => toast.info("결재 라인 설정 기능은 준비 중입니다")}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm cursor-pointer"
          >
            🔄 결재 라인 설정
          </button>
          <button
            onClick={() => toast.info("계약서 분석 기능은 준비 중입니다")}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm cursor-pointer"
          >
            📊 계약서 분석
          </button>
          <button
            onClick={() => toast.info("계약서 버전 기능은 준비 중입니다")}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm cursor-pointer"
          >
            📁 계약서 버전
          </button>
        </div>
      </div>

      {/* 계약서 목록 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">제목</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">유형</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">신청자</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">부서</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">상태</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">결재</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">작성일</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {contracts.map((contract) => (
              <tr key={contract.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 font-medium text-blue-600 hover:text-blue-800 cursor-pointer">
                  {contract.title}
                </td>
                <td className="px-6 py-4 text-gray-600 text-xs">
                  {getTypeLabel(contract.type)}
                </td>
                <td className="px-6 py-4 text-gray-900 font-medium">
                  {contract.user.name}
                </td>
                <td className="px-6 py-4 text-gray-600">
                  {contract.user.department || "-"}
                </td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(contract.status)}`}>
                    {statusLabels[contract.status] || contract.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-gray-600">
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                    {contract.approvalLine?.steps.length || 0}단계
                  </span>
                </td>
                <td className="px-6 py-4 text-gray-600 text-xs">
                  {format(new Date(contract.createdAt), "yyyy.MM.dd", { locale: ko })}
                </td>
                <td className="px-6 py-4 text-sm">
                  <div className="flex gap-3">
                    <Link
                      href={`/contracts/${contract.id}`}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      보기
                    </Link>
                    <button
                      onClick={() => handleDelete(contract.id)}
                      disabled={deleting === contract.id}
                      className="text-red-600 hover:text-red-800 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deleting === contract.id ? "삭제 중..." : "삭제"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {contracts.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">계약서가 없습니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
