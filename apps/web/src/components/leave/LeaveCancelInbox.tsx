"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, Loader2, AlertCircle, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

/**
 * 승인된 휴가의 **취소 결재** 결재함 — 관리자 결재함(admin/leave-approvals)과 원장 결재함
 * (manager/team-leave)이 **같은 컴포넌트**를 쓴다. 두 화면에 따로 만들면 한쪽만 고치는 짝 누락이 생긴다.
 * 데이터: GET /api/leave/cancel-requests/my-approvals · 처리: POST /api/leave/cancel-requests/[id]/approve
 * 최종 승인되면 휴가가 취소되고 연차가 복구된다(서버 lib/leave-cancel-flow.ts).
 */

type Step = {
  id: string;
  order: number;
  status: string;
  approverRole?: string | null;
  branch?: string | null;
  approver?: { name: string } | null;
};
type Row = {
  id: string;
  order: number;
  status: string;
  cancelRequest: {
    id: string;
    reason: string | null;
    createdAt: string;
    user: { name: string; position: string | null; branch: string | null };
    leaveRequest: { type: string; startDate: string; endDate: string; days: number; reason: string | null };
    approvalSteps: Step[];
  };
};

const TYPE_LABEL: Record<string, string> = {
  ANNUAL: "연차", HALF_AM: "오전반차", HALF_PM: "오후반차", QUARTER_AM: "오전반반차", QUARTER_PM: "오후반반차",
  COMPENSATORY: "대체휴무", COMPENSATORY_HALF: "대체휴무반차", SICK: "병가", SPECIAL: "특별휴가",
  CIVIL_DEFENSE: "민방위", RESERVE_FORCES: "예비군훈련", FAMILY_EVENT: "경조사",
  FAMILY_MARRIAGE: "결혼", FAMILY_BIRTH: "출산", FAMILY_BEREAVEMENT: "사망(조사)",
};

function stepLabel(s: Step): string {
  if (s.approver) return s.approver.name;
  if (s.approverRole === "MANAGER") return `${s.branch ? `[${s.branch}] ` : ""}원장`;
  if (s.approverRole === "ADMIN") return "관리자";
  return "결재자";
}

export default function LeaveCancelInbox({
  onCount,
  searchName = "",
  searchDate = "",
}: {
  onCount?: (n: number) => void;
  searchName?: string;
  searchDate?: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leave/cancel-requests/my-approvals");
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      setRows(d.steps || []);
    } catch {
      toast.error("휴가 취소 결재를 불러오지 못했습니다");
      setRows([]);   // 실패하면 비운다 — 옛 목록이 남으면 지금 상태로 오해한다
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => rows.filter((r) => {
    const c = r.cancelRequest;
    const nameMatch = c.user.name.toLowerCase().includes(searchName.toLowerCase());
    const dateMatch = !searchDate || c.leaveRequest.startDate.includes(searchDate) || c.leaveRequest.endDate.includes(searchDate);
    return nameMatch && dateMatch;
  }), [rows, searchName, searchDate]);
  // 로딩 중에는 올리지 않는다 — 탭 숫자가 잠깐 0 으로 보였다(9/11 검증)
  useEffect(() => { if (!loading) onCount?.(filtered.length); }, [loading, filtered.length, onCount]);

  const decide = async (cancelId: string, action: "approve" | "reject", reason?: string) => {
    try {
      setProcessingId(cancelId);
      const res = await fetch(`/api/leave/cancel-requests/${cancelId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "처리하지 못했습니다"); return; }
      toast.success(action === "reject"
        ? "취소 요청을 반려했습니다 — 휴가는 그대로 유지됩니다"
        : data.final
          ? (data.restoredDays > 0
              ? `휴가를 취소하고 연차 ${data.restoredDays}일을 복구했습니다`
              : "휴가를 취소했습니다 (복구할 연차 없음 — 연차 차감 유형이 아니거나 잔여 기록이 없습니다)")
          : "승인했습니다 — 다음 결재자에게 넘어갑니다");
      setRejectId(null);
      setRejectReason("");
      await load();
    } catch {
      toast.error("오류가 발생했습니다");
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <Card><CardContent className="pt-6 text-center text-gray-500">
        <Loader2 className="inline-block animate-spin mb-2" /><p>로드 중...</p>
      </CardContent></Card>
    );
  }
  if (filtered.length === 0) {
    return (
      <Card><CardContent className="pt-6 text-center text-gray-500">
        <AlertCircle className="inline-block mb-2 text-gray-400" size={24} />
        <p>{rows.length === 0 ? "결재할 휴가 취소 요청이 없습니다" : "검색 결과가 없습니다"}</p>
      </CardContent></Card>
    );
  }

  return (
    <>
      <p className="text-xs text-gray-500">
        승인된 휴가를 본인이 취소하겠다고 올린 결재입니다. <b>최종 승인되면 휴가가 취소되고 연차가 복구</b>되며,
        반려하면 휴가는 그대로 유지됩니다.
      </p>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">직원</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">취소할 휴가</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">취소 사유</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">결재</th>
                <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">처리</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((row) => {
                const c = row.cancelRequest;
                const lr = c.leaveRequest;
                const range = `${format(new Date(lr.startDate), "MM월 dd일", { locale: ko })} ~ ${format(new Date(lr.endDate), "MM월 dd일", { locale: ko })}`;
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{c.user.name}</div>
                      <div className="text-xs text-gray-500">{[c.user.branch, c.user.position].filter(Boolean).join(" · ") || "-"}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      <Badge variant="outline" className="bg-blue-50 mb-1">{TYPE_LABEL[lr.type] || lr.type}</Badge>
                      <div>{range}</div>
                      <div className="text-xs text-gray-500">{lr.days}일</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 max-w-xs">{c.reason || "-"}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-xs flex-wrap">
                        {c.approvalSteps.map((s, idx) => (
                          <span key={s.id} className="flex items-center gap-1">
                            {idx > 0 && <ChevronRight size={12} className="text-gray-300" />}
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              s.status === "APPROVED" ? "bg-green-100 text-green-700" :
                              s.status === "REJECTED" ? "bg-red-100 text-red-700" :
                              s.status === "PENDING" ? "bg-amber-100 text-amber-700" :
                              "bg-gray-100 text-gray-600"
                            }`}>{stepLabel(s)}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="ghost" className="text-green-600 hover:bg-green-50"
                          disabled={processingId === c.id} onClick={() => decide(c.id, "approve")}>
                          {processingId === c.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                          승인
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50"
                          disabled={processingId === c.id} onClick={() => { setRejectId(c.id); setRejectReason(""); }}>
                          <X size={16} />
                          반려
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

      <Dialog open={!!rejectId} onOpenChange={(o) => { if (!o) setRejectId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>취소 요청 반려</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">반려하면 휴가는 그대로 유지되고, 사유가 신청자에게 전달됩니다.</p>
            <Textarea placeholder="반려 사유 (선택)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setRejectId(null)}>닫기</Button>
              <Button className="bg-red-600 hover:bg-red-700" disabled={processingId !== null}
                onClick={() => rejectId && decide(rejectId, "reject", rejectReason.trim() || undefined)}>
                {processingId !== null ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
                반려
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
