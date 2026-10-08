"use client";

// 시프티 휴가 사용 내역 가져오기(2026-10-08 QA76 #2) — 본부 휴가 관리 「휴가 가져오기」 탭.
// 엑셀을 고르면 첫 시트를 읽고, 열 이름을 보고 사번·이름·이메일·유형·시작일·종료일·일수·사유를 자동으로 맞춘다(틀리면 고른다).
// 미리보기(직원·유형·일수·중복 판정)를 본 뒤 적용한다. 적용된 묶음은 아래 목록에서 되돌릴 수 있다.
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Upload, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LEAVE_CATALOG } from "@/lib/leave-catalog";

type Field = "empNo" | "name" | "email" | "type" | "startDate" | "endDate" | "days" | "reason" | "status";
// 열 이름 자동 매칭 — 앞 패턴(구체)부터 찾고, 잔여·반려·취소 같은 다른 뜻의 열은 뺀다(검증 F7)
const FIELDS: { key: Field; label: string; hints: RegExp[]; exclude?: RegExp; required?: boolean }[] = [
  { key: "name", label: "이름", hints: [/^(이름|성명|직원명|직원|사용자|name)$/i, /이름|성명|직원명/], required: true },
  { key: "empNo", label: "사번", hints: [/사번|사원\s*번호|empno/i] },
  { key: "email", label: "이메일", hints: [/이메일|email|메일/i] },
  { key: "type", label: "휴가 유형", hints: [/휴가\s*(유형|종류|구분)/, /(유형|종류|type)/i], exclude: /근무|출퇴근|결재/, required: true },
  { key: "startDate", label: "시작일", hints: [/시작\s*(일|날짜)?|start|from/i, /^(날짜|일자|휴가일)$/], required: true },
  { key: "endDate", label: "종료일", hints: [/종료\s*(일|날짜)?|end|to$/i] },
  { key: "days", label: "일수", hints: [/사용\s*일수|신청\s*일수|^일수$/, /일수|days/i], exclude: /잔여|남은|부여|발생|차감\s*전|누적/ },
  { key: "reason", label: "사유", hints: [/신청\s*사유|휴가\s*사유|^사유$/, /사유|메모|비고|reason/i], exclude: /반려|취소|거절/ },
  { key: "status", label: "상태(선택)", hints: [/^(상태|결재\s*상태|승인\s*상태|status)$/i, /상태|status/i] },
];
type Result = {
  i: number; name: string; matched: { userId: string; name: string; branch: string | null } | null;
  typeText: string; typeCode: string | null; typeLabel: string | null; startDate: string; endDate: string; days: number | null; reason: string;
  status: "ok" | "applied" | "user_not_found" | "user_ambiguous" | "user_mismatch" | "type_unknown" | "invalid" | "duplicate" | "status_skip"; message: string;
};
type Batch = { batch: string; count: number; days: number; createdAt: string | null };
const STATUS: Record<Result["status"], { label: string; cls: string }> = {
  ok: { label: "적용 예정", cls: "text-emerald-600" }, applied: { label: "적용됨", cls: "text-emerald-700 font-semibold" }, duplicate: { label: "건너뜀 · 중복", cls: "text-gray-500" },
  user_not_found: { label: "건너뜀 · 직원 없음", cls: "text-red-500" }, user_ambiguous: { label: "건너뜀 · 동명이인", cls: "text-red-500" }, user_mismatch: { label: "건너뜀 · 이름 불일치", cls: "text-red-500" },
  type_unknown: { label: "유형 고르기", cls: "text-amber-600" }, invalid: { label: "건너뜀 · 값 오류", cls: "text-red-500" }, status_skip: { label: "건너뜀 · 승인 아님", cls: "text-gray-500" },
};
const kst = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") : "");
// 엑셀 날짜 셀은 cellDates 로 Date 가 되고, 문자열은 그대로 — 서버가 「2026-05-01」「2026.5.1」을 받는다
const pad = (n: number) => String(n).padStart(2, "0");
const cellText = (v: unknown): string => (v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : v == null ? "" : String(v).trim());

export default function LeaveImport() {
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [map, setMap] = useState<Partial<Record<Field, string>>>({});
  const [overrides, setOverrides] = useState<Record<number, string>>({});   // 행 → 고른 유형 코드
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "apply" | "rollback">("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [deduct, setDeduct] = useState(true);   // 연차 차감 — 잔여를 시프티 기준으로 이미 맞췄다면 끄고 기록만

  const loadBatches = useCallback(async () => {
    try { const r = await fetch("/api/leave/import"); const d = await r.json().catch(() => ({})); if (r.ok) setBatches(d.batches || []); } catch { /* 목록은 보조 */ }
  }, []);
  useEffect(() => { const t = setTimeout(loadBatches, 0); return () => clearTimeout(t); }, [loadBatches]);

  const onFile = async (f: File) => {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (!json.length) { toast.error("첫 시트에 데이터가 없습니다."); return; }
      const hs = Object.keys(json[0]);
      // 열 이름으로 자동 매칭 — 같은 열을 두 칸에 쓰지 않는다
      const used = new Set<string>(); const m: Partial<Record<Field, string>> = {};
      for (const f of FIELDS) {
        let h: string | undefined;
        for (const re of f.hints) { h = hs.find((x) => !used.has(x) && re.test(x.trim()) && !(f.exclude && f.exclude.test(x))); if (h) break; }
        if (h) { m[f.key] = h; used.add(h); }
      }
      setFileName(f.name); setHeaders(hs); setRows(json); setMap(m); setOverrides({}); setResults(null);
    } catch { toast.error("엑셀을 읽지 못했습니다."); }
  };

  const payload = useMemo(() => rows.map((r, i) => {
    const g = (k: Field) => (map[k] ? cellText(r[map[k]!]) : "");
    return { empNo: g("empNo"), name: g("name"), email: g("email"), type: g("type"), startDate: g("startDate"), endDate: g("endDate") || g("startDate"), days: g("days"), reason: g("reason"), status: g("status"), typeOverride: overrides[i] || null };
  }), [rows, map, overrides]);
  const missing = FIELDS.filter((f) => f.required && !map[f.key]).map((f) => f.label);

  const run = async (apply: boolean) => {
    if (missing.length) { toast.error(`${missing.join("·")} 열을 골라 주세요.`); return; }
    if (apply && !confirm(`적용 예정 ${results?.filter((r) => r.status === "ok").length ?? 0}건을 승인 완료 휴가로 넣습니다${deduct ? " (연차 차감 유형은 그 해 연차에서 차감)" : " (연차는 차감하지 않고 기록만)"}. 계속할까요?`)) return;
    setBusy(apply ? "apply" : "preview");
    try {
      const res = await fetch("/api/leave/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: payload, apply, deduct }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "실패했습니다."); if (apply) loadBatches(); return; }
      setResults(d.results || []);
      if (apply) {
        if (d.failedAt != null) toast.error(`${d.failedAt + 2}행에서 실패해 중단했습니다 — ${d.applied}건은 들어갔습니다(묶음 ${d.batch ?? "-"}). 아래 목록에서 되돌릴 수 있습니다.`, { duration: 12000 });
        else toast.success(`${d.applied}건 적용, ${d.skipped}행 건너뜀${d.batch ? ` (묶음 ${d.batch})` : ""}`);
        loadBatches();
      }
    } catch { toast.error("네트워크 오류입니다."); if (apply) loadBatches(); }
    finally { setBusy(""); }
  };

  const rollback = async (b: Batch) => {
    if (!confirm(`묶음 ${b.batch}(${b.count}건, ${b.days}일)을 되돌립니다. 가져온 휴가를 지우고 차감한 연차를 복구합니다. 계속할까요?`)) return;
    setBusy("rollback");
    try {
      const res = await fetch(`/api/leave/import?batch=${encodeURIComponent(b.batch)}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "되돌리지 못했습니다."); return; }
      toast.success(`${d.removed}건 되돌림${d.kept ? `, 취소 요청이 걸린 ${d.kept}건은 그대로` : ""}`);
      loadBatches();
    } catch { toast.error("네트워크 오류입니다."); }
    finally { setBusy(""); }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of results ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [results]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
            <p className="font-semibold">💡 시프티에서 내려받은 휴가 사용 내역 엑셀을 그대로 올리면 됩니다</p>
            <p>첫 시트를 읽어 열 이름으로 이름·사번·유형·날짜를 자동으로 맞춥니다(틀리면 아래에서 고르세요). 미리보기에서 직원·유형·중복을 확인한 뒤 적용하면 <b>승인 완료</b> 휴가로 들어갑니다. 잘못 넣었으면 묶음째 되돌릴 수 있습니다.</p>
            <p>시프티 「반차」「반반차」는 오전·오후 구분이 없어 <b>오전</b>으로 들어갑니다. 상태 열을 맞추면 반려·취소 건은 건너뜁니다.</p>
          </div>
          <div className="flex gap-2 items-center">
            <input id="leave-import-file" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
            <Button size="sm" className="gap-1" onClick={() => document.getElementById("leave-import-file")?.click()}><Upload size={13} />파일 선택</Button>
            {fileName && <span className="text-xs text-gray-500 truncate">{fileName} · {rows.length}행</span>}
          </div>
          {headers.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="text-xs text-gray-600">
                  {f.label}{f.required && <span className="text-red-500">*</span>}
                  <select value={map[f.key] ?? ""} onChange={(e) => { setMap({ ...map, [f.key]: e.target.value || undefined }); setResults(null); }} className="mt-0.5 w-full h-8 rounded border px-2 text-sm bg-white">
                    <option value="">(없음)</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          {headers.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => run(false)} disabled={!!busy}>{busy === "preview" ? "확인 중…" : "미리보기"}</Button>
              <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none" title="끄면 휴가 기록만 넣고 연차 잔여는 건드리지 않습니다 — 잔여를 「연차 일괄 업로드」로 시프티 기준에 이미 맞췄을 때">
                <input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} />연차 차감 유형은 그 해 연차에서 차감
              </label>
              {results && (
                <>
                  <span className="text-xs text-gray-500">적용 예정 {counts.ok ?? 0} · 유형 고르기 {counts.type_unknown ?? 0} · 중복 {counts.duplicate ?? 0} · 직원 없음 {(counts.user_not_found ?? 0) + (counts.user_ambiguous ?? 0)} · 값 오류 {counts.invalid ?? 0}</span>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 ml-auto" onClick={() => run(true)} disabled={!!busy || !counts.ok}>{busy === "apply" ? "적용 중…" : `적용 (${counts.ok ?? 0}건)`}</Button>
                </>
              )}
            </div>
          )}
          {results && (
            <div className="max-h-96 overflow-auto border rounded-lg">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-left text-gray-500 border-b">
                    <th className="px-2 py-2 font-medium">#</th><th className="px-2 py-2 font-medium">파일 이름</th><th className="px-2 py-2 font-medium">직원</th>
                    <th className="px-2 py-2 font-medium">유형(파일 → 큐브티)</th><th className="px-2 py-2 font-medium">기간</th><th className="px-2 py-2 font-medium">일수</th><th className="px-2 py-2 font-medium">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.i} className="border-b last:border-0">
                      <td className="px-2 py-1.5 text-gray-400">{r.i + 2}</td>
                      <td className="px-2 py-1.5">{r.name || "-"}</td>
                      <td className="px-2 py-1.5">{r.matched ? `${r.matched.name}${r.matched.branch ? ` · ${r.matched.branch}` : ""}` : <span className="text-gray-400">-</span>}</td>
                      <td className="px-2 py-1.5">
                        {r.typeText || "(빈칸)"} →{" "}
                        {r.status === "type_unknown" || overrides[r.i] ? (
                          <select value={overrides[r.i] ?? ""} onChange={(e) => { setOverrides({ ...overrides, [r.i]: e.target.value }); }} className="h-7 rounded border px-1 bg-white">
                            <option value="">(고르세요)</option>
                            {LEAVE_CATALOG.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                          </select>
                        ) : (r.typeLabel ?? "-")}
                      </td>
                      <td className="px-2 py-1.5 font-mono">{r.startDate === r.endDate ? r.startDate : `${r.startDate} ~ ${r.endDate}`}</td>
                      <td className="px-2 py-1.5 text-right">{r.days ?? "-"}</td>
                      <td className={`px-2 py-1.5 ${STATUS[r.status].cls}`} title={r.message}>{STATUS[r.status].label}{r.message ? ` — ${r.message}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {results && Object.keys(overrides).length > 0 && <p className="text-xs text-amber-600">유형을 고른 뒤에는 「미리보기」를 다시 눌러 반영하세요.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <p className="text-sm font-medium mb-2">가져온 묶음 {batches.length ? `(${batches.length})` : ""}</p>
          {batches.length === 0 ? <p className="text-xs text-gray-400">아직 가져온 묶음이 없습니다.</p> : (
            <ul className="divide-y text-sm">
              {batches.map((b) => (
                <li key={b.batch} className="py-2 flex items-center gap-3">
                  <span className="font-mono text-xs text-gray-500">{b.batch}</span>
                  <span>{b.count}건 · {b.days}일</span>
                  <span className="text-xs text-gray-400">{kst(b.createdAt)}</span>
                  <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-red-600" onClick={() => rollback(b)} disabled={!!busy}><Undo2 size={12} />되돌리기</Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-400 mt-2">되돌리기는 그 묶음으로 들어간 휴가를 지우고 차감한 연차를 복구합니다. 취소 요청이 걸린 건은 두고 알립니다. 가져온 휴가는 사유 앞에 「[시프티 이관]」이 붙습니다.</p>
        </CardContent>
      </Card>
    </div>
  );
}
