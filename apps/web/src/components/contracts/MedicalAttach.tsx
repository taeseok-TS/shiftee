"use client";

// 임신기 신청서 진단서 첨부(#242, lib/contract-medical) — 대상 서류가 아니면 아무것도 그리지 않는다(서버가 required:false)
//  · MedicalAttachBox  — 근로자 서명 창·본부 결재 히스토리 창·재무 전자계약 화면. 올리기(본부·본인)·열기(본부·본인·재무), 지우기(본부)
//  · MedicalAttachBadge — 결재 전체 창(원장 등). 「진단서 첨부됨」 표시만, 파일·이름 없음
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type Att = { attId: string; name: string; size: number; mime: string; uploadedAt: string; uploadedBy: string | null; byAdmin: boolean };
type Full = { required: true; reapply: boolean; attachments: Att[]; canUpload: boolean; canDelete: boolean; maxFiles: number };
type Summary = { required: true; count: number; reapply: boolean };
type State = { required: false } | Full | Summary;

export type MedicalStatus = { required: boolean; count: number };

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

function useMedical(contractId: string) {
  const [st, setSt] = useState<State | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(`/api/contracts/${contractId}/attachments`)
      .then(async (r) => { const d = await r.json().catch(() => null); if (alive) setSt(r.ok && d ? (d as State) : { required: false }); })
      .catch(() => { if (alive) setSt({ required: false }); });
    return () => { alive = false; };
  }, [contractId, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { st, reload };
}

export function MedicalAttachBox({ contractId, signer = false, reapply, onReapply, onStatus }: {
  contractId: string;
  signer?: boolean;                        // 근로자 본인 서명 창 — 「같은 임신으로 다시 신청」 체크를 보인다
  reapply?: boolean;
  onReapply?: (v: boolean) => void;
  onStatus?: (s: MedicalStatus) => void;   // 서명 단추 막기용(대상 여부·첨부 수)
}) {
  const { st, reload } = useMedical(contractId);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const full = st && st.required && "attachments" in st ? st : null;
  useEffect(() => {
    if (!st) return;
    onStatus?.({ required: st.required, count: full ? full.attachments.length : st.required && "count" in st ? st.count : 0 });
  }, [st, full, onStatus]);
  if (!full) return null;

  const upload = async (files: FileList | null) => {
    if (!files?.length || busy) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", f);
        const r = await fetch(`/api/contracts/${contractId}/attachments`, { method: "POST", body: fd });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { toast.error(`${f.name}: ${d.error || "올리지 못했습니다."}`); break; }
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      reload();
    }
  };
  const remove = async (a: Att) => {
    if (!confirm(`「${a.name}」을(를) 지울까요? 지우면 되돌릴 수 없습니다.`)) return;
    const r = await fetch(`/api/contracts/${contractId}/attachments/${a.attId}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) toast.error(d.error || "지우지 못했습니다.");
    reload();
  };
  const none = full.attachments.length === 0;

  return (
    <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <p className="text-sm font-bold text-gray-900">진단서 첨부 {signer && <span className="text-red-500">*</span>}</p>
      <p className="text-xs text-gray-600">{full.canUpload ? "임신 사실·주수를 확인할 수 있는 진단서(의사 소견서)를 올려 주세요. " : ""}본부·본인·재무팀만 볼 수 있습니다(원장님께는 「첨부됨」만 보입니다).</p>
      {full.attachments.map((a) => (
        <div key={a.attId} className="flex items-center gap-2 rounded border bg-white px-2 py-1.5 text-xs">
          <a href={`/api/contracts/${contractId}/attachments/${a.attId}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-indigo-700 hover:underline">{a.name}</a>
          <span className="shrink-0 text-gray-400">{kb(a.size)}{a.byAdmin ? " · 본부" : ""}</span>
          {full.canDelete && <button type="button" onClick={() => void remove(a)} className="shrink-0 text-red-600 hover:underline">삭제</button>}
        </div>
      ))}
      {full.canUpload && (
        <>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/*" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
            className="w-full rounded-lg border border-dashed border-amber-400 bg-white py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60">
            {busy ? "올리는 중…" : `+ 진단서 올리기 (PDF·사진, 파일당 10MB, ${full.maxFiles}개까지)`}
          </button>
        </>
      )}
      {signer && none && (
        <label className="flex cursor-pointer items-start gap-2 text-xs text-gray-700">
          <input type="checkbox" className="mt-0.5" checked={!!reapply} onChange={(e) => onReapply?.(e.target.checked)} />
          <span>같은 임신으로 다시 신청합니다(진단서는 앞서 제출했습니다)</span>
        </label>
      )}
      {!signer && none && <p className="text-xs text-amber-800">{full.reapply ? "진단서 없음 — 근로자가 「같은 임신 재신청」으로 생략" : "아직 첨부된 진단서가 없습니다."}</p>}
    </section>
  );
}

export function MedicalAttachBadge({ contractId }: { contractId: string }) {
  const { st } = useMedical(contractId);
  if (!st || !st.required) return null;
  const count = "attachments" in st ? st.attachments.length : st.count;
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
      <p className="font-bold text-gray-900">진단서</p>
      <p className={count ? "text-green-700" : "text-amber-800"}>
        {count ? `✓ 진단서 첨부됨${count > 1 ? ` (${count}건)` : ""}` : st.reapply ? "진단서 없음 — 같은 임신 재신청" : "아직 첨부되지 않음(근로자 서명 때 올립니다)"}
      </p>
      <p className="mt-0.5 text-[12px] text-gray-500">진단서 내용은 본부·본인·재무팀만 볼 수 있습니다.</p>
    </section>
  );
}
