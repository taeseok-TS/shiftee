"use client";

// 모두싸인 체결본 가져오기(2026-10-08 QA76 #4) — 본부. 목록표 엑셀(문서명·서명자·체결일·문서 ID…)과 체결본 PDF ZIP 을 올려
// 열을 맞추고 → 미리보기(직원·파일·중복 판정) → 적용(완료 계약으로) → 묶음 되돌리기.
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import PizZip from "pizzip";
import { toast } from "sonner";
import { Upload, Undo2, FileArchive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Field = "title" | "name" | "empNo" | "email" | "signedAt" | "ref" | "type" | "file";
const FIELDS: { key: Field; label: string; hints: RegExp[]; exclude?: RegExp; required?: boolean }[] = [
  { key: "title", label: "문서명", hints: [/문서\s*(명|이름|제목)|제목|title|subject/i], required: true },
  { key: "name", label: "서명자 이름", hints: [/서명자|참여자|수신자|근로자|직원\s*명|^이름$|성명|name/i], exclude: /요청자|발신|보낸/, required: true },
  { key: "empNo", label: "사번", hints: [/사번|사원\s*번호|empno/i] },
  { key: "email", label: "이메일", hints: [/이메일|email|메일/i], exclude: /요청자|발신|보낸/ },
  { key: "signedAt", label: "체결일", hints: [/체결|완료\s*(일|일시|시각)|서명\s*(일|일시)|signed|completed/i, /일시|날짜|date/i], exclude: /요청|생성|만료|발송/, required: true },
  { key: "ref", label: "문서 ID", hints: [/문서\s*id|document\s*id|문서\s*번호|^id$/i] },
  { key: "type", label: "문서 종류(선택)", hints: [/종류|구분|유형|category|type/i], exclude: /상태|status/ },
  { key: "file", label: "파일명(선택)", hints: [/파일\s*(명|이름)|file/i] },
];
type Result = {
  i: number; title: string; name: string; matched: { userId: string; name: string; branch: string | null; resigned: boolean } | null;
  type: string; signedAt: string; ref: string; file: string | null; certFile: string | null;
  status: "ok" | "applied" | "user_not_found" | "user_ambiguous" | "user_mismatch" | "file_not_found" | "file_ambiguous" | "invalid" | "duplicate"; message: string;
};
type Batch = { batch: string; count: number; createdAt: string | null };
const STATUS: Record<Result["status"], { label: string; cls: string }> = {
  ok: { label: "적용 예정", cls: "text-emerald-600" }, applied: { label: "적용됨", cls: "text-emerald-700 font-semibold" }, duplicate: { label: "건너뜀 · 중복", cls: "text-gray-500" },
  user_not_found: { label: "건너뜀 · 직원 없음", cls: "text-red-500" }, user_ambiguous: { label: "건너뜀 · 동명이인", cls: "text-red-500" }, user_mismatch: { label: "건너뜀 · 이름 불일치", cls: "text-red-500" },
  file_not_found: { label: "건너뜀 · 파일 없음", cls: "text-red-500" }, file_ambiguous: { label: "건너뜀 · 파일 여러 개", cls: "text-red-500" }, invalid: { label: "건너뜀 · 값 오류", cls: "text-red-500" },
};
const TYPE_LABEL: Record<string, string> = { EMPLOYMENT: "근로계약서", PART_TIME: "단시간근로계약서", CONFIDENTIAL: "비밀유지", OTHER: "기타" };
const kst = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") : "");
const pad = (n: number) => String(n).padStart(2, "0");
const cellText = (v: unknown): string => (v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : v == null ? "" : String(v).trim());

export default function ContractImport() {
  const [listName, setListName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [map, setMap] = useState<Partial<Record<Field, string>>>({});
  const [zips, setZips] = useState<File[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "apply" | "rollback">("");
  const [batches, setBatches] = useState<Batch[]>([]);

  const loadBatches = useCallback(async () => {
    try { const r = await fetch("/api/contracts/import"); const d = await r.json().catch(() => ({})); if (r.ok) setBatches(d.batches || []); } catch { /* 목록은 보조 */ }
  }, []);
  useEffect(() => { const t = setTimeout(loadBatches, 0); return () => clearTimeout(t); }, [loadBatches]);

  const onList = async (f: File) => {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      if (!json.length) { toast.error("첫 시트에 데이터가 없습니다."); return; }
      const hs = Object.keys(json[0]); const used = new Set<string>(); const m: Partial<Record<Field, string>> = {};
      for (const fd of FIELDS) { let h: string | undefined; for (const re of fd.hints) { h = hs.find((x) => !used.has(x) && re.test(x.trim()) && !(fd.exclude && fd.exclude.test(x))); if (h) break; } if (h) { m[fd.key] = h; used.add(h); } }
      setListName(f.name); setHeaders(hs); setRows(json); setMap(m); setResults(null);
    } catch { toast.error("목록표를 읽지 못했습니다."); }
  };
  const onZips = async (files: File[]) => {
    try {
      const names: string[] = [];
      for (const f of files) { const z = new PizZip(await f.arrayBuffer()); for (const [n, e] of Object.entries(z.files)) if (!e.dir) names.push(n); }
      setZips(files); setFileNames(names); setResults(null);
      toast.success(`ZIP ${files.length}개 · PDF ${names.filter((n) => /\.pdf$/i.test(n)).length}개`);
    } catch { toast.error("ZIP 을 읽지 못했습니다."); }
  };

  const payload = useMemo(() => rows.map((r) => { const g = (k: Field) => (map[k] ? cellText(r[map[k]!]) : ""); return { title: g("title"), name: g("name"), empNo: g("empNo"), email: g("email"), signedAt: g("signedAt"), ref: g("ref"), type: g("type"), file: g("file") }; }), [rows, map]);
  const missing = FIELDS.filter((f) => f.required && !map[f.key]).map((f) => f.label);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const r of results ?? []) c[r.status] = (c[r.status] ?? 0) + 1; return c; }, [results]);

  const preview = async () => {
    if (missing.length) { toast.error(`${missing.join("·")} 열을 골라 주세요.`); return; }
    if (!fileNames.length) { toast.error("체결본 ZIP 을 올려 주세요."); return; }
    setBusy("preview");
    try {
      const res = await fetch("/api/contracts/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: payload, fileNames }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "실패했습니다."); return; }
      setResults(d.results || []);
    } catch { toast.error("네트워크 오류입니다."); }
    finally { setBusy(""); }
  };
  const apply = async () => {
    const n = counts.ok ?? 0;
    if (!n || !confirm(`적용 예정 ${n}건을 완료 계약으로 넣습니다(직원별 문서함에 보임). 계속할까요?`)) return;
    setBusy("apply");
    try {
      const fd = new FormData();
      fd.append("rows", JSON.stringify(payload));
      for (const z of zips) fd.append("zip", z);
      const res = await fetch("/api/contracts/import", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "실패했습니다."); loadBatches(); return; }
      setResults(d.results || []);
      if (d.failedAt != null) toast.error(`${d.failedAt + 2}행에서 실패해 중단했습니다(${d.error}) — ${d.applied}건은 들어갔습니다(묶음 ${d.batch ?? "-"}). 아래에서 되돌릴 수 있습니다.`, { duration: 12000 });
      else toast.success(`${d.applied}건 적용, ${d.skipped}행 건너뜀${d.batch ? ` (묶음 ${d.batch})` : ""}`);
      loadBatches();
    } catch { toast.error("네트워크 오류입니다."); loadBatches(); }
    finally { setBusy(""); }
  };
  const rollback = async (b: Batch) => {
    if (!confirm(`묶음 ${b.batch}(${b.count}건)을 되돌립니다. 가져온 계약과 파일을 지웁니다. 계속할까요?`)) return;
    setBusy("rollback");
    try {
      const res = await fetch(`/api/contracts/import?batch=${encodeURIComponent(b.batch)}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "되돌리지 못했습니다."); return; }
      toast.success(`계약 ${d.removed}건·파일 ${d.files}개 삭제`);
      loadBatches();
    } catch { toast.error("네트워크 오류입니다."); }
    finally { setBusy(""); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">체결본 가져오기 (모두싸인)</h1>
        <p className="text-sm text-gray-500 mt-1">모두싸인에서 내려받은 체결본 PDF(ZIP)와 문서 목록표(엑셀)를 직원별 문서함에 넣습니다. 근로계약서 3년 보존용.</p>
      </div>
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
            <p className="font-semibold">💡 순서: ① 목록표 엑셀 ② 체결본 ZIP(여러 개 가능, 하나에 100MB 까지 — 한 번에 올리는 전체도 100MB 안쪽) ③ 열 맞추기 ④ 미리보기 ⑤ 적용</p>
            <p>목록표 행과 PDF 는 「파일명」 열 → 「문서 ID」가 든 파일명 → 「문서명」과 같은 파일명 순서로 짝짓습니다. 이름에 「인증서」「감사」가 든 PDF 는 감사추적 인증서로 같은 문서에 붙입니다. 직원은 사번 → 이메일 → 이름으로 찾고, 퇴사자도 들어갑니다(본부 문서함에서 보임).</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input id="cimp-list" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onList(f); e.target.value = ""; }} />
            <Button size="sm" className="gap-1" onClick={() => document.getElementById("cimp-list")?.click()}><Upload size={13} />① 목록표</Button>
            {listName && <span className="text-xs text-gray-500 truncate">{listName} · {rows.length}행</span>}
            <input id="cimp-zip" type="file" accept=".zip" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) onZips(fs); e.target.value = ""; }} />
            <Button size="sm" variant="outline" className="gap-1" onClick={() => document.getElementById("cimp-zip")?.click()}><FileArchive size={13} />② 체결본 ZIP</Button>
            {zips.length > 0 && <span className="text-xs text-gray-500">{zips.map((z) => z.name).join(", ")} · PDF {fileNames.filter((n) => /\.pdf$/i.test(n)).length}개</span>}
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
              <Button size="sm" variant="outline" onClick={preview} disabled={!!busy}>{busy === "preview" ? "확인 중…" : "④ 미리보기"}</Button>
              {results && (
                <>
                  <span className="text-xs text-gray-500">적용 예정 {counts.ok ?? 0} · 중복 {counts.duplicate ?? 0} · 파일 없음 {(counts.file_not_found ?? 0) + (counts.file_ambiguous ?? 0)} · 직원 문제 {(counts.user_not_found ?? 0) + (counts.user_ambiguous ?? 0) + (counts.user_mismatch ?? 0)} · 값 오류 {counts.invalid ?? 0}</span>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 ml-auto" onClick={apply} disabled={!!busy || !counts.ok}>{busy === "apply" ? "올리는 중… (파일 크기에 따라 몇 분)" : `⑤ 적용 (${counts.ok ?? 0}건)`}</Button>
                </>
              )}
            </div>
          )}
          {results && (
            <div className="max-h-96 overflow-auto border rounded-lg">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="sticky top-0 bg-gray-50"><tr className="text-left text-gray-500 border-b">
                  <th className="px-2 py-2 font-medium">#</th><th className="px-2 py-2 font-medium">문서명</th><th className="px-2 py-2 font-medium">직원</th><th className="px-2 py-2 font-medium">종류</th><th className="px-2 py-2 font-medium">체결일</th><th className="px-2 py-2 font-medium">파일 / 인증서</th><th className="px-2 py-2 font-medium">상태</th>
                </tr></thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.i} className="border-b last:border-0">
                      <td className="px-2 py-1.5 text-gray-400">{r.i + 2}</td>
                      <td className="px-2 py-1.5 max-w-[280px] truncate" title={r.title}>{r.title || "-"}</td>
                      <td className="px-2 py-1.5">{r.matched ? `${r.matched.name}${r.matched.branch ? ` · ${r.matched.branch}` : ""}${r.matched.resigned ? " (퇴사)" : ""}` : <span className="text-gray-400">{r.name || "-"}</span>}</td>
                      <td className="px-2 py-1.5">{TYPE_LABEL[r.type] ?? r.type}</td>
                      <td className="px-2 py-1.5 font-mono">{r.signedAt}</td>
                      <td className="px-2 py-1.5 max-w-[280px] truncate" title={`${r.file ?? ""}${r.certFile ? ` / ${r.certFile}` : ""}`}>{r.file ? r.file.split("/").pop() : "-"}{r.certFile ? " / 📎" : ""}</td>
                      <td className={`px-2 py-1.5 ${STATUS[r.status].cls}`} title={r.message}>{STATUS[r.status].label}{r.message ? ` — ${r.message}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          <p className="text-sm font-medium mb-2">가져온 묶음 {batches.length ? `(${batches.length})` : ""}</p>
          {batches.length === 0 ? <p className="text-xs text-gray-400">아직 가져온 묶음이 없습니다.</p> : (
            <ul className="divide-y text-sm">
              {batches.map((b) => (
                <li key={b.batch} className="py-2 flex items-center gap-3">
                  <span className="font-mono text-xs text-gray-500">{b.batch}</span><span>{b.count}건</span><span className="text-xs text-gray-400">{kst(b.createdAt)}</span>
                  <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-red-600" onClick={() => rollback(b)} disabled={!!busy}><Undo2 size={12} />되돌리기</Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-400 mt-2">가져온 계약은 완료 상태로 들어가고 결재 이력에 「모두싸인 이관」으로 남습니다. 되돌리기는 그 묶음의 계약과 파일을 지웁니다(다운로드 기록 등 이력도 함께).</p>
        </CardContent>
      </Card>
    </div>
  );
}
