"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Check, AlertCircle, ChevronRight, Search, Loader2, FileText,
} from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

/* ── 타입 ── */
type ApprovalStepUser = {
  id: string;
  name: string;
  branch?: string | null;
};

type ContractApprovalStep = {
  id: string;
  order: number;
  status: string;
  approver: ApprovalStepUser;
  comment?: string | null;
};

type Contract = {
  id: string;
  title: string;
  templateId?: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    department: string | null;
    branch: string | null;
  };
  approvalLine?: {
    steps: ContractApprovalStep[];
    myStep?: any;
  };
};

type ContractApprovalData = {
  id: string;
  order: number;
  status: string;
  approverId: string;
  approvalLine: {
    contract: Contract;
    steps: ContractApprovalStep[];
    myStep?: any;
  };
};

/* ── 상수 ── */
const STATUS_CFG: Record<string, { label: string; badge: string }> = {
  PENDING: { label: "결재대기", badge: "bg-amber-100 text-amber-700 border-amber-200" },
  APPROVED: { label: "승인", badge: "bg-green-100 text-green-700 border-green-200" },
  REJECTED: { label: "반려", badge: "bg-red-100 text-red-700 border-red-200" },
};

/* ── 결재 대기 목록 페이지 ── */
export default function ContractApprovalsPage() {
  const [contracts, setContracts] = useState<ContractApprovalData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchName, setSearchName] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);

  // 결재 대기 요청 조회
  const fetchApprovals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/contracts/my-approvals");
      if (res.ok) {
        const data = await res.json();
        setContracts(data.data || []);
      } else {
        toast.error("결재 대기 요청을 불러올 수 없습니다");
      }
    } catch (error) {
      toast.error("오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  // 검색 필터링
  const filteredContracts = useMemo(() => {
    return contracts.filter(approval => {
      const contract = approval.approvalLine.contract;
      const nameMatch = contract.user.name.toLowerCase().includes(searchName.toLowerCase());
      const dateMatch = !searchDate ||
        contract.createdAt.includes(searchDate);
      return nameMatch && dateMatch;
    });
  }, [contracts, searchName, searchDate]);

  // 승인 처리
  const handleApprove = async (contractId: string) => {
    try {
      setProcessingId(contractId);
      const res = await fetch(`/api/contracts/${contractId}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isApprover: true }),
      });

      if (res.ok) {
        toast.success("승인되었습니다");
        setContracts(contracts.filter(c => c.approvalLine.contract.id !== contractId));
      } else {
        const data = await res.json();
        toast.error(data.error || "승인 처리 중 오류가 발생했습니다");
      }
    } catch (error) {
      toast.error("오류가 발생했습니다");
    } finally {
      setProcessingId(null);
    }
  };


  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">계약서 결재 대기</h1>
        <div className="text-sm text-gray-600">
          대기 중: <span className="font-semibold text-amber-600">{filteredContracts.length}건</span>
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

      {/* 결재 대기 목록 */}
      {loading ? (
        <Card>
          <CardContent className="pt-6 text-center text-gray-500">
            <Loader2 className="inline-block animate-spin mb-2" />
            <p>로드 중...</p>
          </CardContent>
        </Card>
      ) : filteredContracts.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-gray-500">
            {contracts.length === 0 ? (
              <>
                <AlertCircle className="inline-block mb-2 text-gray-400" size={24} />
                <p>결재 대기 중인 요청이 없습니다</p>
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
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">계약서</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">생성일</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">결재</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">처리</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredContracts.map((approval) => {
                  const contract = approval.approvalLine.contract;
                  const createdDate = new Date(contract.createdAt);
                  const dateStr = format(createdDate, "yyyy년 MM월 dd일", { locale: ko });

                  return (
                    <tr key={approval.id} className="hover:bg-gray-50 transition-colors">
                      {/* 직원 정보 */}
                      <td className="px-6 py-4">
                        <div>
                          <div className="font-medium text-gray-900">{contract.user.name}</div>
                          <div className="text-xs text-gray-500">{contract.user.department || "-"} / {contract.user.branch || "-"}</div>
                        </div>
                      </td>

                      {/* 계약서 정보 */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <FileText size={16} className="text-blue-600" />
                          <span className="text-sm font-medium text-gray-900">{contract.title}</span>
                        </div>
                      </td>

                      {/* 생성일 */}
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {dateStr}
                      </td>

                      {/* 결재 진행 상태 */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-xs flex-wrap">
                          {approval.approvalLine.steps && approval.approvalLine.steps.map((step, idx) => {
                            const isCompleted = step.status === "APPROVED";
                            const isRejected = step.status === "REJECTED";
                            const isPending = step.status === "PENDING";

                            return (
                              <span key={step.id} className="flex items-center gap-1">
                                {idx > 0 && <ChevronRight size={12} className="text-gray-300" />}
                                <span
                                  className={`
                                    px-2 py-1 rounded text-xs font-medium
                                    ${isCompleted ? "bg-green-100 text-green-700" : ""}
                                    ${isRejected ? "bg-red-100 text-red-700" : ""}
                                    ${isPending ? "bg-amber-100 text-amber-700" : ""}
                                    ${!isCompleted && !isRejected && !isPending ? "bg-gray-100 text-gray-600" : ""}
                                  `}
                                >
                                  {step.approver.name}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      </td>

                      {/* 처리 버튼 */}
                      <td className="px-6 py-4 text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-green-600 hover:bg-green-50"
                            disabled={processingId === contract.id}
                            onClick={() => handleApprove(contract.id)}
                          >
                            {processingId === contract.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Check size={16} />
                            )}
                            승인
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

    </div>
  );
}
