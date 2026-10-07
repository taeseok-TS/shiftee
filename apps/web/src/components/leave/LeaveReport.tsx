"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { LEAVE_CATALOG, LEAVE_GROUPS } from "@/lib/leave-catalog";

/**
 * 휴가 리포트(2026-10-07 QA #29 #84 #85) — 관리자 휴가 관리 「휴가 리포트」 탭.
 *  · 조건: 기간 · 지점(여러 개) · 재직자만 · 이름/사번/유형/사유 검색
 *  · 보기: 사용 내역(#29) / 직원×유형(#84) / 직원×월(#84, 일수)
 *  · 엑셀: 지금 보이는 보기 그대로 내려받기
 * 숫자는 서버(GET /api/leave/report)가 기간 안의 날만 센 값이다.
 */
type Row = {
  id: string; userId: string; empNo: number | null; name: string; branch: string | null; resigned: boolean;
  type: string; label: string; group: string; startDate: string; endDate: string;
  days: number; paidHours: number; deductDays: number; reason: string; byMonth: Record<string, number>;
};
type View = "list" | "type" | "month";

const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const empNoText = (n: number | null) => (n == null ? "" : String(n).padStart(5, "0"));
const num = (n: number) => (Math.round(n * 100) / 100).toString();

export default function LeaveReport() {
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(() => ymdLocal(new Date()));
  const [branches, setBranches] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("list");
  const [rows, setRows] = useState<Row[] | null>(null);
  // 마지막으로 조회한 조건 — 월 열·파일명은 입력칸이 아니라 이것을 따른다(검증 C1)
  const [queried, setQueried] = useState<{ from: string; to: string; key: string } | null>(null);
  const condKey = `${from}|${to}|${[...picked].sort().join(",")}|${activeOnly}`;
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/branches").then((r) => (r.ok ? r.json() : null))
      .then((d) => setBranches(((d?.branches ?? []) as { name: string }[]).map((b) => b.name)))
      .catch(() => {});
  }, []);

  const load = async () => {
    if (!from || !to || from > to) { toast.error("기간을 확인해 주세요."); return; }
    setLoading(true);
    try {
      const p = new URLSearchParams({ from, to });
      if (picked.length) p.set("branches", picked.join(","));
      if (activeOnly) p.set("active", "1");
      const res = await fetch(`/api/leave/report?${p}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "리포트를 불러오지 못했습니다."); return; }
      setRows(d.rows || []);
      setQueried({ from, to, key: condKey });
    } catch {
      toast.error("네트워크 오류로 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // 검색 — 이름·사번·지점·유형·사유 어디든
  const shown = useMemo(() => {
    const k = q.trim();
    if (!rows) return [];
    if (!k) return rows;
    return rows.filter((r) => [r.name, empNoText(r.empNo), r.branch ?? "", r.label, r.group, r.reason].some((v) => v.includes(k)));
  }, [rows, q]);

  // 직원 단위 묶음(유형별·월별 보기)
  const people = useMemo(() => {
    const m = new Map<string, { empNo: number | null; name: string; branch: string | null; resigned: boolean; byType: Record<string, number>; byMonth: Record<string, number>; days: number; paidHours: number; deductDays: number }>();
    for (const r of shown) {
      const p = m.get(r.userId) ?? { empNo: r.empNo, name: r.name, branch: r.branch, resigned: r.resigned, byType: {}, byMonth: {}, days: 0, paidHours: 0, deductDays: 0 };
      p.byType[r.type] = (p.byType[r.type] ?? 0) + r.days;
      for (const [mo, v] of Object.entries(r.byMonth)) p.byMonth[mo] = (p.byMonth[mo] ?? 0) + v;
      p.days += r.days; p.paidHours += r.paidHours; p.deductDays += r.deductDays;
      m.set(r.userId, p);
    }
    return [...m.values()].sort((a, b) => (a.branch ?? "").localeCompare(b.branch ?? "") || a.name.localeCompare(b.name));
  }, [shown]);
  const typeCols = useMemo(() => LEAVE_CATALOG.filter((t) => shown.some((r) => r.type === t.code)), [shown]);
  const monthCols = useMemo(() => {
    const out: string[] = [];
    if (!queried) return out;
    let [y, m] = queried.from.slice(0, 7).split("-").map(Number);
    const end = queried.to.slice(0, 7);
    while (`${y}-${String(m).padStart(2, "0")}` <= end && out.length < 40) {   // 서버 상한 2년 = 최대 26개월
      out.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
    return out;
  }, [queried]);

  // 표 하나 = [머리, ...줄] — 화면과 엑셀이 같은 값을 쓴다
  const table = useMemo((): (string | number)[][] => {
    const who = (p: { empNo: number | null; name: string; branch: string | null; resigned: boolean }) => [empNoText(p.empNo), p.name + (p.resigned ? " (퇴사)" : ""), p.branch ?? ""];
    if (view === "list") {
      return [["사번", "직원", "지점", "기간", "휴가 그룹", "휴가 유형", "일수", "유급 시간", "연차 차감 일수", "사유"],
        ...shown.map((r) => [...who(r), r.startDate === r.endDate ? r.startDate : `${r.startDate} ~ ${r.endDate}`, r.group, r.label, r.days, r.paidHours, r.deductDays, r.reason])];
    }
    if (view === "type") {
      return [["사번", "직원", "지점", ...typeCols.map((t) => t.label), "합계(일)", "유급 시간", "연차 차감 일수"],
        ...people.map((p) => [...who(p), ...typeCols.map((t) => p.byType[t.code] ?? 0), p.days, p.paidHours, p.deductDays])];
    }
    return [["사번", "직원", "지점", ...monthCols.map((mo) => `${Number(mo.slice(5))}월${monthCols[0]?.slice(0, 4) !== monthCols[monthCols.length - 1]?.slice(0, 4) ? `(${mo.slice(2, 4)})` : ""}`), "합계(일)"],
      ...people.map((p) => [...who(p), ...monthCols.map((mo) => p.byMonth[mo] ?? 0), p.days])];
  }, [view, shown, people, typeCols, monthCols]);

  const download = () => {
    if (!rows || !queried) return;
    const ws = XLSX.utils.aoa_to_sheet(table);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, view === "list" ? "사용내역" : view === "type" ? "유형별" : "월별");
    XLSX.writeFile(wb, `휴가리포트_${view === "list" ? "사용내역" : view === "type" ? "유형별" : "월별"}_${queried.from}_${queried.to}.xlsx`);
  };

  const toggle = (b: string) => setPicked((p) => (p.includes(b) ? p.filter((x) => x !== b) : [...p, b]));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">기간</div>
              <div className="flex items-center gap-1">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40" />
                <span className="text-gray-400">~</span>
                <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-8 w-40" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 h-8 cursor-pointer select-none">
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />재직자만
            </label>
            <Button size="sm" onClick={load} disabled={loading}>{loading ? "불러오는 중..." : "조회"}</Button>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">지점 {picked.length ? `(${picked.length}개 선택)` : "(전체)"}</div>
            <div className="flex flex-wrap gap-1.5">
              {branches.map((b) => (
                <button key={b} type="button" onClick={() => toggle(b)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${picked.includes(b) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                  {b}
                </button>
              ))}
              {picked.length > 0 && <button type="button" onClick={() => setPicked([])} className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600">선택 해제</button>}
            </div>
          </div>
        </CardContent>
      </Card>

      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-white border rounded-lg overflow-hidden shadow-sm">
              {([["list", "사용 내역"], ["type", "직원 × 유형"], ["month", "직원 × 월"]] as [View, string][]).map(([v, l]) => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-sm font-medium border-r last:border-r-0 ${view === v ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}>{l}</button>
              ))}
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2 text-gray-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·사번·지점·유형·사유" className="h-8 w-56 pl-8 text-sm" />
            </div>
            <span className="text-xs text-gray-500">{queried?.from} ~ {queried?.to} · {shown.length}건 · {people.length}명</span>
            {queried && queried.key !== condKey && <span className="text-xs text-amber-600">조건을 바꿨습니다 — 「조회」를 눌러야 반영됩니다</span>}
            <Button size="sm" variant="outline" className="gap-1 ml-auto" onClick={download} disabled={!shown.length}>
              <Download size={14} />엑셀
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                {shown.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-500">조건에 맞는 승인된 휴가가 없습니다.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500 bg-gray-50/60">
                        {table[0].map((h, i) => <th key={i} className="px-3 py-2.5 font-medium whitespace-nowrap">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {table.slice(1).map((r, i) => (
                        <tr key={i} className="border-b last:border-b-0 hover:bg-gray-50/50">
                          {r.map((c, j) => (
                            <td key={j} className={`px-3 py-2 whitespace-nowrap ${typeof c === "number" ? "text-right tabular-nums" : ""} ${typeof c === "number" && c === 0 ? "text-gray-300" : ""}`}>
                              {typeof c === "number" ? num(c) : c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>
          <p className="text-xs text-gray-400">
            승인된 휴가만, 기간 안의 날만 셉니다(주말·공휴일 제외). 「기간」 칸은 휴가 원래 기간입니다. 유급 시간 = 일수 × 유형별 유급 시간. 연차 차감은 {LEAVE_GROUPS[0]} 그룹만입니다. 월별 칸은 일수입니다.
          </p>
        </>
      )}
    </div>
  );
}
