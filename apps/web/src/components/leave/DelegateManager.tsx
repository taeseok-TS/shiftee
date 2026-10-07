"use client";

// 원장대행 지정 화면(본부 전용, 2026-10-07 본부 답변 #3) — 관리자 휴가 화면 「결재라인 설정」 탭 안에 들어간다.
// 기간 안에는 그 지점의 원장 결재(휴가·근무일정·휴가 취소)를 대행자가 원장과 똑같이 처리한다. 계약서 서명은 제외.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type Delegate = {
  id: string; branch: string; delegateId: string; delegateName: string; delegateBranch: string | null;
  delegateRole: string | null; startDate: string; endDate: string; note: string | null;
  createdByName: string | null; revokedAt: string | null; revokedByName: string | null;
  state: "ACTIVE" | "UPCOMING" | "ENDED" | "REVOKED";
};
type Emp = { id: string; name: string; branch: string | null; role?: string; position?: string | null };

const STATE_LABEL: Record<Delegate["state"], { text: string; cls: string }> = {
  ACTIVE: { text: "대행 중", cls: "bg-green-100 text-green-700" },
  UPCOMING: { text: "예정", cls: "bg-blue-100 text-blue-700" },
  ENDED: { text: "끝남", cls: "bg-gray-100 text-gray-500" },
  REVOKED: { text: "해제됨", cls: "bg-gray-100 text-gray-400 line-through" },
};
const ROLE_LABEL: Record<string, string> = { MANAGER: "원장", EMPLOYEE: "직원" };
const today = () => {
  const k = new Date(Date.now() + 9 * 3600_000);
  return k.toISOString().slice(0, 10);
};

export default function DelegateManager() {
  const [rows, setRows] = useState<Delegate[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [form, setForm] = useState({ branch: "", delegateId: "", startDate: today(), endDate: today(), note: "" });
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");

  const fetchRows = () =>
    fetch("/api/approval-delegates").then((x) => (x.ok ? x.json() : { delegates: [] })).catch(() => ({ delegates: [] }));
  const load = useCallback(async () => {
    const r = await fetchRows();
    setRows(r.delegates || []);
  }, []);

  useEffect(() => {
    fetchRows().then((r) => setRows(r.delegates || []));
    fetch("/api/branches").then((x) => (x.ok ? x.json() : null)).then((d) => {
      const list = (d?.branches || []) as { name: string; isActive?: boolean }[];
      setBranches(list.filter((b) => b.isActive !== false).map((b) => b.name).sort());
    }).catch(() => {});
    fetch("/api/employees").then((x) => (x.ok ? x.json() : null)).then((d) => {
      setEmps(((d?.employees || []) as Emp[]).filter((e) => e.role !== "ADMIN"));
    }).catch(() => {});
  }, []);

  const candidates = useMemo(() => {
    const s = q.trim();
    const list = s ? emps.filter((e) => e.name.includes(s) || (e.branch || "").includes(s)) : emps;
    return [...list].sort((a, b) => (a.branch || "").localeCompare(b.branch || "") || a.name.localeCompare(b.name)).slice(0, 200);
  }, [emps, q]);

  const selected = emps.find((e) => e.id === form.delegateId);

  const submit = async () => {
    if (!form.branch || !form.delegateId) { toast.error("지점과 대행자를 골라 주세요."); return; }
    if (!form.startDate || !form.endDate) { toast.error("기간을 입력해 주세요."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/approval-delegates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, note: form.note.trim() || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "지정하지 못했습니다."); return; }
      toast.success("원장대행을 지정했습니다. 대행자에게 봇 메시지로 알렸습니다.");
      setForm((f) => ({ ...f, delegateId: "", note: "" }));
      load();
    } finally { setSaving(false); }
  };

  const revoke = async (r: Delegate) => {
    if (!window.confirm(`${r.branch} · ${r.delegateName} 원장대행을 해제할까요? 해제하면 바로 결재 권한이 없어집니다.`)) return;
    const res = await fetch(`/api/approval-delegates?id=${encodeURIComponent(r.id)}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "해제하지 못했습니다."); return; }
    toast.success("해제했습니다.");
    load();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-gray-600 font-medium">
          원장대행 — 지정한 기간 동안 그 지점의 <b>원장 결재</b>(휴가·근무일정·휴가 취소)를 대신합니다. 계약서 서명은 대행하지 않습니다.
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
          <div>
            <Label className="text-xs">지점</Label>
            <Select value={form.branch} onValueChange={(v) => setForm((f) => ({ ...f, branch: v ?? "" }))}>
              <SelectTrigger><SelectValue placeholder="지점 선택">{form.branch || "지점 선택"}</SelectValue></SelectTrigger>
              <SelectContent>{branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="lg:col-span-2">
            <Label className="text-xs">대행자</Label>
            <div className="flex gap-2">
              <Input className="w-28" placeholder="이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
              <Select value={form.delegateId} onValueChange={(v) => setForm((f) => ({ ...f, delegateId: v ?? "" }))}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="대행자 선택">
                    {selected ? `${selected.name}${selected.branch ? ` (${selected.branch})` : ""}` : "대행자 선택"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}{e.branch ? ` (${e.branch})` : ""}{e.role ? ` · ${ROLE_LABEL[e.role] ?? e.role}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">시작일</Label>
            <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">종료일</Label>
            <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </div>
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Label className="text-xs">메모 (선택)</Label>
            <Input value={form.note} maxLength={200} placeholder="예: 원장 휴가 기간" onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </div>
          <Button onClick={submit} disabled={saving}>{saving ? "지정 중…" : "원장대행 지정"}</Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 font-medium">상태</th>
                <th className="py-2 font-medium">지점</th>
                <th className="py-2 font-medium">대행자</th>
                <th className="py-2 font-medium">기간</th>
                <th className="py-2 font-medium">메모</th>
                <th className="py-2 font-medium">지정</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="py-6 text-center text-gray-400">지정된 원장대행이 없습니다.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs ${STATE_LABEL[r.state].cls}`}>{STATE_LABEL[r.state].text}</span></td>
                  <td className="py-2">{r.branch}</td>
                  <td className="py-2">{r.delegateName}<span className="text-xs text-gray-400">{r.delegateBranch ? ` (${r.delegateBranch})` : ""}</span></td>
                  <td className="py-2 whitespace-nowrap">{r.startDate} ~ {r.endDate}</td>
                  <td className="py-2 text-gray-500">{r.note || "-"}</td>
                  <td className="py-2 text-xs text-gray-400">{r.createdByName || "-"}{r.revokedByName ? ` · 해제 ${r.revokedByName}` : ""}</td>
                  <td className="py-2 text-right">
                    {(r.state === "ACTIVE" || r.state === "UPCOMING") && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-red-600" onClick={() => revoke(r)}>해제</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
