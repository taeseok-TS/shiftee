"use client";

// 입사일 대조표(2026-10-08 QA76 이관 #5) — 큐브티 · 포털 명부 · 시프티(엑셀) 입사일을 나란히 보고, 행마다 확정값을 골라 반영한다.
// 반영하면 감사 기록이 남고 올해 연차 총량이 근속으로 다시 계산된다(사용은 그대로). 7월 이전 입사자는 포털 루트입과일이 입사일이 아니므로 포털 칸을 흐리게 보여 준다.
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Upload, Download, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

type Row = { userId: string; empNo: number | null; name: string; email: string; branch: string | null; cubetee: string | null; portal: string | null; portalEditable: boolean | null; resigned: boolean };
type Pick = "keep" | "portal" | "shiftee" | "manual";
const empNoText = (n: number | null) => (n == null ? "" : String(n).padStart(5, "0"));
const pad = (n: number) => String(n).padStart(2, "0");
const cellText = (v: unknown): string => (v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : v == null ? "" : String(v).trim());
const toYmd = (s: string): string | null => { const m = /^(\d{4})[.\-/년 ]\s*(\d{1,2})[.\-/월 ]\s*(\d{1,2})/.exec(s.trim()); if (!m) return null; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d.toISOString().slice(0, 10) : null; };
const norm = (s: string) => s.replace(/[\s()_\-·]/g, "").toLowerCase();

export default function HireDatesPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [shiftee, setShiftee] = useState<Map<string, string>>(new Map());   // userId → 시프티 입사일
  const [shifteeName, setShifteeName] = useState("");
  const [unmatched, setUnmatched] = useState(0);
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [q, setQ] = useState("");
  const [picks, setPicks] = useState<Record<string, { pick: Pick; manual: string }>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/hire-dates"); const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || "불러오지 못했습니다."); setRows([]); return; }
      setRows(d.rows || []); setPortalError(d.portalError ?? null);
    } catch { toast.error("네트워크 오류입니다."); setRows([]); }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  // 시프티 직원 목록 엑셀 — 사번/이메일/이름 열과 입사일 열을 이름으로 찾아 직원에 붙인다
  const onShiftee = async (f: File) => {
    if (!rows) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      if (!json.length) { toast.error("첫 시트에 데이터가 없습니다."); return; }
      const hs = Object.keys(json[0]);
      const col = (res: RegExp[], ex?: RegExp) => { for (const re of res) { const h = hs.find((x) => re.test(x.trim()) && !(ex && ex.test(x))); if (h) return h; } return null; };
      const cEmp = col([/사번|사원\s*번호|empno/i]), cEmail = col([/이메일|email|메일/i]), cName = col([/^(이름|성명|직원명|직원|name)$/i, /이름|성명/]), cHire = col([/입사\s*(일|날짜)|입사|hire|join/i], /퇴사|발령|재입사/);
      if (!cHire || (!cEmp && !cEmail && !cName)) { toast.error("입사일 열과 사번·이메일·이름 중 하나가 있어야 합니다."); return; }
      const byEmp = new Map(rows.filter((r) => r.empNo != null).map((r) => [r.empNo as number, r.userId]));
      const byEmail = new Map(rows.map((r) => [r.email.toLowerCase(), r.userId]));
      const byName = new Map<string, string[]>(); for (const r of rows) byName.set(norm(r.name), [...(byName.get(norm(r.name)) ?? []), r.userId]);
      const m = new Map<string, string>(); let miss = 0;
      for (const j of json) {
        const hire = toYmd(cellText(j[cHire])); if (!hire) { miss++; continue; }
        let uid: string | undefined;
        const e = cEmp ? cellText(j[cEmp]).replace(/[^0-9]/g, "") : ""; if (e) uid = byEmp.get(Number(e));
        if (!uid && cEmail) uid = byEmail.get(cellText(j[cEmail]).toLowerCase());
        if (!uid && cName) { const c = byName.get(norm(cellText(j[cName]))) ?? []; if (c.length === 1) uid = c[0]; }
        if (uid) m.set(uid, hire); else miss++;
      }
      setShiftee(m); setShifteeName(f.name); setUnmatched(miss);
      toast.success(`시프티 입사일 ${m.size}명 연결${miss ? `, ${miss}행은 못 찾음` : ""}`);
    } catch { toast.error("엑셀을 읽지 못했습니다."); }
  };

  const shown = useMemo(() => {
    if (!rows) return [];
    const k = q.trim();
    return rows
      .map((r) => ({ ...r, shiftee: shiftee.get(r.userId) ?? null }))
      .filter((r) => !onlyDiff || (r.portal && r.portal !== r.cubetee) || (r.shiftee && r.shiftee !== r.cubetee) || !r.cubetee)
      .filter((r) => !k || [r.name, empNoText(r.empNo), r.branch ?? ""].some((v) => v.includes(k)));
  }, [rows, shiftee, onlyDiff, q]);

  const valueOf = (r: (typeof shown)[number]) => {
    const p = picks[r.userId]; if (!p || p.pick === "keep") return null;
    if (p.pick === "portal") return r.portal; if (p.pick === "shiftee") return r.shiftee; return toYmd(p.manual) ;
  };
  const pending = shown.map((r) => ({ r, v: valueOf(r) })).filter((x) => x.v && x.v !== x.r.cubetee);

  const apply = async () => {
    if (!pending.length) { toast.error("반영할 변경이 없습니다. 행마다 확정값을 고르세요."); return; }
    if (!confirm(`${pending.length}명의 입사일을 바꾸고 올해 연차 총량을 다시 계산합니다. 계속할까요?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/hire-dates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: pending.map(({ r, v }) => ({ userId: r.userId, hireDate: v, source: picks[r.userId].pick === "portal" ? "포털" : picks[r.userId].pick === "shiftee" ? "시프티" : "직접 입력" })) }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "반영하지 못했습니다."); return; }
      toast.success(`${d.applied}명 반영${d.errors?.length ? `, 오류 ${d.errors.length}건` : ""}`);
      setPicks({}); load();
    } catch { toast.error("네트워크 오류입니다."); }
    finally { setBusy(false); }
  };

  const download = () => {
    const aoa = [["사번", "직원", "지점", "큐브티 입사일", "포털 명부 입사일", "포털 규칙(7월 이후만 반영)", "시프티 입사일", "차이"],
      ...shown.map((r) => [empNoText(r.empNo), r.name + (r.resigned ? " (퇴사)" : ""), r.branch ?? "", r.cubetee ?? "", r.portal ?? "", r.portalEditable === false ? "7월 이전 입사자(반영 안 함)" : r.portalEditable ? "반영 대상" : "", r.shiftee ?? "", (r.portal && r.portal !== r.cubetee) || (r.shiftee && r.shiftee !== r.cubetee) ? "다름" : ""])];
    const ws = XLSX.utils.aoa_to_sheet(aoa); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "입사일 대조"); XLSX.writeFile(wb, `입사일_대조표_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><CalendarCheck size={22} />입사일 대조표</h1>
        <p className="text-sm text-gray-500 mt-1">큐브티·포털 명부·시프티 입사일을 나란히 보고 확정값을 골라 반영합니다. 반영하면 감사 기록이 남고 올해 연차 총량이 근속으로 다시 계산됩니다(사용은 그대로).</p>
      </div>
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input id="hd-shiftee" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onShiftee(f); e.target.value = ""; }} />
            <Button size="sm" variant="outline" className="gap-1" onClick={() => document.getElementById("hd-shiftee")?.click()} disabled={!rows}><Upload size={13} />시프티 직원 목록 엑셀 붙이기</Button>
            {shifteeName && <span className="text-xs text-gray-500">{shifteeName} · {shiftee.size}명 연결{unmatched ? ` · ${unmatched}행 못 찾음` : ""}</span>}
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none ml-2"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />차이 있는 직원만</label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·사번·지점" className="h-8 w-40" />
            <Button size="sm" variant="outline" className="gap-1 ml-auto" onClick={download} disabled={!shown.length}><Download size={13} />엑셀</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={apply} disabled={busy || !pending.length}>{busy ? "반영 중…" : `선택한 ${pending.length}명 반영`}</Button>
          </div>
          {portalError && <p className="text-xs text-amber-600">포털 명부: {portalError} — 포털 칸은 비어 있습니다.</p>}
          <p className="text-xs text-gray-400">포털 칸이 흐린 직원은 7월 이전 입사자라 포털 루트입과일이 입사일이 아닙니다(인사명부 규칙 2026-09-18) — 본부가 확인한 값만 고르세요. 시프티 입사일은 지점 발령일인 경우가 있습니다(요청서 #5).</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-xs text-gray-500 bg-gray-50/60 text-left">
              <th className="px-3 py-2.5 font-medium">직원</th><th className="px-3 py-2.5 font-medium">지점</th><th className="px-3 py-2.5 font-medium">큐브티</th><th className="px-3 py-2.5 font-medium">포털 명부</th><th className="px-3 py-2.5 font-medium">시프티</th><th className="px-3 py-2.5 font-medium">확정값</th>
            </tr></thead>
            <tbody>
              {rows === null ? <tr><td colSpan={6} className="py-8 text-center text-gray-400">불러오는 중…</td></tr>
              : shown.length === 0 ? <tr><td colSpan={6} className="py-8 text-center text-gray-400">{onlyDiff ? "입사일이 다른 직원이 없습니다." : "직원이 없습니다."}</td></tr>
              : shown.map((r) => {
                const p = picks[r.userId] ?? { pick: "keep" as Pick, manual: "" };
                const set = (patch: Partial<{ pick: Pick; manual: string }>) => setPicks({ ...picks, [r.userId]: { ...p, ...patch } });
                const diffP = r.portal && r.portal !== r.cubetee, diffS = r.shiftee && r.shiftee !== r.cubetee;
                return (
                  <tr key={r.userId} className="border-b last:border-0 hover:bg-gray-50/70">
                    <td className="px-3 py-2"><p className="font-medium text-gray-900">{r.name}{r.resigned && <span className="ml-1 text-xs text-gray-400">(퇴사)</span>}</p><p className="text-xs text-gray-400">{empNoText(r.empNo)}</p></td>
                    <td className="px-3 py-2 text-gray-600">{r.branch || "-"}</td>
                    <td className="px-3 py-2 font-mono">{r.cubetee ?? <span className="text-red-500">없음</span>}</td>
                    <td className={`px-3 py-2 font-mono ${r.portalEditable === false ? "text-gray-300" : diffP ? "text-amber-700 font-semibold" : ""}`} title={r.portalEditable === false ? "7월 이전 입사자 — 루트입과일은 입사일이 아님" : ""}>{r.portal ?? "-"}</td>
                    <td className={`px-3 py-2 font-mono ${diffS ? "text-amber-700 font-semibold" : ""}`}>{r.shiftee ?? "-"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="flex items-center gap-1"><input type="radio" name={`p-${r.userId}`} checked={p.pick === "keep"} onChange={() => set({ pick: "keep" })} />유지</label>
                        {r.portal && <label className="flex items-center gap-1"><input type="radio" name={`p-${r.userId}`} checked={p.pick === "portal"} onChange={() => set({ pick: "portal" })} />포털</label>}
                        {r.shiftee && <label className="flex items-center gap-1"><input type="radio" name={`p-${r.userId}`} checked={p.pick === "shiftee"} onChange={() => set({ pick: "shiftee" })} />시프티</label>}
                        <label className="flex items-center gap-1"><input type="radio" name={`p-${r.userId}`} checked={p.pick === "manual"} onChange={() => set({ pick: "manual" })} />직접</label>
                        {p.pick === "manual" && <Input type="date" value={p.manual} onChange={(e) => set({ manual: e.target.value })} className="h-7 w-36" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
