"use client";
// 결재 전체 창을 여는 쪽 — 본문 받기·승인·반려까지 한 번에(2026-10-21 본부 이예지 재요청 C).
// 원장 「팀 계약서」에서 쓰던 전체 창(ApprovalFullView)을 본부 결재(결재함 › 계약 · 보낸 계약서 › 내 승인 대기)도 그대로 쓴다 —
// 옛 작은 팝업(「저장된 서명으로 승인」 한 번 누르기)은 문서를 끝까지 보지 않고 승인할 수 있었다.
// 받는 계약은 /api/contracts/my-approvals 의 항목 모양(원장 화면과 같다). 규칙은 서버가 그대로 본다(비밀번호 재확인·문서 버전 묶기).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ApprovalFullView, { type SignPayload } from "@/components/contracts/ApprovalFullView";

export type HostStep = {
  id: string; order: number; status: string; approverId?: string | null; decidedAt?: string | null; hasSignature?: boolean;
  approver?: { id: string; name: string; branch?: string | null; role?: string | null } | null; externalName?: string | null;
};
export type HostContract = {
  id: string; title: string; userId?: string; type?: string; status?: string; fileUrl?: string | null; version?: number;
  externalName?: string | null; sendMessage?: string | null; employeeOnly?: boolean; isTest?: boolean;
  startDate?: string | null; endDate?: string | null;
  summaryFields?: Record<string, string> | null; extraFields?: Record<string, string> | null;
  user: { id?: string; name: string; branch: string | null; empNo?: number | null };
  approvalLine?: { steps: HostStep[] } | null;
};

/** 계약 파일 — JSON 배열이면 첫 파일 */
export function firstFile(fileUrl?: string | null): string {
  if (!fileUrl) return "";
  try { const a = JSON.parse(fileUrl); return Array.isArray(a) ? a[0] || "" : fileUrl; } catch { return fileUrl; }
}
/** 서명 진행본·완료본 — 서명이 하나라도 있는 진행 중 계약(반려 제외)·완료 계약. 직원전용·외부·시험 문서는 원본 그대로(서버 signed-document 와 같은 범위) */
export function progressHrefOf(c: HostContract): string | null {
  if (c.externalName || c.employeeOnly || c.isTest) return null;
  const signed = c.status === "SIGNED" || (c.status !== "REJECTED" && (c.approvalLine?.steps || []).some((s) => !!s.hasSignature));
  return signed ? `/api/contracts/${c.id}/signed-document?pdf=1&inline=1` : null;
}
// 열람 기록(#205-4) — 본문이 실제로 열렸을 때(서버가 10분 안 중복은 하나로)
function recordViewed(id: string) {
  fetch(`/api/contracts/${id}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "VIEWED" }) }).catch(() => {});
}

export default function ApprovalFullViewHost({ c, docLabel, myId, myRole, onClose, onDone }: {
  c: HostContract;
  docLabel: string;          // 서류 이름(양식 종류)
  myId: string;
  myRole: string;            // 내 단계 이름 — 「본부」·「원장」
  onClose: () => void;
  onDone: () => void;        // 승인·반려가 끝났다(목록을 다시 받는다)
}) {
  const [docBlob, setDocBlob] = useState<string | null>(null);
  const [docErr, setDocErr] = useState<string | null>(null);
  const [docIsProgress, setDocIsProgress] = useState(false);
  const [mySignatureUrl, setMySignatureUrl] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);
  const raw = firstFile(c.fileUrl);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me").then((r) => r.json()).then((d) => { if (alive) setMySignatureUrl(d.user?.signatureUrl || null); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // 본문 — docx 는 서버 변환 PDF, PDF 양식은 그대로. 앞 단계 서명이 있으면 서명 반영본(진행본), 못 받으면 원본. 정상 PDF 일 때만 승인 가능(전체 창이 막는다)
  useEffect(() => {
    if (!raw) return;   // 파일 없는 옛 계약은 요약만으로
    let alive = true;
    let made: string | null = null;
    const src = /\.pdf$/i.test(raw) ? raw : `/api/docs/pdf?src=${encodeURIComponent(raw)}`;
    const prog = progressHrefOf(c);
    const load = (u: string) => fetch(u).then(async (r) => {
      const ct = r.headers.get("content-type") || "";
      if (!r.ok || !ct.includes("pdf")) throw new Error(r.status === 403 ? "본문을 열 권한이 없습니다." : "본문을 불러오지 못했습니다.");
      return { b: await r.blob(), isProg: u === prog };
    });
    (prog ? load(prog).catch(() => load(src)) : load(src))
      .then(({ b, isProg }) => {
        if (!alive) return;
        made = URL.createObjectURL(b);
        setDocBlob(made); setDocIsProgress(isProg);
        recordViewed(c.id);
      })
      .catch((e: unknown) => { if (alive) setDocErr(e instanceof Error ? e.message : "본문을 불러오지 못했습니다."); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
    // 계약이 바뀌면 부모가 key 로 새로 만든다 — 같은 계약 안에서는 한 번만 받는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function approve(p: SignPayload) {
    if (signing) return;
    const body: Record<string, unknown> = p.useSaved ? { useSaved: true, isApprover: true } : { signatureData: p.signatureData, isApprover: true, saveAsDefault: p.saveAsDefault };
    body.password = p.password;
    setSigning(true);
    try {
      const res = await fetch(`/api/contracts/${c.id}/sign`, {
        method: "POST",
        // 창을 연 뒤 문서가 고쳐졌으면 서버가 거절한다(문서 버전 묶기)
        headers: { "Content-Type": "application/json", ...(typeof c.version === "number" ? { "x-doc-version": String(c.version) } : {}) },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "결재 처리에 실패했습니다."); return; }
      toast.success("계약서를 승인했습니다.");
      onDone();
    } finally { setSigning(false); }
  }

  async function reject() {
    const reason = rejectReason.trim();
    if (!reason) { toast.error("반려 사유를 입력해주세요."); return; }
    setRejectBusy(true);
    try {
      const res = await fetch(`/api/contracts/${c.id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "반려에 실패했습니다."); return; }
      toast.success("반려했습니다. 작성자와 당사자에게 알림이 갑니다.");
      setRejectOpen(false); setRejectReason("");
      onDone();
    } finally { setRejectBusy(false); }
  }

  return (
    <>
      <ApprovalFullView
        c={{
          id: c.id, title: c.title, userId: c.userId || c.user.id || "", externalName: c.externalName, sendMessage: c.sendMessage,
          user: { name: c.user.name, branch: c.user.branch, empNo: c.user.empNo },
          docLabel,
          period: c.startDate || c.endDate ? `${(c.startDate || "?").slice(0, 10)} ~ ${(c.endDate || "?").slice(0, 10)}` : null,
          summaryFields: c.summaryFields ?? c.extraFields ?? null,
          steps: (c.approvalLine?.steps || []).map((st) => ({ id: st.id, order: st.order, status: st.status, approverId: st.approverId ?? null, decidedAt: st.decidedAt, approver: st.approver, externalName: st.externalName })),
        }}
        myId={myId} myRole={myRole}
        docUrl={docBlob} docErr={docErr} docIsProgress={docIsProgress} hasFile={!!raw}
        mySignatureUrl={mySignatureUrl} busy={signing} paused={rejectOpen}
        onSubmit={approve}
        onReject={() => { setRejectReason(""); setRejectOpen(true); }}
        onClose={() => { if (!signing) onClose(); }}
      />
      {/* 반려 확인 — 되돌릴 수 없으므로 사유를 받는다(2026-09-04) */}
      <Dialog open={rejectOpen} onOpenChange={(o) => { if (!rejectBusy) { setRejectOpen(o); if (!o) setRejectReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>계약 반려</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="font-medium text-gray-800">{c.title}</p>
            <p className="text-red-600">반려하면 결재가 멈추고 작성자·당사자에게 사유가 전달됩니다. 관리자가 내용을 고쳐 다시 보내면 1단계부터 다시 진행됩니다.</p>
            <div>
              <label className="mb-1 block font-medium">반려 사유 <span className="text-red-500">*</span></label>
              <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4} maxLength={500} autoFocus
                placeholder="어디가 잘못됐는지 적어 주세요. 작성자와 당사자에게 그대로 전달됩니다." />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={rejectBusy}>취소</Button>
              <Button onClick={() => void reject()} disabled={rejectBusy || !rejectReason.trim()} className="bg-red-600 text-white hover:bg-red-700">{rejectBusy ? "처리 중..." : "반려"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
