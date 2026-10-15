"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { KIND_LABEL, PRESETS, STEP_KINDS, MAX_STEPS, validateSteps, type ApprovalStepSpec, type StepKind } from "@/lib/approval-order";

/**
 * 결재 순서 편집기(2026-10-12 #213-2) — 템플릿 등록·수정 창에서 쓴다.
 * 단계를 위아래로 옮기고 더하고 빼며, 자주 쓰는 순서는 버튼 하나로 채운다. 저장은 부모가 한다.
 */
export default function ApprovalOrderEditor({ steps, locked, onChange, renewal = false }: {
  steps: ApprovalStepSpec[] | null;   // null = 이 양식은 순서를 정하지 않음(발송 창은 기본 3칸, 서버 검사 없음)
  locked: boolean;
  onChange: (steps: ApprovalStepSpec[] | null, locked: boolean) => void;
  renewal?: boolean;   // 재계약 순서 편집(2026-10-15) — 문구가 다르고 잠금 칸은 기본 순서 것을 같이 쓴다
}) {
  if (!steps) {
    return (
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={false} onChange={() => onChange(PRESETS[0].steps.map((s) => ({ ...s })), locked)} />
          {renewal ? "재계약(기존 근로자)은 다른 순서로 결재" : "이 양식의 결재 순서를 지정"}
        </label>
        <p className="text-[11px] text-gray-500">
          {renewal
            ? "작성 창에서 「계약 구분」을 재계약으로 고른 계약에만 적용됩니다. 지정하지 않으면 재계약도 위 순서대로 갑니다."
            : "지정하지 않으면 발송 창은 지금처럼 「본부 → 원장 → 근로자」 3칸이고 누구든 넣을 수 있습니다(순서 검사 없음)."}
        </p>
      </div>
    );
  }
  const err = validateSteps(steps);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= steps.length) return;
    const next = [...steps]; [next[i], next[j]] = [next[j], next[i]]; onChange(next, locked);
  };
  const setKind = (i: number, kind: StepKind) => { const next = [...steps]; next[i] = { kind }; onChange(next, locked); };
  const remove = (i: number) => onChange(steps.filter((_, k) => k !== i), locked);
  const add = () => { if (steps.length >= MAX_STEPS) return; onChange([...steps, { kind: "HQ" }], locked); };
  const same = (a: ApprovalStepSpec[], b: ApprovalStepSpec[]) => a.length === b.length && a.every((s, i) => s.kind === b[i].kind);

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked onChange={() => onChange(null, locked)} />
        {renewal
          ? <>재계약(기존 근로자)은 다른 순서로 결재 <span className="text-[11px] text-gray-400">(끄면 재계약도 위 순서대로)</span></>
          : <>이 양식의 결재 순서를 지정 <span className="text-[11px] text-gray-400">(끄면 기본 3칸·검사 없음으로 돌아갑니다)</span></>}
      </label>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button key={p.name} type="button" onClick={() => onChange(p.steps.map((s) => ({ ...s })), locked)}
            className={`rounded border px-2 py-0.5 text-[11px] ${same(steps, p.steps) ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="rounded-md border divide-y">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5 text-sm">
            <span className="w-12 shrink-0 text-xs font-semibold text-indigo-500">{i + 1}단계</span>
            <select value={s.kind} onChange={(e) => setKind(i, e.target.value as StepKind)} className="flex-1 rounded border px-2 py-1 text-sm bg-white">
              {STEP_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-500 disabled:text-gray-200" title="위로"><ArrowUp size={14} /></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="text-gray-500 disabled:text-gray-200" title="아래로"><ArrowDown size={14} /></button>
            <button type="button" onClick={() => remove(i)} disabled={steps.length <= 1} className="text-gray-400 hover:text-red-500 disabled:text-gray-200" title="삭제"><X size={14} /></button>
          </div>
        ))}
        {steps.length < MAX_STEPS && (
          <button type="button" onClick={add} className="flex w-full items-center gap-1 px-2 py-1.5 text-xs text-indigo-600 hover:bg-indigo-50"><Plus size={12} />단계 추가</button>
        )}
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {renewal ? (
        <p className="text-[11px] text-gray-500">작성 창에서 「계약 구분」을 재계약으로 고른 계약은 이 순서로 발송됩니다(잠금 여부는 위 설정을 같이 씁니다).</p>
      ) : (<>
      <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
        <input type="checkbox" checked={!locked} onChange={(e) => onChange(steps, !e.target.checked)} />
        발송 때 순서 변경 허용 <span className="text-gray-400">(꺼져 있으면 발송 창은 이 순서대로 칸을 만들고 사람만 고릅니다)</span>
      </label>
      <p className="text-[11px] text-gray-500">
        본부 = 발송 때 사람 선택 · 원장 = 당사자 지점의 메인 원장 자동 · 근로자 = 당사자 본인(외부 계약이면 외부 계약자 링크 서명).
        원장 본인의 계약서는 원장 단계가 자동으로 빠집니다.
      </p>
      </>)}
    </div>
  );
}
