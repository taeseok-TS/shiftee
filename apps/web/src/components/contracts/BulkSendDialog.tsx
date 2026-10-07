"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * 선택한 초안 한꺼번에 발송(2026-10-07 QA #34).
 * 결재선은 건마다 1단계 본부(여기서 고른 한 명) → 2단계 그 직원 지점 원장(자동) → 3단계 근로자 본인.
 * 패키지는 묶음 발송 한 번, 직원전용 문서는 직원 본인 한 단계. 외부 계약은 링크 전달이 따로라 빼고 알려 준다.
 * 중복 발송 경고(#47)는 모아서 한 번만 묻고, 값 검증(#24)에 걸린 건은 이유와 함께 알려 준다.
 */
type C = {
  id: string; userId: string; title: string; status: string; bundleId?: string | null; employeeOnly?: boolean;
  externalName?: string | null; user: { name: string; branch?: string | null };
};
type E = { id: string; name: string; role?: string; branch?: string | null; managerBranches?: string[] };

export default function BulkSendDialog({ open, onClose, contracts, employees, onDone }: {
  open: boolean; onClose: () => void; contracts: C[]; employees: E[]; onDone: (keepIds: string[]) => void;   // keepIds = 못 보낸 것(다시 고른 채로 둔다)
}) {
  const admins = employees.filter((e) => e.role === "ADMIN" && (e as { isContractApprover?: boolean }).isContractApprover !== false);
  const [hq, setHq] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/admin/contract-message").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.message) setMsg((m) => m || d.message); }).catch(() => {});
    return () => { alive = false; };
  }, [open]);

  const mgrOf = (c: C) => {
    const b = c.user.branch;
    const m = b ? employees.find((e) => e.role === "MANAGER" && (e.branch === b || (e.managerBranches || []).includes(b))) : undefined;
    return m && m.id !== c.userId ? m : undefined;
  };
  // 보낼 단위 — 패키지는 하나로 묶는다(반려 문서는 그 문서만)
  const units = (() => {
    const seen = new Set<string>(); const out: { key: string; c: C; bundle: boolean }[] = [];
    for (const c of contracts) {
      if (c.externalName) continue;
      const bundle = !!c.bundleId && c.status !== "REJECTED";
      const key = bundle ? `b:${c.bundleId}` : c.id;
      if (seen.has(key)) continue;
      seen.add(key); out.push({ key, c, bundle });
    }
    return out;
  })();
  const external = contracts.filter((c) => c.externalName);
  const noMgr = units.filter((u) => !u.c.employeeOnly && !mgrOf(u.c));

  const run = async () => {
    if (!hq) { toast.error("1단계 본부 결재자를 골라 주세요."); return; }
    setBusy(true);
    const ok: string[] = [], fail: string[] = [], dupUnits: typeof units = [], keep: string[] = [];
    const send = async (u: (typeof units)[number], confirmDuplicate: boolean) => {
      // 본부 결재자가 계약 당사자 본인이면 1단계를 비운다 — 단건 발송 창과 같은 규칙(#34 검증 F13: 근로자 서명이 1단계로 당겨졌다)
      const ids = u.c.employeeOnly && !u.bundle ? [u.c.userId]
        : [hq !== u.c.userId ? hq : null, mgrOf(u.c)?.id ?? null, u.c.userId].filter((x): x is string => !!x);
      const res = u.bundle
        ? await fetch(`/api/contracts/bundle/${u.c.bundleId}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approverIds: ids, sendMessage: msg, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) }) })
        : await fetch(`/api/contracts/${u.c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "SENT", approverIds: ids, sendMessage: msg, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) }) });
      const d = await res.json().catch(() => ({}));
      return { res, d };
    };
    try {
      const failOf = (u: (typeof units)[number], why: string) => { fail.push(`${u.c.user.name}(${why})`); keep.push(u.c.id); };
      for (const u of units) {
        try {
          const { res, d } = await send(u, false);
          if (res.ok) ok.push(u.c.user.name);
          else if (res.status === 409 && d.code === "DUPLICATE") dupUnits.push(u);
          else failOf(u, d.error || "실패");
        } catch { failOf(u, "네트워크 오류"); }   // 한 건이 끊겨도 나머지는 계속 보내고 결과를 알린다
      }
      if (dupUnits.length && confirm(`같은 양식이 진행 중이거나 30일 안에 보낸 직원이 있습니다:\n${dupUnits.map((u) => `· ${u.c.user.name} — ${u.c.title}`).join("\n")}\n\n이 ${dupUnits.length}건도 발송할까요?`)) {
        for (const u of dupUnits) {
          try {
            const { res, d } = await send(u, true);
            if (res.ok) ok.push(u.c.user.name); else failOf(u, d.error || "실패");
          } catch { failOf(u, "네트워크 오류"); }
        }
      } else if (dupUnits.length) for (const u of dupUnits) failOf(u, "중복 — 보내지 않음");
    } finally {
      setBusy(false);
    }
    if (fail.length) toast.error(`${ok.length}건 발송, ${fail.length}건 못 보냄: ${fail.join(", ")}`, { duration: 15000 });
    else toast.success(`${ok.length}건 발송했습니다.`);
    onDone(keep);
    if (!fail.length) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>선택한 계약 {units.length}건 한꺼번에 발송</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-gray-600">건마다 결재선: <b>1단계 본부</b>(아래에서 고름) → <b>2단계 지점 원장</b>(자동) → <b>3단계 근로자</b>. 패키지는 함께, 직원전용 문서는 직원 본인만.</p>
          <div>
            <span className="text-xs font-medium text-gray-600">1단계 본부 결재자</span>
            <select value={hq} onChange={(e) => setHq(e.target.value)} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm">
              <option value="">선택</option>
              {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="max-h-44 overflow-y-auto rounded border divide-y text-xs">
            {units.map((u) => {
              const m = mgrOf(u.c);
              return (
                <div key={u.key} className="px-2 py-1.5">
                  {u.c.user.branch ? `[${u.c.user.branch}] ` : ""}{u.c.user.name} — {u.c.title}{u.bundle ? " (패키지)" : ""}
                  <span className="block text-gray-400">{u.c.employeeOnly && !u.bundle ? "근로자 본인만" : `원장: ${m ? m.name : "없음(2단계 없이 본부 → 근로자)"}`}</span>
                </div>
              );
            })}
          </div>
          {noMgr.length > 0 && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">지점 원장을 찾지 못한 {noMgr.length}건은 2단계 없이 보냅니다.</p>}
          {external.length > 0 && <p className="text-xs text-gray-500">외부 계약 {external.length}건은 서명 링크 전달이 따로라 빼고 보냅니다 — 목록에서 각각 발송해 주세요.</p>}
          <div>
            <span className="text-xs font-medium text-gray-600">발송 메시지 <span className="font-normal text-gray-400">(선택 · 알림·메일·서명 화면)</span></span>
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm resize-none" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>취소</Button>
            <Button onClick={() => { if (confirm(`${units.length}건을 발송합니다. 발송 후에는 문서를 수정할 수 없습니다. 발송할까요?`)) run(); }} disabled={busy || !units.length || !hq}>
              {busy ? "발송 중…" : `${units.length}건 발송`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
