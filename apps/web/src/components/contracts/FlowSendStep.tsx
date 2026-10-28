"use client";

// 계약서 보내기 3단계 — 결재자·발송(2026-10-20 본부 박정인 시안 v2 1·4번).
// 2단계에서 만든 초안을 받아 결재선을 정하고 한 번에 보낸다. 결재선 규칙·발송은 「선택한 초안 한꺼번에 발송」과 같은
// bulk-send-core 하나다(양식 순서대로: 본부 = 고른 한 명, 원장 = 지점 메인 원장 자동, 근로자 = 당사자).
// 「이전」으로 내용 입력에 돌아가면 방금 만든 초안을 지운다(같은 사람에게 초안이 두 벌 생기지 않게).
// 결재 순서는 카드를 끌어 바꾼다(시안 v2 4번) — 「이 계약만」(이번 발송에만) 또는 「양식 기본으로 저장」(양식의 순서를 고친 뒤 보낸다).
// 양식 순서가 고정이면 서버가 발송 때 양식 순서와 같은지 보므로 「이 계약만」은 못 고른다.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Eye, GripVertical, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { KIND_LABEL, stepsLabel, validateSteps, type ApprovalStepSpec, type StepKind } from "@/lib/approval-order";
import {
  approverIdsOf, employeeOnlySingle, isMultiHq, mgrOf, needsHq, planUnits, repOf, sendResultText, sendUnits, unitSpecs,
  type SendContract, type SendEmployee,
} from "@/components/contracts/bulk-send-core";

const sameSteps = (a: ApprovalStepSpec[], b: ApprovalStepSpec[]) => a.length === b.length && a.every((s, i) => s.kind === b[i].kind);

const LAST_HQ_KEY = "contractSend.lastHq";   // 최근 고른 본부 담당자 — 이 브라우저의 편의값(없어도 동작)
const readLastHq = () => { try { return localStorage.getItem(LAST_HQ_KEY) || ""; } catch { return ""; } };
const writeLastHq = (v: string) => { try { localStorage.setItem(LAST_HQ_KEY, v); } catch { /* 저장 못 해도 이번 발송은 된다 */ } };

type Row = SendContract & { extraFields?: Record<string, string> | null; salary?: string | null; createdAt?: string };

export default function FlowSendStep({ ids, employees, mainManagerIds, title, stepper, deleteDrafts, onBack, onDone }: {
  ids: string[];
  employees: SendEmployee[];
  mainManagerIds?: Record<string, string>;   // 지점 → 메인 원장 id(단건 발송 창과 같은 원장 고르기)
  deleteDrafts: (ids: string[]) => Promise<boolean>;
  title: string;                 // 보낼 내용 이름(양식·묶음)
  stepper: ReactNode;
  onBack: () => void;            // 초안을 지운 뒤 2단계로
  onDone: () => void;            // 다 보냈을 때
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  // 최근 고른 본부 담당자를 미리 넣는다(지금 목록에 있는 계약 승인 관리자일 때만)
  const [hq, setHq] = useState(() => {
    const last = readLastHq();
    return last && employees.some((e) => e.id === last && e.role === "ADMIN" && e.isContractApprover !== false) ? last : "";
  });
  const [msg, setMsg] = useState("");
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);

  const idsKey = ids.join(",");
  useEffect(() => {
    let alive = true;
    // 넘겨받은 초안이 없으면 아예 묻지 않는다(빈 ids 로 다른 초안이 딸려 오지 않게 — 검증 F3, 서버도 빈 결과)
    if (!idsKey) { Promise.resolve().then(() => { if (alive) setRows([]); }); return () => { alive = false; }; }
    fetch(`/api/contracts?ids=${encodeURIComponent(idsKey)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!alive) return; if (!d) { setFailed(true); return; } setRows((d.contracts || []).filter((c: Row) => c.status === "DRAFT" || c.status === "REJECTED")); })
      .catch(() => { if (alive) setFailed(true); });
    fetch("/api/admin/contract-message").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.message) setMsg((m) => m || d.message); }).catch(() => {});
    return () => { alive = false; };
  }, [idsKey]);

  const admins = employees.filter((e) => e.role === "ADMIN" && e.isContractApprover !== false);

  const contracts = useMemo(() => rows ?? [], [rows]);
  const units = useMemo(() => planUnits(contracts), [contracts]);
  const multiHq = units.filter((u) => isMultiHq(u, contracts));
  const needHq = needsHq(units, contracts);
  const external = contracts.filter((c) => c.externalName);
  // 결재 순서 카드 — 첫 단위의 순서(같은 양식이면 모두 같다). 사람마다 다른 원장은 「자동」으로만 보인다
  // 가장 먼저 만든 사람부터(목록 API 는 최신순) — 첫 번째 사람 기준으로 카드·미리보기를 보인다
  const first = [...units].sort((a, b) => (a.c.createdAt || "").localeCompare(b.c.createdAt || ""))[0];
  const baseSpecs = useMemo(() => (first ? unitSpecs(first, contracts) : []), [first, contracts]);
  const people = [...new Set(units.map((u) => u.c.userId))];
  const docCount = contracts.length;

  // 순서 바꾸기 — 바꿀 대상은 직원전용 단독 문서가 아닌 단위들(그건 늘 근로자 한 단계). 그 단위들이 모두 같은 양식·같은 순서일 때만 바꿀 수 있다
  const orderUnits = units.filter((u) => !employeeOnlySingle(u));
  const reps = orderUnits.map((u) => repOf(u, contracts));
  const rep0 = reps[0];
  const tid = rep0?.templateId ?? null;
  const renewal = !!rep0?.approvalRenewal;
  const orderBase = orderUnits[0] ? unitSpecs(orderUnits[0], contracts) : baseSpecs;
  const orderEditable = orderUnits.length > 0 && orderUnits.every((u, i) => sameSteps(unitSpecs(u, contracts), orderBase) && reps[i].templateId === tid && !!reps[i].approvalRenewal === renewal && !reps[i].employeeOnly);   // 직원전용 대표(직원전용만 든 패키지)는 서버가 순서를 안 본다 — 그 양식을 고치지 않게(검증 P3)
  const hadOrder = !!rep0?.approvalSteps;   // 양식에 결재 순서가 지정돼 있었나(없으면 기본 본부→원장→근로자로 보이고 서버는 검사하지 않는다)
  const locked = hadOrder && rep0?.approvalLocked !== false;   // 양식 순서 고정 — 서버가 발송 때 본다
  const [custom, setCustom] = useState<ApprovalStepSpec[] | null>(null);    // null = 양식 기본 순서
  const [saveMode, setSaveMode] = useState<"contract" | "template">("contract");
  const [drag, setDrag] = useState<number | null>(null);
  const [tplName, setTplName] = useState("");
  const changed = !!custom && orderEditable && !sameSteps(custom, orderBase);
  const shown = changed ? custom! : orderEditable ? orderBase : baseSpecs;   // 카드에 보이는 순서
  const useSpecs = changed ? custom! : undefined;                           // 발송에 쓸 순서(없으면 각자 양식 순서)
  const orderError = !changed ? "" : validateSteps(custom!) ?? (orderBase.some((s) => s.kind === "EMPLOYEE") && !custom!.some((s) => s.kind === "EMPLOYEE") ? "근로자 단계는 빼지 않습니다." : "");   // 근로자 단계가 없던 양식은 그대로 둔다(검증 P5)
  const mode = locked ? "template" : saveMode;
  useEffect(() => {
    if (!tid) return;
    let alive = true;
    Promise.resolve().then(() => { if (alive) setTplName(""); });   // 다른 양식의 이름이 남지 않게
    fetch(`/api/contract-templates/${tid}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.template?.name) setTplName(d.template.name); }).catch(() => {});
    return () => { alive = false; };
  }, [tid]);

  const edit = (next: ApprovalStepSpec[]) => setCustom(next);
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= shown.length) return;
    const next = [...shown]; const [s] = next.splice(from, 1); next.splice(to, 0, s); edit(next);
  };
  const removeAt = (i: number) => edit(shown.filter((_, j) => j !== i));
  // 넣을 수 있는 단계 — 이 화면은 본부 한 명·각자 원장 한 명이라 본부·원장은 하나씩만
  const addable = (["HQ", "MANAGER"] as StepKind[]).filter((k) => !shown.some((s) => s.kind === k));
  const add = (k: StepKind) => edit(k === "HQ" ? [{ kind: k }, ...shown] : (() => { const i = shown.findIndex((s) => s.kind === "EMPLOYEE"); const n = [...shown]; n.splice(i < 0 ? n.length : i, 0, { kind: k }); return n; })());

  const effMultiHq = useSpecs ? units.filter((u) => isMultiHq(u, contracts, useSpecs)) : multiHq;
  const effNeedHq = useSpecs ? needsHq(units, contracts, useSpecs) : needHq;

  const blockReason = !rows ? "불러오는 중입니다" : !units.length ? "보낼 초안이 없습니다"
    : orderError ? orderError
    : changed && mode === "template" && !tid ? "양식이 없는 계약서는 양식 기본으로 저장할 수 없습니다"
    : effNeedHq && !hq ? "본부 담당자를 고르면 켜져요" : effMultiHq.length === units.length ? "본부 단계가 둘인 양식은 보낸 계약서에서 각각 보냅니다" : "";

  // 화면을 연 뒤 다른 관리자가 그 양식에 순서(·고정)를 정했을 수 있다 — 저장 직전에 다시 보고, 있으면 고정 여부를 건드리지 않는다(재검증 참고)
  const freshHasOrder = async () => {
    const d = await fetch(`/api/contract-templates/${tid}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return d?.template ? d.template.approvalSteps != null : true;   // 못 읽으면 고정을 풀지 않는 쪽으로
  };

  async function send() {
    if (blockReason) return;
    const order = useSpecs;   // 누른 순간의 순서(보내는 동안 카드를 만져도 이번 발송은 그대로)
    const toTemplate = !!order && mode === "template";
    const orderNote = order ? `\n\n결재 순서: ${stepsLabel(order)}${toTemplate ? `\n→ ${tplName ? `양식 「${tplName}」` : "이 양식"}의 ${renewal ? "재계약 " : ""}기본 순서도 이렇게 바뀝니다(다음 발송부터 이 순서).` : " (이번 발송만)"}` : "";
    if (!confirm(`${units.length}건(${people.length}명)을 발송합니다. 발송 후에는 문서를 수정할 수 없습니다.${orderNote}\n\n발송할까요?`)) return;
    setBusy(true);
    try {
      if (toTemplate) {
        // 양식 기본 순서를 먼저 고친다 — 고정 양식은 서버가 발송 때 이 순서와 같은지 본다
        const unlock = !renewal && !hadOrder && !(await freshHasOrder());   // 순서 없던 양식만 「발송 때 변경 허용」으로(DB 기본 고정이 몰래 켜지지 않게)
        const r = await fetch(`/api/contract-templates/${tid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(renewal ? { approvalStepsRenewal: order } : unlock ? { approvalSteps: order, approvalLocked: false } : { approvalSteps: order }) }).catch(() => null);
        const d = r ? await r.json().catch(() => null) : null;
        if (!r || !r.ok) { toast.error(d?.error || "양식의 결재 순서를 저장하지 못해 보내지 않았습니다."); return; }
        // 이제 이 순서가 양식 기본이다 — 화면의 계약들도 새 기본으로(다시 보낼 때 또 저장하지 않게)
        setRows((prev) => (prev ?? []).map((c) => (c.templateId === tid && !!c.approvalRenewal === renewal ? { ...c, approvalSteps: order, ...(unlock ? { approvalLocked: false } : {}) } : c)));
        setCustom(null);
        toast.success(`${tplName ? `양식 「${tplName}」` : "이 양식"}의 결재 순서를 「${stepsLabel(order)}」로 저장했습니다.`);
      }
      if (hq) writeLastHq(hq);
      const result = await sendUnits(units, (u) => (isMultiHq(u, contracts, order) ? null : approverIdsOf(u, contracts, employees, hq, mainManagerIds, order)), {
        message: msg, deadlineDays: Number(days) || 14,
        confirmDup: (dups) => confirm(`같은 양식이 진행 중이거나 30일 안에 보낸 직원이 있습니다:\n${dups.map((u) => `· ${u.c.user.name} — ${u.c.title}`).join("\n")}\n\n이 ${dups.length}건도 발송할까요?`),
      });
      const { fail, keep } = result;
      if (fail.length) {
        toast.error(sendResultText(result), { duration: 15000 });
        // 못 보낸 것만 남긴다 — 고쳐서 다시 보내거나 「보낸 계약서」에서 각각 보낸다
        setRows((prev) => (prev ?? []).filter((c) => keep.includes(c.id) || (c.bundleId && contracts.some((k) => keep.includes(k.id) && k.bundleId === c.bundleId))));
      } else {
        toast.success(sendResultText(result));
        onDone();
      }
    } finally { setBusy(false); }
  }

  async function back() {
    if (busy) return;
    setBusy(true);
    try {
      // 지울 대상은 화면에 불러온 목록이 아니라 넘겨받은 id 를 **지금 다시 확인**해서 고른다(검증 F4) —
      // 아직 「초안」인 것만 지운다. 이미 보낸 것(일부 발송 뒤)은 지우지 않는다(검증 F8)
      let drafts: string[] = [];
      if (ids.length) {
        const r = await fetch(`/api/contracts?ids=${encodeURIComponent(ids.join(","))}`, { cache: "no-store" }).catch(() => null);
        const d = r && r.ok ? await r.json().catch(() => null) : null;
        if (!d) { toast.error("초안 상태를 확인하지 못했습니다. 잠시 뒤 다시 눌러 주세요."); return; }
        drafts = ((d.contracts || []) as Row[]).filter((c) => c.status === "DRAFT").map((c) => c.id);
      }
      const sent = ids.length - drafts.length;
      if (!confirm(`방금 만든 초안 ${drafts.length}건을 지우고 내용 입력으로 돌아갑니다.${sent > 0 ? ` 이미 보낸 ${sent}건은 그대로 둡니다.` : ""} 입력한 값과 받는 사람은 그대로 남습니다. 돌아갈까요?`)) return;
      if (drafts.length && !(await deleteDrafts(drafts))) { toast.error("초안 일부를 지우지 못했습니다. 「보낸 계약서」 목록에서 확인해 주세요."); return; }
      onBack();
    } finally { setBusy(false); }
  }

  const empOf = (id: string) => employees.find((e) => e.id === id);
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs text-gray-500">전자계약 › 계약서 보내기 › {title}</p>
          <h1 className="text-2xl font-bold text-gray-900">결재자 · 발송</h1>
          <button type="button" onClick={back} disabled={busy} className="mt-1 text-xs text-gray-500 underline hover:text-indigo-600 disabled:opacity-50">← 이전: 내용 입력</button>
        </div>
        {stepper}
      </div>

      {failed ? (
        <p className="rounded-xl border bg-white p-6 text-sm text-red-500">만든 초안을 불러오지 못했습니다. 「보낸 계약서」 목록에서 확인해 주세요.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
          <div className="space-y-5 min-w-0">
            {/* 결재 순서 — 카드를 끌어(또는 ‹ › 로) 순서를 바꾼다(시안 v2 4번) */}
            <section className="rounded-xl border bg-white p-4">
              <h2 className="font-semibold text-gray-900 mb-3">결재 순서 <span className="text-xs font-normal text-gray-400">· {orderEditable ? "카드를 끌어 순서를 바꿀 수 있어요 · " : ""}원장·근로자는 자동, 본부만 직접 선택</span></h2>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-stretch">
                {shown.map((s, i) => {
                  const isHq = s.kind === "HQ";
                  const empty = isHq && effNeedHq && !hq;
                  return (
                    <div key={`${s.kind}-${i}`} className="flex sm:flex-1 items-stretch gap-2 min-w-0">
                      {i > 0 && <span className="hidden sm:flex items-center text-gray-400" aria-hidden>→</span>}
                      <div
                        draggable={orderEditable && !busy}
                        onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
                        onDragOver={(e) => { if (drag !== null) e.preventDefault(); }}
                        onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); }}
                        onDragEnd={() => setDrag(null)}
                        className={cn("flex-1 rounded-xl border p-3 min-w-0", drag === i && "opacity-50", empty ? "border-red-300 border-dashed bg-red-50/30" : isHq ? "border-indigo-200 bg-white" : "border-indigo-100 bg-indigo-50/40")}>
                        <div className="flex items-center gap-1">
                          {orderEditable && <span className="text-gray-300 cursor-grab" title="끌어서 순서 바꾸기" aria-hidden><GripVertical size={14} /></span>}
                          <p className="text-xs text-gray-500 flex-1">{i + 1}단계 · {KIND_LABEL[s.kind]}</p>
                          {orderEditable && (
                            <>
                              <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0 || busy} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30" aria-label={`${i + 1}단계를 앞으로`}><ChevronLeft size={14} /></button>
                              <button type="button" onClick={() => move(i, i + 1)} disabled={i === shown.length - 1 || busy} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30" aria-label={`${i + 1}단계를 뒤로`}><ChevronRight size={14} /></button>
                              {s.kind !== "EMPLOYEE" && <button type="button" onClick={() => removeAt(i)} disabled={busy} className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-500" aria-label={`${i + 1}단계 빼기`}><X size={14} /></button>}
                            </>
                          )}
                        </div>
                        {isHq ? (
                          <>
                            <p className={cn("font-bold", empty ? "text-red-600" : "text-gray-900")}>{hq ? empOf(hq)?.name ?? "선택됨" : "선택 필요"}</p>
                            <select value={hq} onChange={(e) => setHq(e.target.value)} className="mt-2 w-full rounded-lg border px-2 py-2 text-sm bg-white">
                              <option value="">본부 담당자 고르기</option>
                              {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                          </>
                        ) : s.kind === "MANAGER" ? (
                          <>
                            <p className="font-bold text-gray-900 truncate">{first && mgrOf(first.c, employees, mainManagerIds) ? (people.length > 1 ? `${mgrOf(first.c, employees, mainManagerIds)!.name} 외` : mgrOf(first.c, employees, mainManagerIds)!.name) : "지점 원장"}</p>
                            <p className="text-xs text-gray-500 mt-1">자동 · 각자 지점 메인 원장</p>
                          </>
                        ) : (
                          <>
                            <p className="font-bold text-gray-900 truncate">{first ? (people.length > 1 ? `${first.c.user.name} 외 ${people.length - 1}명` : first.c.user.name) : "근로자"}</p>
                            <p className="text-xs text-gray-500 mt-1">자동 · 서명 전 비밀번호 확인</p>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {orderEditable && addable.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {addable.map((k) => (
                    <button key={k} type="button" onClick={() => add(k)} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs text-gray-600 hover:border-indigo-300 hover:text-indigo-600"><Plus size={12} />{KIND_LABEL[k]} 단계 넣기</button>
                  ))}
                </div>
              )}
              {changed && (
                <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 space-y-2">
                  <p className="text-sm text-gray-800">바뀐 순서 <b>{stepsLabel(custom!)}</b> <span className="text-xs text-gray-500">(양식 기본: {stepsLabel(orderBase)})</span>
                    <button type="button" onClick={() => setCustom(null)} disabled={busy} className="ml-2 text-xs text-indigo-600 underline">기본 순서로 되돌리기</button></p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <label className={cn("flex items-center gap-1.5", locked && "text-gray-400")}>
                      <input type="radio" name="order-save" checked={mode === "contract"} disabled={locked || busy} onChange={() => setSaveMode("contract")} />이 계약만(이번 발송에만)
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="order-save" checked={mode === "template"} disabled={busy || !tid} onChange={() => setSaveMode("template")} />양식 기본으로 저장{tplName ? ` — 「${tplName}」${renewal ? " 재계약 순서" : ""}` : ""}
                    </label>
                  </div>
                  {locked && <p className="text-xs text-gray-500">이 양식은 결재 순서가 고정이라, 바꾸려면 양식 기본 순서를 함께 고칩니다(다음 발송부터 이 순서).</p>}
                  {orderError && <p className="text-xs text-red-600">{orderError}</p>}
                </div>
              )}
              {!orderEditable && orderUnits.length > 1 && <p className="mt-2 text-xs text-gray-500">양식·순서가 서로 다른 문서가 섞여 있어 여기서는 순서를 바꿀 수 없습니다(각자 양식 순서로 보냅니다).</p>}
              {effMultiHq.length > 0 && <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">본부 단계가 둘 이상인 양식 {effMultiHq.length}건은 여기서 못 보냅니다 — 「보낸 계약서」에서 각각 보내 주세요.</p>}
              {units.some((u) => !u.c.employeeOnly && !mgrOf(u.c, employees, mainManagerIds)) && (() => {
                // 해당자 이름 — 「누가」 원장 단계 없이 가는지 보이게(2026-10-28 이예지)
                const names = [...new Set(units.filter((u) => !u.c.employeeOnly && !mgrOf(u.c, employees, mainManagerIds)).map((u) => `${u.c.user.name}${u.c.user.branch ? `(${u.c.user.branch})` : ""}`))];
                return <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">지점 원장을 찾지 못한 건은 원장 단계 없이 보냅니다 — {names.slice(0, 10).join(", ")}{names.length > 10 ? ` 외 ${names.length - 10}명` : ""}</p>;
              })()}
            </section>

            {/* 보낼 문서 */}
            <section className="rounded-xl border bg-white p-4">
              <h2 className="font-semibold text-gray-900 mb-3">보낼 문서 <span className="text-xs font-normal text-gray-400">· {people.length}명 · 문서 {docCount}건</span></h2>
              {!rows ? <p className="text-sm text-gray-400">불러오는 중…</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">직원</th><th className="py-2 pr-3">문서</th><th className="py-2 pr-3">결재</th></tr></thead>
                    <tbody>
                      {units.map((u) => {
                        const docs = u.bundle ? contracts.filter((c) => c.bundleId === u.c.bundleId) : [u.c];
                        const m = mgrOf(u.c, employees, mainManagerIds);
                        return (
                          <tr key={u.key} className="border-b last:border-b-0 align-top">
                            <td className="py-2 pr-3 whitespace-nowrap"><b>{u.c.user.name}</b>{u.c.user.branch ? <span className="text-xs text-gray-500"> · {u.c.user.branch}</span> : null}</td>
                            <td className="py-2 pr-3">{docs.map((d) => <div key={d.id} className="text-gray-700">{d.title}</div>)}</td>
                            <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
                              {isMultiHq(u, contracts, useSpecs) ? <span className="text-amber-700">개별 발송</span>
                                : (useSpecs && !employeeOnlySingle(u) ? useSpecs : unitSpecs(u, contracts)).map((s) => (s.kind === "HQ" ? (hq ? empOf(hq)?.name : "본부") : s.kind === "MANAGER" ? (m?.name ?? "원장 없음") : s.kind === "EMPLOYEE" ? u.c.user.name : KIND_LABEL[s.kind])).join(" → ")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {external.length > 0 && <p className="mt-2 text-xs text-gray-500">외부 계약 {external.length}건은 서명 링크 전달이 따로라 「보낸 계약서」에서 보냅니다.</p>}
            </section>

            {/* 알림 */}
            <section className="rounded-xl border bg-white p-4 space-y-3">
              <h2 className="font-semibold text-gray-900">알림</h2>
              <p className="text-sm text-gray-700">☑ 받는 사람에게 큐브티 앱·메일로 서명 요청 · 결재 완료 시 본부에 알림</p>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                서명 기한
                <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} className="w-16 rounded-md border px-2 py-1 text-sm" />일
                <span className="text-xs text-gray-400">· 지나면 자동 만료, 미서명 알림 3일마다</span>
              </label>
              <div>
                <span className="text-xs font-medium text-gray-600">발송 메시지 <span className="font-normal text-gray-400">(선택 · 알림·메일·서명 화면)</span></span>
                <textarea value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm resize-none" />
              </div>
            </section>
          </div>

          {/* 오른쪽 — 보낼 내용·미리보기·발송 */}
          <aside className="space-y-3 lg:sticky lg:top-4">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-[11px] text-gray-500">보낼 내용</p>
              <p className="font-bold text-gray-900 break-keep">{title}</p>
              <p className="text-xs text-gray-500">{people.length}명 · 문서 {docCount}건</p>
            </div>
            {first && (
              <a href={`/api/contracts/${repOf(first, contracts).id}/original-document?inline=1`} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-xl border bg-white py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50">
                <Eye size={15} />미리보기 (PDF · 첫 번째 사람)
              </a>
            )}
            <button type="button" onClick={send} disabled={busy || !!blockReason}
              className="w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-500">
              {busy ? "보내는 중…" : `발송하기${units.length ? ` (${units.length}건)` : ""}`}
            </button>
            {blockReason && <p className="text-center text-xs text-red-500">{blockReason}</p>}
          </aside>
        </div>
      )}
    </div>
  );
}

