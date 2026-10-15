"use client";

// 결재 규칙 편집(2026-10-15 QA76 #16, 희망화면 4) — 위: 요청 종류별 규칙 표, 가운데: 예외 결재선(직원·지점별).
// 바꾼 뒤 [변경 저장]을 눌러야 적용된다. 저장 뒤 신청부터 새 결재선, 이미 대기 중인 건은 그대로(디렉터 결정 10/15).
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Lock, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  STEP_LABEL, STEP_HINT, EXCEPTION_ALLOWED, EXCEPTION_KIND_LABEL, MAX_STEPS, MAX_EXCEPTIONS,
  validateRow, validateException, duplicateExceptionError, describeSteps,
  type ApprovalRules, type RuleRow, type RuleStep, type RuleException, type StepType, type ExceptionKind,
} from "@/lib/approval-rules-core";

type Person = { id: string; name: string; role: string; branch: string | null };
const ROLE_KO: Record<string, string> = { ADMIN: "본부", MANAGER: "원장", EMPLOYEE: "직원" };
const sameSteps = (a: RuleStep[], b: RuleStep[]) => a.length === b.length && a.every((s, i) => s.type === b[i].type && (s.userId ?? "") === (b[i].userId ?? ""));
const newId = () => `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export default function ApprovalRulesEditor() {
  const [loading, setLoading] = useState(true);
  const [rowsDef, setRowsDef] = useState<RuleRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [saved, setSaved] = useState<ApprovalRules | null>(null);
  const [rows, setRows] = useState<Record<string, RuleStep[]>>({});
  const [exceptions, setExceptions] = useState<RuleException[]>([]);
  const [editing, setEditing] = useState<string | null>(null);   // 규칙 줄 key
  const [exDraft, setExDraft] = useState<RuleException | null>(null);
  const [exEditingId, setExEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((rules: ApprovalRules, defs: RuleRow[]) => {
    setSaved(rules);
    setRows(Object.fromEntries(defs.map((r) => [r.key, rules.rows[r.key] ?? r.def])));
    setExceptions(rules.exceptions);
    setEditing(null); setExDraft(null); setExEditingId(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/approval-rules");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "결재 규칙을 불러오지 못했습니다."); return; }
      setRowsDef(d.rows); setPeople(d.people); setBranches(d.branches);
      apply(d.rules, d.rows);
    } catch { toast.error("서버에 연결하지 못했습니다."); }
    finally { setLoading(false); }
  }, [apply]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const nameOf = useCallback((id: string) => { const p = byId.get(id); return p ? `${p.name}(${ROLE_KO[p.role] ?? p.role})` : undefined; }, [byId]);
  const approvers = useMemo(() => people.filter((p) => p.role === "ADMIN" || p.role === "MANAGER"), [people]);

  const rowErrors = useMemo(() => Object.fromEntries(rowsDef.map((r) => [r.key, r.locked ? null : validateRow(r.key, rows[r.key] ?? r.def)])), [rowsDef, rows]);
  const dirtyCount = useMemo(() => {
    if (!saved) return 0;
    let n = 0;
    for (const r of rowsDef) if (!r.locked && !sameSteps(rows[r.key] ?? r.def, saved.rows[r.key] ?? r.def)) n++;
    if (JSON.stringify(exceptions) !== JSON.stringify(saved.exceptions)) n++;
    return n;
  }, [saved, rowsDef, rows, exceptions]);

  const save = async () => {
    if (!saved) return;
    const firstErr = Object.values(rowErrors).find(Boolean) || exceptions.map(validateException).find(Boolean) || duplicateExceptionError(exceptions);
    if (firstErr) { toast.error(firstErr); return; }
    if (exDraft) { toast.error("작성 중인 예외를 먼저 [적용]하거나 [취소]하세요."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/approval-rules", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rev: saved.rev, rows, exceptions }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409) { toast.error(d.error); await load(); return; }
      if (!res.ok) { toast.error(d.error || "저장하지 못했습니다."); return; }
      apply(d.rules, rowsDef);
      toast.success(d.changed ? "결재 규칙을 저장했습니다. 지금부터 들어오는 신청에 적용됩니다." : "바뀐 것이 없습니다.");
    } catch { toast.error("서버에 연결하지 못했습니다."); }
    finally { setBusy(false); }
  };

  if (loading) return <p className="text-sm text-gray-400">불러오는 중…</p>;

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white/95 px-4 py-2 backdrop-blur">
        <p className="text-xs text-gray-600">
          규칙을 바꾸면 <b>저장한 뒤 들어오는 신청</b>부터 새 결재선으로 갑니다. 이미 결재 대기 중인 건은 신청할 때의 결재선 그대로입니다.
        </p>
        <div className="flex items-center gap-2">
          {dirtyCount > 0 && <span className="text-xs text-amber-700">저장 안 한 변경 {dirtyCount}곳</span>}
          <Button size="sm" variant="outline" disabled={busy || dirtyCount === 0} onClick={() => saved && apply(saved, rowsDef)}>되돌리기</Button>
          <Button size="sm" disabled={busy || dirtyCount === 0} onClick={save}>{busy ? "저장 중…" : "변경 저장"}</Button>
        </div>
      </div>

      {/* ── 규칙 표 ── */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">요청 종류별 결재선</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-3 py-2 font-medium">요청 종류</th>
                  <th className="px-3 py-2 font-medium">대상</th>
                  <th className="px-3 py-2 font-medium">조건</th>
                  <th className="px-3 py-2 font-medium">결재선</th>
                  <th className="px-3 py-2 font-medium w-32"></th>
                </tr>
              </thead>
              <tbody>
                {rowsDef.map((r) => {
                  const steps = rows[r.key] ?? r.def;
                  const changedFromDefault = !sameSteps(steps, r.def);
                  const open = editing === r.key;
                  return (
                    <RuleRowView key={r.key} r={r} steps={steps} open={open} err={rowErrors[r.key] ?? null}
                      changedFromDefault={changedFromDefault} nameOf={nameOf} approvers={approvers}
                      onToggle={() => setEditing(open ? null : r.key)}
                      onReset={() => setRows((m) => ({ ...m, [r.key]: r.def.map((s) => ({ ...s })) }))}
                      onChange={(next) => setRows((m) => ({ ...m, [r.key]: next }))} />
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="space-y-0.5 border-t px-4 py-3 text-[11px] text-gray-500">
            {(["BRANCH_MANAGER", "HQ", "USER", "PEER_MANAGER"] as StepType[]).map((t) => <li key={t}>· <b>{STEP_LABEL[t]}</b> — {STEP_HINT[t]}</li>)}
            <li>· 관리자(본부) 본인의 신청은 표와 관계없이 다른 관리자 1명이 결재합니다. 원장 신청에는 본부 결재가 꼭 들어갑니다.</li>
          </ul>
        </CardContent>
      </Card>

      {/* ── 예외 결재선 ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">예외 결재선 <span className="text-xs font-normal text-gray-400">(직원·지점별 — 위 표보다 먼저 적용, 직원 예외 &gt; 지점 예외)</span></CardTitle>
            <Button size="sm" variant="outline" className="gap-1" disabled={!!exDraft || exceptions.length >= MAX_EXCEPTIONS}
              onClick={() => { setExEditingId(null); setExDraft({ id: newId(), targetType: "BRANCH", kinds: ["LEAVE"], steps: [{ type: "HQ" }] }); }}>
              <Plus size={13} />예외 추가
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {exceptions.length === 0 && !exDraft && <p className="text-sm text-gray-400">예외가 없습니다. 모든 신청이 위 표대로 갑니다.</p>}
          {exceptions.length > 0 && (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-gray-500"><th className="py-1.5 font-medium">대상</th><th className="py-1.5 font-medium">적용</th><th className="py-1.5 font-medium">결재선</th><th className="py-1.5 font-medium">메모</th><th className="w-20"></th></tr></thead>
              <tbody>
                {exceptions.map((x) => (
                  <tr key={x.id} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-2">{x.targetType === "USER"
                      ? (byId.get(x.userId!) ? <>{byId.get(x.userId!)!.name} <span className="text-xs text-gray-400">{byId.get(x.userId!)!.branch ?? ""}</span></> : <span className="text-red-600">(없는 직원 — 지우세요)</span>)
                      : branches.includes(x.branch!) ? <>{x.branch} <span className="text-xs text-gray-400">지점 직원 전체</span></> : <span className="text-red-600">{x.branch} (닫힌 지점 — 지우세요)</span>}</td>
                    <td className="py-2 pr-2 text-gray-600">{x.kinds.map((k) => EXCEPTION_KIND_LABEL[k]).join(", ")}</td>
                    <td className="py-2 pr-2 font-medium text-gray-800">{describeSteps(x.steps, nameOf)}</td>
                    <td className="py-2 pr-2 text-xs text-gray-500">{x.note ?? ""}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button type="button" className="p-1 text-gray-500 hover:text-indigo-600" title="수정" disabled={!!exDraft}
                        onClick={() => { setExEditingId(x.id); setExDraft(JSON.parse(JSON.stringify(x))); }}><Pencil size={14} /></button>
                      <button type="button" className="p-1 text-gray-400 hover:text-red-600" title="삭제" disabled={!!exDraft}
                        onClick={() => setExceptions((l) => l.filter((y) => y.id !== x.id))}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {exDraft && (
            <ExceptionForm draft={exDraft} people={people} branches={branches} approvers={approvers} nameOf={nameOf}
              existing={exceptions.filter((y) => y.id !== exEditingId)}
              onChange={setExDraft}
              onCancel={() => { setExDraft(null); setExEditingId(null); }}
              onApply={(x) => {
                setExceptions((l) => (exEditingId ? l.map((y) => (y.id === exEditingId ? x : y)) : [...l, x]));
                setExDraft(null); setExEditingId(null);
              }} />
          )}
          <p className="text-[11px] text-gray-500">
            예외는 휴가(취소 포함)·근무일정 신청에 씁니다. 출퇴근 요청은 위 표만 따릅니다. 지점 예외는 그 지점 직원에게만 걸리고, 원장은 「한 명」 예외로 둡니다(원장 신청에는 본부 결재가 자동으로 붙습니다).
            예) 본부 지점 직원 전체 → 직영사업본부장 1단계, 특정 지점 → 지정 원장 → 본부.
            겸직 원장은 직원관리 「겸직 지점」만 넣으면 그 지점들의 원장 결재를 함께 합니다(예외 불필요).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StepChips({ steps, nameOf }: { steps: RuleStep[]; nameOf: (id: string) => string | undefined }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {steps.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-gray-300">→</span>}
          <span className={`rounded px-1.5 py-0.5 text-xs ${s.type === "HQ" ? "bg-indigo-50 text-indigo-700" : s.type === "USER" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
            <span className="text-[10px] text-gray-400 mr-0.5">{i + 1}차</span>
            {s.type === "USER" ? (s.userId && nameOf(s.userId)) || "(사람 고르기)" : s.type === "HQ" ? "본부" : STEP_LABEL[s.type]}
          </span>
        </span>
      ))}
    </span>
  );
}

function RuleRowView({ r, steps, open, err, changedFromDefault, nameOf, approvers, onToggle, onReset, onChange }: {
  r: RuleRow; steps: RuleStep[]; open: boolean; err: string | null; changedFromDefault: boolean;
  nameOf: (id: string) => string | undefined; approvers: Person[];
  onToggle: () => void; onReset: () => void; onChange: (s: RuleStep[]) => void;
}) {
  return (
    <>
      <tr className={`border-b align-top ${open ? "bg-indigo-50/40" : ""}`}>
        <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{r.label}</td>
        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.targetLabel}</td>
        <td className="px-3 py-2 text-xs text-gray-500">{r.condition}</td>
        <td className="px-3 py-2">
          <StepChips steps={steps} nameOf={nameOf} />
          {changedFromDefault && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">기본값과 다름</span>}
          {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {r.locked ? (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400" title={r.locked}><Lock size={12} />고정</span>
          ) : (
            <>
              {changedFromDefault && <button type="button" onClick={onReset} className="mr-1 inline-flex items-center gap-0.5 text-xs text-gray-500 hover:text-gray-800" title="기본값으로"><RotateCcw size={12} />기본</button>}
              <button type="button" onClick={onToggle} className="inline-flex items-center gap-0.5 rounded border px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-50">{open ? "닫기" : <><Pencil size={11} />수정</>}</button>
            </>
          )}
        </td>
      </tr>
      {r.locked && <tr className="border-b"><td colSpan={5} className="px-3 pb-2 pt-0 text-[11px] text-gray-400">{r.locked}</td></tr>}
      {open && !r.locked && (
        <tr className="border-b bg-indigo-50/40">
          <td colSpan={5} className="px-3 pb-3">
            <StepsEditor steps={steps} allowed={r.allowed} max={r.maxSteps} approvers={approvers} onChange={onChange} />
            <p className="mt-1 text-[11px] text-gray-500">기본값: {describeSteps(r.def, nameOf)}{r.maxSteps === 1 ? " · 출퇴근 요청은 한 단계만 둘 수 있습니다." : ""}</p>
          </td>
        </tr>
      )}
    </>
  );
}

function StepsEditor({ steps, allowed, max, approvers, onChange }: {
  steps: RuleStep[]; allowed: StepType[]; max: number; approvers: Person[]; onChange: (s: RuleStep[]) => void;
}) {
  const set = (i: number, s: RuleStep) => onChange(steps.map((x, k) => (k === i ? s : x)));
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= steps.length) return; const n = [...steps]; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <div className="mt-2 space-y-1.5">
      {steps.map((s, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded border bg-white px-2 py-1.5">
          <span className="w-10 text-xs font-semibold text-indigo-500">{i + 1}차</span>
          <select value={s.type} onChange={(e) => { const t = e.target.value as StepType; set(i, t === "USER" ? { type: t, userId: approvers[0]?.id } : { type: t }); }}
            className="rounded border bg-white px-2 py-1 text-sm">
            {allowed.map((t) => <option key={t} value={t}>{STEP_LABEL[t]}</option>)}
          </select>
          {s.type === "USER" && (
            <select value={s.userId ?? ""} onChange={(e) => set(i, { type: "USER", userId: e.target.value })} className="min-w-48 rounded border bg-white px-2 py-1 text-sm">
              {!s.userId && <option value="">사람 고르기</option>}
              {approvers.map((p) => <option key={p.id} value={p.id}>{p.name} · {ROLE_KO[p.role]}{p.branch ? ` · ${p.branch}` : ""}</option>)}
            </select>
          )}
          <span className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-500 disabled:text-gray-200" title="위로"><ArrowUp size={14} /></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="text-gray-500 disabled:text-gray-200" title="아래로"><ArrowDown size={14} /></button>
            <button type="button" onClick={() => onChange(steps.filter((_, k) => k !== i))} disabled={steps.length <= 1} className="text-gray-400 hover:text-red-500 disabled:text-gray-200" title="빼기"><X size={14} /></button>
          </span>
        </div>
      ))}
      {steps.length < max && (
        <button type="button" onClick={() => onChange([...steps, { type: allowed.includes("HQ") ? "HQ" : allowed[0] }])}
          className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"><Plus size={12} />단계 추가</button>
      )}
    </div>
  );
}

function ExceptionForm({ draft, people, branches, approvers, nameOf, existing, onChange, onCancel, onApply }: {
  draft: RuleException; people: Person[]; branches: string[]; approvers: Person[]; nameOf: (id: string) => string | undefined;
  existing: RuleException[]; onChange: (x: RuleException) => void; onCancel: () => void; onApply: (x: RuleException) => void;
}) {
  const [q, setQ] = useState("");
  const targets = useMemo(() => people.filter((p) => p.role !== "ADMIN" && (!q.trim() || p.name.includes(q.trim()) || (p.branch ?? "").includes(q.trim()))), [people, q]);
  const err = validateException(draft) ?? duplicateExceptionError([...existing, draft]);
  const toggleKind = (k: ExceptionKind) => onChange({ ...draft, kinds: draft.kinds.includes(k) ? draft.kinds.filter((x) => x !== k) : [...draft.kinds, k] });
  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-xs font-semibold text-gray-600">대상</span>
        {(["BRANCH", "USER"] as const).map((t) => (
          <label key={t} className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={draft.targetType === t} onChange={() => onChange({ ...draft, targetType: t, userId: undefined, branch: undefined })} />
            {t === "BRANCH" ? "지점 직원 전체(원장 제외)" : "한 명(직원·원장)"}
          </label>
        ))}
      </div>
      {draft.targetType === "BRANCH" ? (
        <select value={draft.branch ?? ""} onChange={(e) => onChange({ ...draft, branch: e.target.value || undefined })} className="rounded border bg-white px-2 py-1 text-sm">
          <option value="">지점 고르기</option>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·지점으로 찾기" className="h-8 w-40 rounded border px-2 text-sm" />
          <select value={draft.userId ?? ""} onChange={(e) => onChange({ ...draft, userId: e.target.value || undefined })} className="min-w-56 rounded border bg-white px-2 py-1 text-sm">
            <option value="">직원 고르기 ({targets.length}명)</option>
            {draft.userId && !targets.some((p) => p.id === draft.userId) && <option value={draft.userId}>{nameOf(draft.userId) ?? "(선택됨)"}</option>}
            {targets.map((p) => <option key={p.id} value={p.id}>{p.name} · {ROLE_KO[p.role]}{p.branch ? ` · ${p.branch}` : ""}</option>)}
          </select>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-xs font-semibold text-gray-600">적용</span>
        {(["LEAVE", "SCHEDULE"] as ExceptionKind[]).map((k) => (
          <label key={k} className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={draft.kinds.includes(k)} onChange={() => toggleKind(k)} />{EXCEPTION_KIND_LABEL[k]}</label>
        ))}
      </div>
      <div>
        <span className="text-xs font-semibold text-gray-600">결재선</span>
        <StepsEditor steps={draft.steps} allowed={EXCEPTION_ALLOWED} max={MAX_STEPS} approvers={approvers} onChange={(steps) => onChange({ ...draft, steps })} />
      </div>
      <input value={draft.note ?? ""} onChange={(e) => onChange({ ...draft, note: e.target.value.slice(0, 100) || undefined })} placeholder="메모(선택) — 예: 본부 직원은 본부장 결재로 끝" className="h-8 w-full rounded border px-2 text-sm" />
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>취소</Button>
        <Button size="sm" disabled={!!err} onClick={() => onApply(draft)}>적용</Button>
      </div>
      <p className="text-[11px] text-gray-500">[적용] 뒤 위쪽 [변경 저장]을 눌러야 실제로 저장됩니다.</p>
    </div>
  );
}
