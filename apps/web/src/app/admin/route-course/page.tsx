"use client";

// 전자계약 › 루트코스 일정(2026-10-21 이예지 대리) — 기수별 입과일·수료일. 신규입사 근로계약서의 교육평가·실무평가 날짜가 이 표로 채워진다.
// 일정표에 없는 입과일은 자동으로 채우지 않는다(작성 화면에 빨간 줄 — 본부가 직접 입력). 다음 해 기수는 여기서 더한다.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { evalPeriodsFor, isRealDate, type Cohort } from "@/lib/route-course";

type Row = Cohort & { key: number };
let seq = 0;
const withKey = (c: Cohort): Row => ({ ...c, key: ++seq });

export default function RouteCoursePage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saved, setSaved] = useState<string>("");   // 저장된 값(바뀌었는지 비교)
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState(false);   // 못 불러왔으면 빈 표로 저장해 기존 일정을 지우지 않게(검증)

  useEffect(() => {
    fetch("/api/admin/route-course", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!Array.isArray(d?.cohorts)) { setLoadErr(true); setRows([]); return; }
      const list: Cohort[] = d.cohorts;
      setRows(list.map(withKey));
      setSaved(JSON.stringify(list));
    }).catch(() => { setLoadErr(true); setRows([]); });
  }, []);

  const plain = (rows || []).map(({ no, start, end }) => ({ no: no.trim(), start, end }));
  const dirty = rows !== null && JSON.stringify(plain) !== saved;
  const problem = (r: Row): string => {
    if (!r.no.trim()) return "기수를 넣어 주세요";
    if (!isRealDate(r.start) || !isRealDate(r.end)) return "날짜를 넣어 주세요";
    if (r.end < r.start) return "수료일이 입과일보다 빠릅니다";
    if ((rows || []).filter((x) => x.start === r.start).length > 1) return "같은 입과일이 두 번 있습니다";
    return "";
  };
  const bad = (rows || []).some((r) => !!problem(r)) || loadErr || (rows !== null && rows.length === 0);

  const set = (key: number, patch: Partial<Cohort>) => setRows((p) => (p || []).map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => setRows((p) => {
    const list = p || [];
    const last = list[list.length - 1];
    const n = last && /^\d+$/.test(last.no) ? String(Number(last.no) + 1) : "";
    return [...list, withKey({ no: n, start: "", end: "" })];
  });

  async function save() {
    if (busy || bad) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/route-course", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cohorts: plain }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || "저장하지 못했습니다."); return; }
      const list: Cohort[] = d.cohorts || [];
      setRows(list.map(withKey)); setSaved(JSON.stringify(list));
      toast.success("루트코스 일정을 저장했습니다. 이제 새로 쓰는 계약서부터 이 일정으로 채워집니다.");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <p className="text-xs text-gray-500">전자계약 › 루트코스 일정</p>
        <h1 className="text-2xl font-bold text-gray-900">루트코스 일정</h1>
        <p className="mt-1 text-sm text-gray-600">신규입사 근로계약서의 평가 기간이 이 표로 채워집니다(제3조 ① 1·2호, 제8조 ④⑤).</p>
      </div>
      <div className="rounded-xl border bg-white p-4 text-sm text-gray-700 space-y-1">
        <p>· <b>교육평가</b> = 입과일(= 입사일) ~ 그 기수의 수료일</p>
        <p>· <b>실무평가</b> = 수료일 다음 날 ~ 입사일 + 3개월 − 1일 <span className="text-gray-500">(3개월 뒤 달에 같은 날이 없으면 그 달 말일 — 8/31 입사 → 11/30)</span></p>
        <p>· 표에 없는 입과일은 자동으로 채우지 않습니다 — 작성 화면에 빨간 줄로 남아 직접 넣습니다. 재입과로 수습이 늘어나면 그 계약만 날짜를 고쳐 주세요.</p>
      </div>

      <div className="rounded-xl border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="px-3 py-2">기수</th><th className="px-3 py-2">입과일(입사일)</th><th className="px-3 py-2">수료일(교육평가 끝)</th><th className="px-3 py-2">실무평가</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">불러오는 중…</td></tr>
            ) : rows.map((r) => {
              const ev = isRealDate(r.start) && isRealDate(r.end) && r.end >= r.start ? evalPeriodsFor(r.start, [r]) : null;
              const why = problem(r);
              return (
                <tr key={r.key} className={why ? "bg-red-50/60" : "border-b last:border-b-0"}>
                  <td className="px-3 py-1.5"><input value={r.no} onChange={(e) => set(r.key, { no: e.target.value })} className="w-20 rounded border px-2 py-1" aria-label="기수" /></td>
                  <td className="px-3 py-1.5"><input type="date" value={r.start} onChange={(e) => set(r.key, { start: e.target.value })} className="rounded border px-2 py-1" aria-label="입과일" /></td>
                  <td className="px-3 py-1.5"><input type="date" value={r.end} onChange={(e) => set(r.key, { end: e.target.value })} className="rounded border px-2 py-1" aria-label="수료일" /></td>
                  <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{ev ? `${ev.실무평가시작} ~ ${ev.실무평가종료}` : <span className="text-red-600 text-xs">{why || "—"}</span>}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button type="button" onClick={() => setRows((p) => (p || []).filter((x) => x.key !== r.key))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500" aria-label={`${r.no}기 빼기`}><Trash2 size={15} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={add} disabled={rows === null} className="gap-1"><Plus size={15} />기수 더하기</Button>
        <Button type="button" onClick={save} disabled={!dirty || bad || busy}>{busy ? "저장 중…" : "저장"}</Button>
        {loadErr ? <span className="text-xs text-red-600">일정표를 불러오지 못했습니다 — 새로고침해 주세요(이 상태로는 저장하지 않습니다)</span>
          : rows !== null && rows.length === 0 ? <span className="text-xs text-red-600">기수가 하나도 없으면 저장할 수 없어요</span>
          : bad && <span className="text-xs text-red-600">빨간 줄을 고치면 저장할 수 있어요</span>}
        {!loadErr && <span className="text-xs text-gray-400">재입과로 교육평가 종료일을 고치면 실무평가 시작일도 함께 고쳐 주세요</span>}
      </div>
    </div>
  );
}
