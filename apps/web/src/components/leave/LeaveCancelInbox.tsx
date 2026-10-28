"use client";

import { LEAVE_LABELS } from "@/lib/leave-catalog";
import { useLeaveCatalog } from "@/components/leave/useLeaveCatalog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, AlertCircle } from "lucide-react";
import { Btn, FlowDots } from "@/components/kit";
import { toast } from "sonner";
import { fmtRangeKo } from "@/lib/leave-period";

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
  comment?: string | null;   // 결재자 의견(#64)
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

const TYPE_LABEL: Record<string, string> = LEAVE_LABELS;   // 공용 객체 — useLeaveCatalog 가 본부 유형 이름을 채운다(#216-1)

function stepLabel(s: Step): string {
  // 메인 관리자 계정(이름 「관리자」) · 사람이 안 정해진 본부 단계는 「본부」(2026-10-28 이예지 디자인 ⑤)
  if (s.approver) return s.approver.name === "관리자" ? "본부" : s.approver.name;
  if (s.approverRole === "MANAGER") return `${s.branch ? `[${s.branch}] ` : ""}원장`;
  if (s.approverRole === "ADMIN") return "본부";
  return "결재자";
}

export default function LeaveCancelInbox({
  onCount,
  onChanged,
  searchName = "",
  searchDate = "",
}: {
  onCount?: (n: number) => void;
  onChanged?: () => void;   // 처리한 뒤 — 부르는 화면이 자기 목록·건수를 다시 받게(관리자 결재함 「결재 대기」 탭)
  searchName?: string;
  searchDate?: string;
}) {
  useLeaveCatalog();   // 본부가 만든 휴가 유형 이름을 받아 다시 그린다(#216-1)
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  // 의견 남기고 승인(#64)
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

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
    // 결재함 본표(leave-approvals)와 같은 기준 — 이름은 앞뒤 공백 무시, 날짜는 휴가 기간 안이면 맞음(시작·종료일과 같을 때만이 아니라)
    const nameMatch = c.user.name.toLowerCase().includes(searchName.trim().toLowerCase());
    const dateMatch = !searchDate || (c.leaveRequest.startDate.slice(0, 10) <= searchDate && searchDate <= c.leaveRequest.endDate.slice(0, 10));
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
      onChanged?.();
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

  /* ── 표·카드 공용 칸(2026-10-16 이예지 QA #219-16 — 휴대폰 390px 에서 결재·처리 칸이 잘렸다). 원래 표 칸 내용 그대로이고, 넓은 화면은 표·휴대폰(md 미만)은 카드로 같은 칸을 보인다 — 버튼 동작·조건은 여기 하나 ── */
  const cancelCells = (row: Row) => {
    const c = row.cancelRequest;
    const lr = c.leaveRequest;
    const range = fmtRangeKo(lr.startDate, lr.endDate);
    return [
      <>
        <div className="font-medium text-gray-900">{c.user.name}</div>
        <div className="text-xs text-gray-500">{[c.user.branch, c.user.position].filter(Boolean).join(" · ") || "-"}</div>
      </>,
      <>
        <Badge variant="outline" className="bg-blue-50 mb-1">{TYPE_LABEL[lr.type] || lr.type}</Badge>
        <div>{range}</div>
        <div className="text-xs text-gray-500">{lr.days}일</div>
      </>,
      <>{c.reason || "-"}</>,
      <>
        {/* 결재 점(kit) — 끝난 사람 파랑 · 지금 차례 주황 · 남은 사람 회색 */}
        <FlowDots steps={c.approvalSteps.map((s) => ({ label: stepLabel(s), state: s.status === "APPROVED" ? "done" : s.status === "PENDING" ? "now" : "todo" }))} />
        {c.approvalSteps.some((x) => x.comment) && (
          <div className="mt-1 space-y-0.5">
            {c.approvalSteps.filter((x) => x.comment).map((x) => (
              <div key={x.id} className="text-xs text-gray-500">의견 · {stepLabel(x)}: {x.comment}</div>
            ))}
          </div>
        )}
      </>,
      <>
        {/* 줄마다 두 개 — 흰 「반려」 + 인디고 「승인」(승인 확인 창에서 의견 선택, 옛 「의견」 버튼 대신 — 시안 R11) */}
        <div className="flex gap-1.5 justify-end">
          <Btn className="px-3.5 py-1.5" disabled={processingId === c.id} onClick={() => { setRejectId(c.id); setRejectReason(""); }}>반려</Btn>
          <Btn kind="primary" className="px-3.5 py-1.5" disabled={processingId === c.id} onClick={() => { setNoteId(c.id); setNoteText(""); }}>
            {processingId === c.id ? "처리 중…" : "승인"}
          </Btn>
        </div>
      </>,
    ] as const;
  };
  return (
    <>
      <p className="text-xs text-gray-500">
        승인된 휴가를 본인이 취소하겠다고 올린 결재입니다. <b>최종 승인되면 휴가가 취소되고 연차가 복구</b>되며,
        반려하면 휴가는 그대로 유지됩니다.
      </p>
      <>
      <Card className="overflow-hidden hidden md:block">
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
                const cells = cancelCells(row);
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">{cells[0]}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{cells[1]}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 max-w-xs">{cells[2]}</td>
                    <td className="px-6 py-4">{cells[3]}</td>
                    <td className="px-6 py-4 text-right">{cells[4]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="space-y-2 md:hidden">
        {filtered.map((row) => {
          const cells = cancelCells(row);
          return (
            <div key={row.id} className="rounded-xl border bg-white p-3">
              <div className="mb-1">{cells[0]}</div>
              <div className="flex gap-3 border-t border-gray-100 py-1.5">
                <span className="w-12 shrink-0 pt-0.5 text-xs text-gray-400">취소할 휴가</span>
                <div className="min-w-0 flex-1 text-sm text-gray-700">{cells[1]}</div>
              </div>
              <div className="flex gap-3 border-t border-gray-100 py-1.5">
                <span className="w-12 shrink-0 pt-0.5 text-xs text-gray-400">취소 사유</span>
                <div className="min-w-0 flex-1 text-sm text-gray-700">{cells[2]}</div>
              </div>
              <div className="flex gap-3 border-t border-gray-100 py-1.5">
                <span className="w-12 shrink-0 pt-0.5 text-xs text-gray-400">결재</span>
                <div className="min-w-0 flex-1 text-sm text-gray-700">{cells[3]}</div>
              </div>
              <div className="border-t border-gray-100 pt-2">{cells[4]}</div>
            </div>
          );
        })}
      </div>
      </>

      <Dialog open={!!noteId} onOpenChange={(o) => { if (!o) setNoteId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>취소 요청 승인</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">최종 승인되면 휴가가 취소되고 연차가 복구됩니다.</p>
            <Textarea value={noteText} maxLength={300} rows={3} placeholder="의견 (선택 — 다음 결재자와 본부가 봅니다)"
              onChange={(e) => setNoteText(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <Btn onClick={() => setNoteId(null)}>닫기</Btn>
              <Btn kind="primary" disabled={processingId !== null}
                onClick={async () => { if (!noteId) return; const id = noteId; setNoteId(null); await decide(id, "approve", noteText.trim() || undefined); }}>
                승인
              </Btn>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectId} onOpenChange={(o) => { if (!o) setRejectId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>취소 요청 반려</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">반려하면 휴가는 그대로 유지되고, 사유가 신청자에게 전달됩니다.</p>
            <Textarea placeholder="반려 사유 (선택)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} />
            <div className="flex gap-2 justify-end">
              <Btn onClick={() => setRejectId(null)}>닫기</Btn>
              <Btn kind="primary" disabled={processingId !== null}
                onClick={() => rejectId && decide(rejectId, "reject", rejectReason.trim() || undefined)}>
                {processingId !== null ? "처리 중…" : "반려"}
              </Btn>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
