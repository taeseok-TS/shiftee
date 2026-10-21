"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { stepsLabel } from "@/lib/approval-order";
import { approverIdsOf, isMultiHq, mgrOf, needsHq, planUnits, sendResultText, sendUnits, unitSpecs, type SendContract, type SendEmployee } from "@/components/contracts/bulk-send-core";

/**
 * 선택한 초안 한꺼번에 발송(2026-10-07 QA #34).
 * 결재선은 건마다 1단계 본부(여기서 고른 한 명) → 2단계 그 직원 지점 원장(자동) → 3단계 근로자 본인.
 * 패키지는 묶음 발송 한 번, 직원전용 문서는 직원 본인 한 단계. 외부 계약은 링크 전달이 따로라 빼고 알려 준다.
 * 중복 발송 경고(#47)는 모아서 한 번만 묻고, 값 검증(#24)에 걸린 건은 이유와 함께 알려 준다.
 */
type C = SendContract;
type E = SendEmployee;

export default function BulkSendDialog({ open, onClose, contracts, employees, mainManagerIds, onDone }: {
  open: boolean; onClose: () => void; contracts: C[]; employees: E[]; onDone: (keepIds: string[]) => void;   // keepIds = 못 보낸 것(다시 고른 채로 둔다)
  mainManagerIds?: Record<string, string>;   // 지점 → 메인 원장 id(단건 발송 창과 같은 원장 고르기)
}) {
  const admins = employees.filter((e) => e.role === "ADMIN" && e.isContractApprover !== false);
  const [hq, setHq] = useState("");
  const [msg, setMsg] = useState("");
  const [days, setDays] = useState("14");   // 서명 기한(#45)
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/admin/contract-message").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.message) setMsg((m) => m || d.message); }).catch(() => {});
    return () => { alive = false; };
  }, [open]);

  // 규칙은 bulk-send-core 하나(계약서 보내기 3단계와 같이 쓴다, 2026-10-20)
  const units = planUnits(contracts);
  const external = contracts.filter((c) => c.externalName);
  const noMgr = units.filter((u) => !u.c.employeeOnly && !mgrOf(u.c, employees, mainManagerIds));
  const multiHq = units.filter((u) => isMultiHq(u, contracts));
  const needHq = needsHq(units, contracts);

  const run = async () => {
    if (needHq && !hq) { toast.error("본부 결재자를 골라 주세요(양식에 본부 단계가 있는 건이 있습니다)."); return; }
    setBusy(true);
    let result: { ok: string[]; fail: string[]; keep: string[]; docs: number; people: number } = { ok: [], fail: [], keep: [], docs: 0, people: 0 };
    try {
      result = await sendUnits(units, (u) => (isMultiHq(u, contracts) ? null : approverIdsOf(u, contracts, employees, hq, mainManagerIds)), {
        message: msg, deadlineDays: Number(days) || 14,
        confirmDup: (dups) => confirm(`같은 양식이 진행 중이거나 30일 안에 보낸 직원이 있습니다:\n${dups.map((u) => `· ${u.c.user.name} — ${u.c.title}`).join("\n")}\n\n이 ${dups.length}건도 발송할까요?`),
      });
    } finally {
      setBusy(false);
    }
    const { fail, keep } = result;
    if (fail.length) toast.error(sendResultText(result), { duration: 15000 });
    else toast.success(sendResultText(result));
    onDone(keep);
    if (!fail.length) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>선택한 계약 {units.length}건 한꺼번에 발송</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-gray-600">건마다 결재선은 <b>양식의 결재 순서</b>대로(#213-2): 본부는 아래에서 고른 한 명, 원장은 당사자 지점 원장 자동, 근로자는 당사자 본인. 패키지는 함께, 직원전용 문서는 직원 본인만.</p>
          <div>
            <span className="text-xs font-medium text-gray-600">본부 결재자 {needHq ? "" : "(이번 건들은 본부 단계가 없어 선택하지 않아도 됩니다)"}</span>
            <select value={hq} onChange={(e) => setHq(e.target.value)} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm">
              <option value="">선택</option>
              {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="max-h-44 overflow-y-auto rounded border divide-y text-xs">
            {units.map((u) => {
              const m = mgrOf(u.c, employees, mainManagerIds);
              return (
                <div key={u.key} className="px-2 py-1.5">
                  {u.c.user.branch ? `[${u.c.user.branch}] ` : ""}{u.c.user.name} — {u.c.title}{u.bundle ? " (패키지)" : ""}
                  <span className="block text-gray-400">{u.c.employeeOnly && !u.bundle ? "근로자 본인만" : `${stepsLabel(unitSpecs(u, contracts))} · 원장: ${m ? m.name : "없음(원장 단계 없이)"}`}</span>
                </div>
              );
            })}
          </div>
          {noMgr.length > 0 && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">지점 원장을 찾지 못한 {noMgr.length}건은 원장 단계 없이 보냅니다(양식이 고정 순서면 당사자가 원장일 때만 통과).</p>}
          {multiHq.length > 0 && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">결재 순서에 본부 단계가 둘 이상인 {multiHq.length}건은 여기서 못 보냅니다 — 목록에서 각각 발송해 주세요.</p>}
          {external.length > 0 && <p className="text-xs text-gray-500">외부 계약 {external.length}건은 서명 링크 전달이 따로라 빼고 보냅니다 — 목록에서 각각 발송해 주세요.</p>}
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span className="font-medium">서명 기한</span>
            <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} className="w-16 rounded-md border px-2 py-1 text-sm" />일
            <span className="text-gray-400">· 지나면 자동 만료, 미서명 알림 3일마다</span>
          </div>
          <div>
            <span className="text-xs font-medium text-gray-600">발송 메시지 <span className="font-normal text-gray-400">(선택 · 알림·메일·서명 화면)</span></span>
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm resize-none" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>취소</Button>
            <Button onClick={() => { if (confirm(`${units.length}건을 발송합니다. 발송 후에는 문서를 수정할 수 없습니다. 발송할까요?`)) run(); }} disabled={busy || !units.length || (needHq && !hq)}>
              {busy ? "발송 중…" : `${units.length}건 발송`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
