"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Power } from "lucide-react";
import { toast } from "sonner";

/**
 * 근무일정 템플릿 관리(2026-10-07 QA #10, 본부 답변 #16) — 본부만.
 * 시프티 템플릿 34개로 시작. 지점이 비면 전사 공통, 있으면 그 지점 전용.
 * 직원 근무일정 신청·원장/관리자 일정 등록·일괄 생성이 이 목록을 쓴다.
 */
type Tpl = { id: string; code: string | null; name: string; startTime: string; endTime: string; branches: string[]; jobs: string[]; color: string | null; memo: string | null; isActive: boolean };
type Form = { id?: string; code: string; name: string; startTime: string; endTime: string; branches: string[]; jobs: string; color: string; memo: string };
const EMPTY: Form = { code: "", name: "", startTime: "09:00", endTime: "18:00", branches: [], jobs: "", color: "#3498DB", memo: "" };

const span = (t: { startTime: string; endTime: string }) => {
  const [sh, sm] = t.startTime.split(":").map(Number), [eh, em] = t.endTime.split(":").map(Number);
  const m = eh * 60 + em - (sh * 60 + sm);
  return m > 0 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}` : "-";
};

export default function ScheduleTemplatesPage() {
  const [rows, setRows] = useState<Tpl[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [showOff, setShowOff] = useState(false);

  const fetchRows = () => fetch("/api/schedule-templates?all=1").then((r) => (r.ok ? r.json() : { templates: [] })).catch(() => ({ templates: [] }));
  const load = useCallback(async () => setRows((await fetchRows()).templates || []), []);
  useEffect(() => {
    fetchRows().then((d) => setRows(d.templates || []));
    fetch("/api/branches").then((r) => (r.ok ? r.json() : null)).then((d) => {
      setBranches(((d?.branches || []) as { name: string; isActive?: boolean }[]).filter((b) => b.isActive !== false).map((b) => b.name).sort());
    }).catch(() => {});
  }, []);

  const shown = useMemo(() => {
    const s = q.trim();
    return rows.filter((t) => (showOff || t.isActive) && (!s || t.name.includes(s) || (t.code ?? "").includes(s) || t.branches.some((b) => b.includes(s))));
  }, [rows, q, showOff]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const body = { code: form.code, name: form.name, startTime: form.startTime, endTime: form.endTime, branches: form.branches, jobs: form.jobs.split(",").map((s) => s.trim()).filter(Boolean), color: form.color, memo: form.memo };
      const res = await fetch(form.id ? `/api/schedule-templates/${form.id}` : "/api/schedule-templates", {
        method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "저장하지 못했습니다."); return; }
      toast.success(form.id ? "고쳤습니다." : "추가했습니다.");
      setForm(null);
      load();
    } finally { setSaving(false); }
  };

  const toggle = async (t: Tpl) => {
    const res = await fetch(`/api/schedule-templates/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !t.isActive }) });
    if (!res.ok) { toast.error("바꾸지 못했습니다."); return; }
    toast.success(t.isActive ? "껐습니다. 신청·등록 화면에서 더 이상 보이지 않습니다." : "켰습니다.");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-gray-900 mr-2">근무일정 템플릿</h1>
        <Input className="w-56" placeholder="이름·코드·지점 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="text-sm text-gray-600 flex items-center gap-1">
          <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />꺼진 것도 보기
        </label>
        <div className="flex-1" />
        <Button className="gap-1" onClick={() => setForm({ ...EMPTY })}><Plus size={14} />템플릿 추가</Button>
      </div>
      <p className="text-sm text-gray-500">지점을 비우면 전사 공통, 고르면 그 지점 전용입니다. 직원 근무일정 신청·일정 등록·일괄 생성에서 이 목록을 고릅니다. 지우지 않고 끕니다(이미 만든 일정은 그대로).</p>

      <Card><CardContent className="pt-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="text-left text-gray-500 border-b">
            <tr><th className="py-2">템플릿</th><th>시간</th><th>근무</th><th>지점</th><th>직무</th><th>메모</th><th className="text-right">관리</th></tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-gray-400">템플릿이 없습니다.</td></tr>
            ) : shown.map((t) => (
              <tr key={t.id} className={`border-b last:border-0 ${t.isActive ? "" : "opacity-50"}`}>
                <td className="py-2">
                  <span className="inline-block w-3 h-3 rounded-sm mr-2 align-middle" style={{ background: t.color ?? "#9ca3af" }} />
                  <span className="font-medium">{t.name}</span>
                  {t.code && t.code !== t.name && <span className="text-xs text-gray-400 ml-1">({t.code})</span>}
                  {!t.isActive && <span className="text-xs text-gray-400 ml-1">— 꺼짐</span>}
                </td>
                <td>{t.startTime} ~ {t.endTime}</td>
                <td className="text-gray-500">{span(t)}</td>
                <td>{t.branches.length ? t.branches.join(", ") : <span className="text-blue-600">전사 공통</span>}</td>
                <td className="text-gray-500">{t.jobs.join(", ") || "-"}</td>
                <td className="text-gray-500">{t.memo || "-"}</td>
                <td className="text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setForm({ id: t.id, code: t.code ?? "", name: t.name, startTime: t.startTime, endTime: t.endTime, branches: t.branches, jobs: t.jobs.join(", "), color: t.color ?? "#3498DB", memo: t.memo ?? "" })}>
                    <Pencil size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-gray-500" title={t.isActive ? "끄기" : "켜기"} onClick={() => toggle(t)}>
                    <Power size={13} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>

      <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{form?.id ? "템플릿 고치기" : "템플릿 추가"}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1"><span className="text-xs text-gray-500">이름 (필수)</span><Input value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <label className="space-y-1"><span className="text-xs text-gray-500">코드</span><Input value={form.code} maxLength={40} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
                <label className="space-y-1"><span className="text-xs text-gray-500">시작</span><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></label>
                <label className="space-y-1"><span className="text-xs text-gray-500">종료</span><Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></label>
              </div>
              <div>
                <span className="text-xs text-gray-500">지점 (비우면 전사 공통)</span>
                <div className="mt-1 flex flex-wrap gap-1 max-h-32 overflow-auto border rounded p-2">
                  {branches.map((b) => (
                    <label key={b} className={`px-2 py-0.5 rounded border cursor-pointer text-xs ${form.branches.includes(b) ? "bg-blue-50 border-blue-300 text-blue-700" : "text-gray-600"}`}>
                      <input type="checkbox" className="hidden" checked={form.branches.includes(b)}
                        onChange={() => setForm({ ...form, branches: form.branches.includes(b) ? form.branches.filter((x) => x !== b) : [...form.branches, b] })} />
                      {b}
                    </label>
                  ))}
                </div>
              </div>
              <label className="block space-y-1"><span className="text-xs text-gray-500">직무 (쉼표로 구분, 참고용)</span><Input value={form.jobs} onChange={(e) => setForm({ ...form, jobs: e.target.value })} placeholder="예: 매니저, 코디" /></label>
              <div className="grid grid-cols-[auto_1fr] gap-2 items-end">
                <label className="space-y-1"><span className="text-xs text-gray-500">색</span><input type="color" className="h-9 w-14 border rounded" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></label>
                <label className="space-y-1"><span className="text-xs text-gray-500">메모</span><Input value={form.memo} maxLength={200} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></label>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setForm(null)}>닫기</Button>
                <Button disabled={saving} onClick={save}>{saving ? "저장 중…" : "저장"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
