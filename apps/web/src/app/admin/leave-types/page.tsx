"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, X, Check } from "lucide-react";
import { resetLeaveCatalogCache } from "@/components/leave/useLeaveCatalog";

// 휴가 유형 관리(2026-10-12 개선 제안 #216-1, 디렉터 채택) — 본부만.
//  · 기본 유형은 고치지 못하고 「신청 목록에서 숨김」만 할 수 있다(연차는 못 숨긴다). 기록 표시·계산은 그대로.
//  · 본부가 만든 유형: 이름·그룹·단위·유급 시간·연차 차감·필수 첨부·안내·표시 여부·순서. 신청 기록이 있으면 지우지 못하고 숨긴다.
type Builtin = { code: string; label: string; group: string; unit: string; paidHours: number; deducts: boolean; attachRequired: string | null; notice: string | null; selectableDefault: boolean; hidden: boolean; used: number };
type Custom = { id: string; code: string; label: string; group: string; unit: string; paidHours: number; deducts: boolean; attachRequired: string | null; notice: string | null; selectable: boolean; sortOrder: number; used: number };
type Draft = { label: string; group: string; unit: string; paidHours: string; deducts: boolean; attachRequired: string; notice: string; selectable: boolean; sortOrder: string };
const UNIT_LABEL: Record<string, string> = { FULL: "하루(기간)", HALF: "반차 0.5일", QUARTER: "반반차 0.25일" };
const emptyDraft = (group = "기타휴가"): Draft => ({ label: "", group, unit: "FULL", paidHours: "8", deducts: false, attachRequired: "", notice: "", selectable: true, sortOrder: "0" });

// 유형 입력 폼 — 추가·수정 공용(렌더 중에 컴포넌트를 만들면 글자를 칠 때마다 다시 마운트돼 포커스가 빠진다 → 바깥에 둔다)
function TypeForm({ v, set, onOk, onCancel, okLabel, groups, busy }: { v: Draft; set: (d: Draft) => void; onOk: () => void; onCancel: () => void; okLabel: string; groups: string[]; busy: boolean }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-lg border bg-gray-50 p-3 text-sm">
      <label className="space-y-1"><span className="text-xs text-gray-500">이름 *</span><Input value={v.label} onChange={(e) => set({ ...v, label: e.target.value })} placeholder="예: 생리휴가" className="h-8" /></label>
      <label className="space-y-1"><span className="text-xs text-gray-500">그룹 *</span>
        <select value={v.group} onChange={(e) => set({ ...v, group: e.target.value })} className="h-8 w-full rounded border px-2 bg-white">{groups.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
      <label className="space-y-1"><span className="text-xs text-gray-500">단위 *</span>
        <select value={v.unit} onChange={(e) => set({ ...v, unit: e.target.value, paidHours: e.target.value === "FULL" ? "8" : e.target.value === "HALF" ? "4" : "2" })} className="h-8 w-full rounded border px-2 bg-white">
          {Object.entries(UNIT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="space-y-1"><span className="text-xs text-gray-500">유급 시간(하루·반차당)</span><Input type="number" min={0} max={24} value={v.paidHours} onChange={(e) => set({ ...v, paidHours: e.target.value })} className="h-8" /></label>
      <label className="space-y-1 md:col-span-2"><span className="text-xs text-gray-500">필수 첨부(선택)</span><Input value={v.attachRequired} onChange={(e) => set({ ...v, attachRequired: e.target.value })} placeholder="예: 진단서" className="h-8" /></label>
      <label className="space-y-1 md:col-span-2"><span className="text-xs text-gray-500">신청 화면 안내(선택)</span><Input value={v.notice} onChange={(e) => set({ ...v, notice: e.target.value })} placeholder="예: 월 1회 무급" className="h-8" /></label>
      <div className="md:col-span-4 flex flex-wrap items-center gap-4 text-xs text-gray-700">
        <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={v.deducts} onChange={(e) => set({ ...v, deducts: e.target.checked })} />연차에서 차감</label>
        <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={v.selectable} onChange={(e) => set({ ...v, selectable: e.target.checked })} />신청 목록에 표시</label>
        <label className="flex items-center gap-1.5">순서 <Input type="number" value={v.sortOrder} onChange={(e) => set({ ...v, sortOrder: e.target.value })} className="h-7 w-16" /></label>
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}><X size={14} />취소</Button>
        <Button size="sm" onClick={onOk} disabled={busy || !v.label.trim()}><Check size={14} />{okLabel}</Button>
      </div>
    </div>
  );
}

export default function LeaveTypesPage() {
  const [groups, setGroups] = useState<string[]>([]);
  const [builtins, setBuiltins] = useState<Builtin[]>([]);
  const [customs, setCustoms] = useState<Custom[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(emptyDraft());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/leave-types", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "불러오지 못했습니다."); return; }
      setGroups(d.groups || []); setBuiltins(d.builtins || []); setCustoms(d.customs || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const call = async (method: string, body?: unknown, qs = "") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/leave-types${qs}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "실패했습니다.", { duration: 8000 }); return false; }
      resetLeaveCatalogCache();
      await load();
      return true;
    } finally { setBusy(false); }
  };
  const toPayload = (v: Draft) => ({ label: v.label.trim(), group: v.group, unit: v.unit, paidHours: Number(v.paidHours), deducts: v.deducts,
    attachRequired: v.attachRequired.trim() || null, notice: v.notice.trim() || null, selectable: v.selectable, sortOrder: Number(v.sortOrder) || 0 });
  const toggleHidden = async (code: string, hidden: boolean) => {
    const next = builtins.filter((b) => (b.code === code ? hidden : b.hidden)).map((b) => b.code);
    if (await call("PATCH", { hidden: next })) toast.success(hidden ? "신청 목록에서 숨겼습니다." : "다시 보이게 했습니다.");
  };

  if (loading && !builtins.length) return <div className="flex items-center justify-center h-96 text-gray-500">불러오는 중…</div>;


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">휴가 유형 관리</h1>
        <p className="text-sm text-gray-500 mt-1">기본 유형은 신청 목록에서 숨길 수만 있고, 새 유형은 아래에서 만듭니다. 만든 유형은 웹·앱 신청 화면, 결재, 잔여·리포트에 바로 반영됩니다(앱은 화면을 다시 열면).</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">본부가 만든 유형 <span className="text-sm font-normal text-gray-400">{customs.length}</span></CardTitle>
          {!adding && <Button size="sm" className="gap-1" onClick={() => { setDraft(emptyDraft()); setAdding(true); }}><Plus size={14} />유형 추가</Button>}
        </CardHeader>
        <CardContent className="space-y-3">
          {adding && <TypeForm groups={groups} busy={busy} v={draft} set={setDraft} okLabel="추가" onCancel={() => setAdding(false)} onOk={async () => { if (await call("POST", toPayload(draft))) { toast.success("추가했습니다."); setAdding(false); } }} />}
          {customs.length === 0 && !adding && <p className="text-sm text-gray-400">아직 만든 유형이 없습니다.</p>}
          <div className="divide-y rounded-lg border">
            {customs.map((c) => editId === c.id ? (
              <div key={c.id} className="p-2"><TypeForm groups={groups} busy={busy} v={edit} set={setEdit} okLabel="저장" onCancel={() => setEditId(null)} onOk={async () => { if (await call("PATCH", { id: c.id, ...toPayload(edit) })) { toast.success("저장했습니다."); setEditId(null); } }} /></div>
            ) : (
              <div key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="font-medium">{c.label}</span>
                <Badge variant="outline">{c.group}</Badge>
                <span className="text-xs text-gray-500">{UNIT_LABEL[c.unit] ?? c.unit} · 유급 {c.paidHours}h · {c.deducts ? "연차 차감" : "차감 없음"}{c.attachRequired ? ` · 첨부 ${c.attachRequired}` : ""}</span>
                {!c.selectable && <Badge variant="secondary" className="text-[11px]">숨김</Badge>}
                <span className="text-xs text-gray-400">사용 {c.used}건</span>
                <span className="flex-1" />
                <Button size="sm" variant="ghost" className="h-7" onClick={() => { setEditId(c.id); setEdit({ label: c.label, group: c.group, unit: c.unit, paidHours: String(c.paidHours), deducts: c.deducts, attachRequired: c.attachRequired ?? "", notice: c.notice ?? "", selectable: c.selectable, sortOrder: String(c.sortOrder) }); }}><Pencil size={13} /></Button>
                <Button size="sm" variant="ghost" className="h-7 text-red-600" disabled={busy || c.used > 0} title={c.used > 0 ? "신청 기록이 있어 지울 수 없습니다 — 수정에서 「신청 목록에 표시」를 끄세요" : "삭제"}
                  onClick={async () => { if (confirm(`「${c.label}」 유형을 지울까요?`) && await call("DELETE", undefined, `?id=${c.id}`)) toast.success("지웠습니다."); }}><Trash2 size={13} /></Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">기본 유형 <span className="text-sm font-normal text-gray-400">(시프티 기준표 — 숨김만 가능)</span></CardTitle></CardHeader>
        <CardContent>
          <div className="divide-y rounded-lg border">
            {groups.map((g) => {
              const list = builtins.filter((b) => b.group === g);
              if (!list.length) return null;
              return (
                <div key={g} className="px-3 py-2">
                  <p className="text-xs font-semibold text-gray-500 mb-1">{g}</p>
                  <div className="space-y-1">
                    {list.map((b) => (
                      <div key={b.code} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className={b.hidden || !b.selectableDefault ? "text-gray-400" : ""}>{b.label}</span>
                        <span className="text-xs text-gray-400">{UNIT_LABEL[b.unit] ?? b.unit} · 유급 {b.paidHours}h · {b.deducts ? "연차 차감" : "차감 없음"} · 사용 {b.used}건</span>
                        {!b.selectableDefault && <Badge variant="secondary" className="text-[11px]">옛 유형(기록만)</Badge>}
                        <span className="flex-1" />
                        {b.selectableDefault && (
                          <label className={`flex items-center gap-1.5 text-xs cursor-pointer ${b.code === "ANNUAL" ? "text-gray-300" : "text-gray-600"}`}>
                            <input type="checkbox" checked={b.hidden} disabled={busy || b.code === "ANNUAL"} onChange={(e) => toggleHidden(b.code, e.target.checked)} />신청 목록에서 숨김
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
