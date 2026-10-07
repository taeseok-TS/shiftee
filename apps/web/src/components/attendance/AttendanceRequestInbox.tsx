"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, Loader2, ImageIcon } from "lucide-react";
import { toast } from "sonner";

/**
 * 출퇴근 요청 결재함(2026-10-07 QA #9 #13 #15) — 관리자 결재함(admin/leave-approvals)과 원장 결재함
 * (manager/team-leave, 원장대행 /approvals)이 **같은 컴포넌트**를 쓴다.
 * 데이터: GET /api/attendance-requests?scope=inbox · 처리: POST /api/attendance-requests/[id]
 * 승인하면 요청의 시각으로 출퇴근 기록이 생기거나 고쳐진다(기기 변경은 새 기기로 등록).
 */

type Req = {
  id: string; userName: string; userBranch: string | null; userPosition: string | null;
  kind: string; kindLabel: string; action: string | null; summary: string; reason: string | null; memo: string | null;
  hasPhoto: boolean; deviceName: string | null; platform: string | null; approverLabel: string; createdAt: string;
};

const KIND_COLOR: Record<string, string> = {
  OUTSIDE: "bg-amber-100 text-amber-800", PHOTO: "bg-sky-100 text-sky-800", HQ: "bg-violet-100 text-violet-800",
  CORRECTION: "bg-gray-100 text-gray-800", MISSED_OUT: "bg-rose-100 text-rose-800", DEVICE: "bg-emerald-100 text-emerald-800",
};

export default function AttendanceRequestInbox({ onCount, searchName = "" }: { onCount?: (n: number) => void; searchName?: string }) {
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Req | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);

  const fetchRows = () =>
    fetch("/api/attendance-requests?scope=inbox").then((r) => (r.ok ? r.json() : { requests: [] })).catch(() => ({ requests: [] }));
  const apply = useCallback((d: { requests?: Req[] }) => {
    const list = d.requests || [];
    setRows(list);
    onCount?.(list.length);
    setLoading(false);
  }, [onCount]);
  const load = useCallback(async () => apply(await fetchRows()), [apply]);
  useEffect(() => {
    fetchRows().then(apply);
  }, [apply]);

  const shown = useMemo(() => {
    const s = searchName.trim().toLowerCase();
    return s ? rows.filter((r) => r.userName.toLowerCase().includes(s)) : rows;
  }, [rows, searchName]);

  const decide = async (r: Req, action: "approve" | "reject", reason?: string) => {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/attendance-requests/${r.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "처리하지 못했습니다."); return; }
      toast.success(action === "approve" ? "승인했습니다. 출퇴근 기록에 반영했습니다." : "반려했습니다.");
      setRejecting(null);
      setRejectReason("");
      load();
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="py-10 text-center text-gray-400"><Loader2 className="inline animate-spin" size={18} /> 불러오는 중…</div>;
  if (shown.length === 0) return <Card><CardContent className="py-10 text-center text-gray-400">처리할 출퇴근 요청이 없습니다.</CardContent></Card>;

  return (
    <div className="space-y-3">
      {shown.map((r) => (
        <Card key={r.id}>
          <CardContent className="py-4 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{r.userName}</span>
                <span className="text-xs text-gray-500">{r.userBranch ?? "-"}{r.userPosition ? ` · ${r.userPosition}` : ""}</span>
                <Badge className={KIND_COLOR[r.kind] ?? ""}>{r.kindLabel}</Badge>
                <span className="text-xs text-gray-400">결재: {r.approverLabel}</span>
              </div>
              <div className="text-sm">{r.kind === "DEVICE" ? `새 기기: ${r.deviceName ?? "이름 없음"} (${r.platform ?? "-"})` : r.summary}</div>
              {(r.kind === "CORRECTION" || r.kind === "MISSED_OUT") && r.reason && <div className="text-sm text-gray-600">사유: {r.reason}</div>}
              {r.memo && <div className="text-sm text-gray-600">메모: {r.memo}</div>}
              <div className="text-xs text-gray-400">요청 {new Date(r.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
            </div>
            <div className="flex gap-2 shrink-0">
              {r.hasPhoto && (
                <Button size="sm" variant="outline" onClick={() => setPhoto(`/api/attendance-requests/${r.id}/photo`)}>
                  <ImageIcon size={14} className="mr-1" />사진
                </Button>
              )}
              <Button size="sm" disabled={busy === r.id} onClick={() => decide(r, "approve")}>
                <Check size={14} className="mr-1" />승인
              </Button>
              <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => { setRejecting(r); setRejectReason(""); }}>
                <X size={14} className="mr-1" />반려
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!rejecting} onOpenChange={(o) => { if (!o) setRejecting(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>반려 사유</DialogTitle></DialogHeader>
          <Textarea value={rejectReason} maxLength={300} placeholder="신청자에게 전달됩니다 (선택)" onChange={(e) => setRejectReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejecting(null)}>닫기</Button>
            <Button disabled={!rejecting || busy === rejecting.id} onClick={() => rejecting && decide(rejecting, "reject", rejectReason.trim())}>반려</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!photo} onOpenChange={(o) => { if (!o) setPhoto(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>지점 사진</DialogTitle></DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element -- 인증이 붙은 비공개 사진이라 next/image 최적화를 거치지 않는다 */}
          {photo && <img src={photo} alt="지점 사진" className="w-full rounded" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
