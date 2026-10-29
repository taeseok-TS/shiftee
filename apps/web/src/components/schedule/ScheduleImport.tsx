"use client";

// 근무일정 엑셀 업로드(2026-10-13 QA76 #75) — 본부 근무일정 「엑셀 업로드」 창.
//  · 달력형(행=직원, 열=날짜, 칸=템플릿 코드·「10:00-19:00」·「휴무」)과 목록형(행=직원·날짜·시간) 둘 다 읽는다.
//    첫 시트의 머리글에 날짜 열이 3개 이상이면 달력형, 아니면 목록형(열 이름으로 자동 매칭, 틀리면 고른다).
//  · 미리보기에서 직원·시간·중복·권한을 확인한 뒤 적용한다. 이미 일정이 있는 날은 건너뛰고, 「덮어쓰기」를 켜면 바꾼다.
//  · 적용된 묶음은 아래 목록에서 되돌릴 수 있다(덮어쓴 일정은 지워질 뿐 원래 값으로 돌아가지 않는다).
//  · 「양식 내려받기」: 달력형은 지금 보는 기간·직원 표(기존 일정이 칸에 채워져 나옴), 목록형은 빈 양식 + 템플릿 목록 시트
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { jobGroupLabel } from "@/lib/job-group-label";
import { toast } from "sonner";
import { Upload, Undo2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BoardEmployee, BoardSchedule } from "@/components/schedule/ScheduleBoard";

type Field = "empNo" | "name" | "date" | "code" | "startTime" | "endTime" | "type" | "note";
const FIELDS: { key: Field; label: string; hints: RegExp[]; exclude?: RegExp; required?: boolean }[] = [
  { key: "name", label: "이름", hints: [/^(이름|성명|직원명|직원|name)$/i, /이름|성명|직원명/], required: true },
  { key: "empNo", label: "사번", hints: [/사번|사원\s*번호|empno/i] },
  { key: "date", label: "날짜", hints: [/^(날짜|일자|근무일|date)$/i, /날짜|일자|근무일/], exclude: /입사|퇴사/, required: true },
  { key: "code", label: "근무 시간 종류(코드·이름)", hints: [/템플릿|근무\s*시간\s*종류|근무\s*(코드|유형명|명)|코드|template/i], exclude: /유형$/ },
  { key: "startTime", label: "시작", hints: [/^(시작|출근|시작\s*시간|출근\s*시간|start)$/i, /시작|출근/], exclude: /실제|기록/ },
  { key: "endTime", label: "종료", hints: [/^(종료|퇴근|종료\s*시간|퇴근\s*시간|end)$/i, /종료|퇴근/], exclude: /실제|기록/ },
  { key: "type", label: "유형(근무·휴무)", hints: [/^(유형|구분|type)$/i] },
  { key: "note", label: "메모", hints: [/메모|비고|note/i] },
];
type Row = { i: number; empNo: string; name: string; date: string; code: string; startTime: string; endTime: string; type: string; note: string };
type Result = {
  i: number; name: string; matched: { userId: string; name: string; branch: string | null } | null;
  date: string; code: string; startTime: string | null; endTime: string | null; type: "WORK" | "OFF" | "HOLIDAY" | null; note: string;
  status: "ok" | "overwrite" | "applied" | "user_not_found" | "user_ambiguous" | "user_mismatch" | "forbidden" | "code_unknown" | "invalid" | "duplicate" | "exists" | "leave"; message: string;
};
type Batch = { batch: string; count: number; from: string | null; to: string | null; createdAt: string | null };
const STATUS: Record<Result["status"], { label: string; cls: string }> = {
  ok: { label: "적용 예정", cls: "text-[#4f46e5]" }, overwrite: { label: "덮어쓰기 예정", cls: "text-amber-600" }, applied: { label: "적용됨", cls: "text-[#3730a3] font-semibold" },
  exists: { label: "건너뜀 · 이미 일정 있음", cls: "text-gray-500" }, leave: { label: "건너뜀 · 휴가", cls: "text-gray-500" }, duplicate: { label: "건너뜀 · 파일 안 중복", cls: "text-gray-500" },
  user_not_found: { label: "건너뜀 · 직원 없음", cls: "text-red-500" }, user_ambiguous: { label: "건너뜀 · 동명이인", cls: "text-red-500" }, user_mismatch: { label: "건너뜀 · 이름 불일치", cls: "text-red-500" },
  forbidden: { label: "건너뜀 · 권한 밖", cls: "text-red-500" }, code_unknown: { label: "건너뜀 · 근무 시간 종류 모름", cls: "text-red-500" }, invalid: { label: "건너뜀 · 값 오류", cls: "text-red-500" },
};
const TYPE_LABEL: Record<string, string> = { WORK: "근무", OFF: "휴무", HOLIDAY: "공휴일" };
const kst = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") : "");
const pad = (n: number) => String(n).padStart(2, "0");
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 엑셀 셀 → 글자. 날짜 셀은 yyyy-MM-dd, 시간만 있는 셀(1899-12-30 기준)은 HH:mm
// ⚠ xlsx 가 엑셀 날짜 셀을 Date 로 바꿀 때 서울 옛 시간대(+8:27:52) 보정으로 **52초 모자라** 자정 날짜가 전날 23:59:08 이 된다(10/13 검증 1).
//   그래서 날짜는 60초(오차만 덮고 「2026-10-01 19:00」 같은 날짜+시간 셀은 그대로), 시간은 30초를 더한 뒤 읽는다.
const cellText = (v: unknown): string => {
  if (v instanceof Date) {
    if (v.getFullYear() < 1950) { const t = new Date(v.getTime() + 30_000); return `${pad(t.getHours())}:${pad(t.getMinutes())}`; }
    return ymdOf(new Date(v.getTime() + 60_000));
  }
  if (typeof v === "number" && v > 0 && v < 1) { const m = Math.round(v * 1440); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }   // 시간 숫자(0.4166=10:00)
  return v == null ? "" : String(v).trim();
};
// 날짜 머리글 — 「2026-10-01」「2026.10.1」「2026-10-06(화)」, 연도가 없는 「10/1」「10월 5일」「10/7(수)」은 보고 있는 기간의 해로
const isDateHeader = (h: unknown, year: number): string | null => {
  if (h instanceof Date) return cellText(h);
  if (typeof h === "number") return null;   // 숫자 셀(10.1·8.5)은 날짜 머리글로 보지 않는다
  const s = cellText(h);
  let m = /^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  m = /^(\d{1,2})\s*[./월]\s*(\d{1,2})\s*일?\s*(?:\(.\))?$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= 31) return `${year}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
  return null;
};

export function ScheduleImport({ employees, schedules, rangeStart, rangeEnd, onApplied }: {
  employees: BoardEmployee[]; schedules: BoardSchedule[]; rangeStart: string; rangeEnd: string; onApplied: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<"calendar" | "list" | "">("");
  const [yearNote, setYearNote] = useState("");   // 연도 없는 머리글(10/1)을 어느 해로 읽었는지
  const [calRows, setCalRows] = useState<Row[]>([]);                 // 달력형은 읽을 때 바로 행으로
  const [headers, setHeaders] = useState<string[]>([]);              // 목록형 열 이름
  const [listRows, setListRows] = useState<Record<string, unknown>[]>([]);
  const [map, setMap] = useState<Partial<Record<Field, string>>>({});
  const [overwrite, setOverwrite] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "apply" | "rollback">("");
  const [batches, setBatches] = useState<Batch[]>([]);

  const loadBatches = useCallback(async () => {
    try { const r = await fetch("/api/schedule/import"); const d = await r.json().catch(() => ({})); if (r.ok) setBatches(d.batches || []); } catch { /* 목록은 보조 */ }
  }, []);
  useEffect(() => { const t = setTimeout(loadBatches, 0); return () => clearTimeout(t); }, [loadBatches]);

  const onFile = async (f: File) => {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
      const year = Number(rangeStart.slice(0, 4));
      // 머리글 = 날짜 칸이 3개 이상인 첫 줄(달력형), 없으면 값이 2칸 이상인 첫 줄(목록형). 시프티 내려받기는 위에 제목 줄이 있다
      const hiCal = grid.findIndex((r) => r.filter((h) => isDateHeader(h, year)).length >= 3);
      const hi = hiCal >= 0 ? hiCal : grid.findIndex((r) => r.filter((c) => cellText(c) !== "").length >= 2);
      if (hi < 0) { toast.error("첫 시트에 데이터가 없습니다."); return; }
      const head = grid[hi];
      // 연도 없는 머리글은 보는 기간의 해로 읽되, 열이 12월→1월로 넘어가면 다음 해로 올린다(연말 파일). 어느 해로 읽었는지 알린다
      let y = year, prev = "", yearless = 0;
      const dateCols = head.map((h, c) => {
        const raw = isDateHeader(h, year);
        if (!raw) return { c, d: null as string | null };
        const hasYear = h instanceof Date || /^\d{4}/.test(cellText(h));
        let d = raw;
        if (!hasYear) { yearless++; d = `${y}${raw.slice(4)}`; if (prev && d < prev) { y += 1; d = `${y}${raw.slice(4)}`; } }
        prev = d;
        return { c, d };
      }).filter((x) => x.d);
      setYearNote(yearless ? `연도 없는 날짜 머리글 ${yearless}개는 ${year}년${y !== year ? `~${y}년` : ""}으로 읽었습니다` : "");
      setFileName(f.name); setResults(null);
      if (hiCal >= 0) {
        // 달력형: 날짜가 아닌 앞 열에서 사번·이름을 찾는다
        const textCols = head.map((h, c) => ({ c, h: cellText(h) })).filter((x) => !dateCols.some((d) => d.c === x.c));
        const nameC = textCols.find((x) => /이름|성명|직원/.test(x.h))?.c;
        const empC = textCols.find((x) => /사번|사원/.test(x.h))?.c;
        if (nameC == null && empC == null) { toast.error("「이름」 또는 「사번」 열을 찾지 못했습니다. 머리글을 확인해 주세요."); return; }
        const unknownCols = textCols.filter((x) => x.c !== nameC && x.c !== empC && x.h && !/지점|직무|직급|부서|조직|소속|비고|메모/.test(x.h));
        if (unknownCols.length) toast.warning(`날짜로 읽지 못한 열 ${unknownCols.length}개는 건너뜁니다: ${unknownCols.map((x) => x.h).slice(0, 4).join(", ")}${unknownCols.length > 4 ? " …" : ""}`, { duration: 8000 });
        const rows: Row[] = [];
        grid.slice(hi + 1).forEach((r, ri) => {
          const name = nameC != null ? cellText(r[nameC]) : "", empNo = empC != null ? cellText(r[empC]) : "";
          if (!name && !empNo) return;
          for (const dc of dateCols) {
            const code = cellText(r[dc.c]);
            if (!code) continue;
            rows.push({ i: hi + 1 + ri, empNo, name, date: dc.d!, code, startTime: "", endTime: "", type: "", note: "" });
          }
        });
        if (!rows.length) { toast.error("채워진 칸이 없습니다."); return; }
        setMode("calendar"); setCalRows(rows); setHeaders([]); setListRows([]);
      } else {
        const hs = head.map(cellText);
        const json = grid.slice(hi + 1).filter((r) => r.some((c) => cellText(c) !== "")).map((r) => Object.fromEntries(hs.map((h, c) => [h, r[c]])));
        if (!json.length) { toast.error("데이터 줄이 없습니다."); return; }
        const used = new Set<string>(); const m: Partial<Record<Field, string>> = {};
        for (const fd of FIELDS) {
          let h: string | undefined;
          for (const re of fd.hints) { h = hs.find((x) => x && !used.has(x) && re.test(x.trim()) && !(fd.exclude && fd.exclude.test(x))); if (h) break; }
          if (h) { m[fd.key] = h; used.add(h); }
        }
        setMode("list"); setHeaders(hs.filter(Boolean)); setListRows(json); setMap(m); setCalRows([]);
      }
    } catch { toast.error("엑셀을 읽지 못했습니다."); }
  };

  const payload: Row[] = useMemo(() => {
    if (mode === "calendar") return calRows;
    return listRows.map((r, i) => {
      const g = (k: Field) => (map[k] ? cellText(r[map[k]!]) : "");
      return { i, empNo: g("empNo"), name: g("name"), date: g("date"), code: g("code"), startTime: g("startTime"), endTime: g("endTime"), type: g("type"), note: g("note") };
    });
  }, [mode, calRows, listRows, map]);
  const missing = mode === "list" ? FIELDS.filter((f) => f.required && !map[f.key]).map((f) => f.label) : [];
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const r of results ?? []) c[r.status] = (c[r.status] ?? 0) + 1; return c; }, [results]);
  const willApply = (counts.ok ?? 0) + (counts.overwrite ?? 0);

  const run = async (apply: boolean) => {
    if (missing.length) { toast.error(`${missing.join("·")} 열을 골라 주세요.`); return; }
    if (mode === "list" && !map.code && !(map.startTime && map.endTime)) { toast.error("근무 시간 종류 열이나 시작·종료 열을 골라 주세요."); return; }
    if (apply && !confirm(`적용 예정 ${counts.ok ?? 0}건${counts.overwrite ? ` + 덮어쓰기 ${counts.overwrite}건` : ""}을 근무일정에 넣습니다. 계속할까요?`)) return;
    setBusy(apply ? "apply" : "preview");
    try {
      const res = await fetch("/api/schedule/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: payload, apply, overwrite }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "실패했습니다."); return; }
      setResults(d.results || []);
      if (apply) {
        toast.success(`${d.applied}건 추가${d.overwritten ? `, ${d.overwritten}건 덮어씀` : ""}, ${d.skipped}칸 건너뜀${d.batch ? ` (묶음 ${d.batch})` : ""}`);
        for (const w of (d.warnings ?? []).slice(0, 3)) toast.warning(w, { duration: 10000 });
        loadBatches(); onApplied();
      }
    } catch { toast.error("네트워크 오류입니다."); }
    finally { setBusy(""); }
  };

  const rollback = async (b: Batch) => {
    if (!confirm(`묶음 ${b.batch}(${b.count}건, ${b.from}~${b.to})을 되돌립니다. 이 묶음으로 넣은 일정을 지웁니다(덮어쓴 일정은 원래 값으로 돌아가지 않습니다). 계속할까요?`)) return;
    setBusy("rollback");
    try {
      const res = await fetch(`/api/schedule/import?batch=${encodeURIComponent(b.batch)}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "되돌리지 못했습니다."); return; }
      toast.success(`${d.removed}건 되돌림`); loadBatches(); onApplied();
    } catch { toast.error("네트워크 오류입니다."); }
    finally { setBusy(""); }
  };

  // ── 양식 내려받기 ──
  const downloadCalendar = () => {
    const days: string[] = [];
    for (let d = new Date(`${rangeStart}T00:00:00`); ymdOf(d) <= rangeEnd; d.setDate(d.getDate() + 1)) days.push(ymdOf(d));
    const by = new Map(schedules.map((s) => [`${s.userId}|${s.date}`, s]));
    const aoa: unknown[][] = [["사번", "이름", "지점", "직무", ...days]];
    for (const e of employees) {
      aoa.push([e.empNo ?? "", e.name, e.branch ?? "", jobGroupLabel(e.jobGroup || e.position), ...days.map((d) => { const s = by.get(`${e.id}|${d}`); return !s ? "" : s.type === "work" ? `${s.startTime}-${s.endTime}` : s.type === "off" ? "휴무" : "공휴일"; })]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 7 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, ...days.map(() => ({ wch: 12 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "근무일정");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["칸에 적는 법"], ["근무 시간 종류 코드 또는 이름(예: 10-7)"], ["시간 「10:00-19:00」"], ["휴무 → 「휴무」"], ["비워 두면 그 날은 건드리지 않음"]]), "안내");
    XLSX.writeFile(wb, `근무일정_달력형_${rangeStart}_${rangeEnd}.xlsx`);
  };
  const downloadList = async () => {
    const ws = XLSX.utils.aoa_to_sheet([["사번", "이름", "날짜", "근무 시간 종류", "시작", "종료", "유형", "메모"], ["", "홍길동", rangeStart, "10-7", "", "", "", ""], ["", "홍길동", rangeStart, "", "13:00", "22:00", "", "직접 시간"], ["", "홍길동", rangeStart, "", "", "", "휴무", ""]]);
    ws["!cols"] = [{ wch: 7 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "근무일정");
    try {
      const r = await fetch("/api/schedule-templates?all=1"); const d = await r.json();
      const tpls = (d.templates ?? []) as { code: string | null; name: string; startTime: string; endTime: string; branches: string[]; isActive: boolean }[];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["코드", "이름", "시작", "종료", "지점(비면 전사)", "사용"], ...tpls.map((t) => [t.code ?? "", t.name, t.startTime, t.endTime, t.branches.join(", "), t.isActive ? "O" : "X"])]), "근무 시간 종류");
    } catch { /* 템플릿 시트는 보조 */ }
    XLSX.writeFile(wb, "근무일정_목록형_양식.xlsx");
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
        <p className="font-semibold">달력형(행=직원, 열=날짜)과 목록형(한 줄에 직원·날짜·시간) 엑셀을 모두 올릴 수 있습니다</p>
        <p>칸에는 근무 시간 종류 코드·이름, 「10:00-19:00」 같은 시간, 「휴무」를 적습니다. 비어 있는 칸은 건드리지 않습니다. 이미 일정이 있는 날은 건너뛰고(덮어쓰기를 켜면 바꿈), 승인된 휴가가 있는 날은 넣지 않습니다. 잘못 올렸으면 묶음째 되돌릴 수 있습니다 — 올린 뒤 손으로 고친 일정은 묶음에서 빠져 되돌리기의 영향을 받지 않습니다.</p>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input id="schedule-import-file" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        <Button size="sm" className="gap-1" onClick={() => document.getElementById("schedule-import-file")?.click()}><Upload size={13} />파일 선택</Button>
        <Button size="sm" variant="outline" className="gap-1" onClick={downloadCalendar} title="지금 보는 기간·직원 표. 기존 일정이 칸에 채워져 나오니 고쳐서 다시 올리면 됩니다"><Download size={13} />달력형 내려받기</Button>
        <Button size="sm" variant="outline" className="gap-1" onClick={downloadList}><Download size={13} />목록형 양식</Button>
        {fileName && <span className="text-xs text-gray-500 truncate">{fileName} · {mode === "calendar" ? `달력형 · 채워진 칸 ${calRows.length}` : `목록형 · ${listRows.length}행`}{yearNote ? <span className="ml-2 text-amber-600">{yearNote}</span> : null}</span>}
      </div>
      {mode === "list" && (
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
      {mode && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => run(false)} disabled={!!busy}>{busy === "preview" ? "확인 중…" : "미리보기"}</Button>
          <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none" title="켜면 이미 일정이 있는 날도 파일 값으로 바꿉니다">
            <input type="checkbox" checked={overwrite} onChange={(e) => { setOverwrite(e.target.checked); setResults(null); }} />이미 있는 일정 덮어쓰기
          </label>
          {results && (
            <>
              <span className="text-xs text-gray-500">적용 예정 {counts.ok ?? 0}{counts.overwrite ? ` · 덮어쓰기 ${counts.overwrite}` : ""} · 이미 있음 {counts.exists ?? 0} · 휴가 {counts.leave ?? 0} · 직원 없음 {(counts.user_not_found ?? 0) + (counts.user_ambiguous ?? 0) + (counts.user_mismatch ?? 0)} · 근무 시간 종류 모름 {counts.code_unknown ?? 0} · 값 오류 {counts.invalid ?? 0}</span>
              <Button size="sm" className="bg-[#4f46e5] hover:bg-[#4338ca] text-white ml-auto" onClick={() => run(true)} disabled={!!busy || !willApply}>{busy === "apply" ? "적용 중…" : `적용 (${willApply}건)`}</Button>
            </>
          )}
        </div>
      )}
      {results && (
        <div className="max-h-80 overflow-auto border rounded-lg">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="sticky top-0 bg-gray-50">
              <tr className="text-left text-gray-500 border-b">
                <th className="px-2 py-2 font-medium">줄</th><th className="px-2 py-2 font-medium">파일 이름</th><th className="px-2 py-2 font-medium">직원</th>
                <th className="px-2 py-2 font-medium">날짜</th><th className="px-2 py-2 font-medium">칸 값</th><th className="px-2 py-2 font-medium">→ 일정</th><th className="px-2 py-2 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, k) => (
                <tr key={`${r.i}-${r.date}-${k}`} className="border-b last:border-0">
                  <td className="px-2 py-1.5 text-gray-400">{r.i + 1}</td>
                  <td className="px-2 py-1.5">{r.name || "-"}</td>
                  <td className="px-2 py-1.5">{r.matched ? `${r.matched.name}${r.matched.branch ? ` · ${r.matched.branch}` : ""}` : <span className="text-gray-400">-</span>}</td>
                  <td className="px-2 py-1.5 font-mono">{r.date}</td>
                  <td className="px-2 py-1.5">{r.code || (r.startTime ? `${r.startTime}-${r.endTime}` : "") || "(빈칸)"}</td>
                  <td className="px-2 py-1.5">{r.type ? (r.type === "WORK" ? `${r.startTime} - ${r.endTime}` : TYPE_LABEL[r.type]) : "-"}{r.note ? <span className="text-gray-400"> · {r.note}</span> : null}</td>
                  <td className={`px-2 py-1.5 ${STATUS[r.status].cls}`} title={r.message}>{STATUS[r.status].label}{r.message ? ` — ${r.message}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <p className="text-sm font-medium mb-2">올린 묶음 {batches.length ? `(${batches.length})` : ""}</p>
        {batches.length === 0 ? <p className="text-xs text-gray-400">아직 올린 묶음이 없습니다.</p> : (
          <ul className="divide-y text-sm max-h-40 overflow-auto">
            {batches.map((b) => (
              <li key={b.batch} className="py-2 flex items-center gap-3">
                <span className="font-mono text-xs text-gray-500">{b.batch}</span>
                <span>{b.count}건 · {b.from}~{b.to}</span>
                <span className="text-xs text-gray-400">{kst(b.createdAt)}</span>
                <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-red-600" onClick={() => rollback(b)} disabled={!!busy}><Undo2 size={12} />되돌리기</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
