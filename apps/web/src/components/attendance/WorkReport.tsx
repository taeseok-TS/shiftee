"use client";

// 근로시간 리포트(2026-10-08 QA76 #41) — 본부·원장 공용. 기간·지점·재직 조건으로 직원별 근로시간을 집계하고 엑셀로 내려받는다.
// 숫자는 서버(GET /api/attendance/work-report, lib/work-report)가 계산한다. 시간 칸은 「시간」 단위(소수 1자리), 횟수 칸은 건수.
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

type Row = {
  userId: string; empNo: number | null; name: string; branch: string | null; position: string | null; jobGroup: string | null; resigned: boolean;
  schedDays: number; workDays: number; workMin: number; leaveHours: number;
  overtimeMin: number; nightMin: number; holidayMin: number; publicHolidayMin: number;
  maxWeekMin: number; over52Weeks: number; remain52Min: number;
  late: number; missing: number; absent: number;
};
const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const empNoText = (n: number | null) => (n == null ? "" : String(n).padStart(5, "0"));
const h = (min: number) => Math.round((min / 60) * 10) / 10;
const HEAD = ["사번", "직원", "지점", "직무", "소정근무일", "실근무일", "실근로(h)", "유급휴가(h)", "연장(h)", "야간(h)", "휴일(h)", "공휴일(h)", "최대 주(h)", "52h 잔여(h)", "52h 초과 주", "지각", "누락", "결근"];

export default function WorkReport({ scope }: { scope: "admin" | "manager" }) {
  const [from, setFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; });
  const [to, setTo] = useState(() => ymdLocal(new Date()));
  const [branches, setBranches] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [emp, setEmp] = useState<"active" | "resigned" | "all">("active");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [queried, setQueried] = useState<{ from: string; to: string; key: string } | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const condKey = `${from}|${to}|${[...picked].sort().join(",")}|${emp}`;

  useEffect(() => {
    // 지점 목록은 전체가 내려온다 — 원장이 담당 밖 지점을 골라도 서버가 담당 지점 밖은 거른다(/api/attendance/work-report)
    fetch("/api/branches").then((r) => (r.ok ? r.json() : null))
      .then((d) => setBranches(((d?.branches ?? []) as { name: string }[]).map((b) => b.name)))
      .catch(() => {});
  }, []);

  const load = async () => {
    if (!from || !to || from > to) { toast.error("기간을 확인해 주세요."); return; }
    setLoading(true);
    try {
      const p = new URLSearchParams({ from, to, emp });
      if (picked.length) p.set("branches", picked.join(","));
      const res = await fetch(`/api/attendance/work-report?${p}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "불러오지 못했습니다."); return; }
      setRows(d.rows || []); setTruncated(!!d.truncated);
      setQueried({ from, to, key: condKey });
    } catch { toast.error("네트워크 오류로 불러오지 못했습니다."); }
    finally { setLoading(false); }
  };

  const shown = useMemo(() => {
    const k = q.trim();
    if (!rows) return [];
    return k ? rows.filter((r) => [r.name, empNoText(r.empNo), r.branch ?? "", r.jobGroup ?? "", r.position ?? ""].some((v) => v.includes(k))) : rows;
  }, [rows, q]);

  // 표 하나 = [머리, ...줄] — 화면과 엑셀이 같은 값을 쓴다
  const table = useMemo((): (string | number)[][] => [HEAD, ...shown.map((r) => [
    empNoText(r.empNo), r.name + (r.resigned ? " (퇴사)" : ""), r.branch ?? "", r.jobGroup ?? r.position ?? "",
    r.schedDays, r.workDays, h(r.workMin), Math.round(r.leaveHours * 10) / 10, h(r.overtimeMin), h(r.nightMin), h(r.holidayMin), h(r.publicHolidayMin),
    h(r.maxWeekMin), h(r.remain52Min), r.over52Weeks, r.late, r.missing, r.absent,
  ])], [shown]);

  const download = () => {
    if (!queried) return;
    const ws = XLSX.utils.aoa_to_sheet(table);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "근로시간");
    XLSX.writeFile(wb, `근로시간리포트_${queried.from}_${queried.to}.xlsx`);
  };
  const toggle = (b: string) => setPicked((p) => (p.includes(b) ? p.filter((x) => x !== b) : [...p, b]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">근로시간 리포트</h1>
        <p className="text-sm text-gray-500 mt-1">직원별 실근로·연장·야간·휴일 근로시간과 주 52시간 — 가산수당 근거.{scope === "manager" ? " 담당 지점만 보입니다." : ""}</p>
      </div>
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
            <div>
              <div className="text-xs text-gray-500 mb-1">대상</div>
              <select value={emp} onChange={(e) => setEmp(e.target.value as typeof emp)} className="h-8 rounded border px-2 text-sm bg-white">
                <option value="active">재직자</option><option value="resigned">퇴사자(기간 안에 다닌 사람)</option><option value="all">전체</option>
              </select>
            </div>
            <Button size="sm" onClick={load} disabled={loading}>{loading ? "불러오는 중..." : "조회"}</Button>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">지점 {picked.length ? `(${picked.length}개 선택)` : "(전체)"}</div>
            <div className="flex flex-wrap gap-1.5">
              {branches.map((b) => (
                <button key={b} type="button" onClick={() => toggle(b)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${picked.includes(b) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 hover:bg-gray-50"}`}>{b}</button>
              ))}
              {picked.length > 0 && <button type="button" onClick={() => setPicked([])} className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600">선택 해제</button>}
            </div>
          </div>
        </CardContent>
      </Card>

      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2 text-gray-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·사번·지점·직무" className="h-8 w-56 pl-8 text-sm" />
            </div>
            <span className="text-xs text-gray-500">{queried?.from} ~ {queried?.to} · {shown.length}명</span>
            {truncated && <span className="text-xs text-amber-600">1,000명까지만 보입니다 — 지점을 골라 주세요</span>}
            {queried && queried.key !== condKey && <span className="text-xs text-amber-600">조건을 바꿨습니다 — 「조회」를 눌러야 반영됩니다</span>}
            <Button size="sm" variant="outline" className="gap-1 ml-auto" onClick={download} disabled={!shown.length}><Download size={14} />엑셀</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                {shown.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-500">조건에 맞는 직원이 없습니다.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500 bg-gray-50/60">
                        {HEAD.map((c, i) => <th key={i} className="px-3 py-2.5 font-medium whitespace-nowrap">{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {table.slice(1).map((r, i) => {
                        const src = shown[i];
                        return (
                          <tr key={src.userId} className="border-b last:border-b-0 hover:bg-gray-50/50">
                            {r.map((c, j) => (
                              <td key={j} className={`px-3 py-2 whitespace-nowrap ${typeof c === "number" ? "text-right tabular-nums" : ""} ${typeof c === "number" && c === 0 ? "text-gray-300" : ""} ${j === 13 && typeof c === "number" && c < 0 ? "text-red-600 font-semibold" : ""} ${j === 14 && typeof c === "number" && c > 0 ? "text-red-600 font-semibold" : ""}`}>
                                {typeof c === "number" ? c : c}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>
          <p className="text-xs text-gray-400 leading-relaxed">
            · 실근로 = 실제 출퇴근 간격 − 휴게(4.5h↑ 30분, 9h↑ 1시간). 유급휴가 = 승인된 휴가의 기간 안 날 × 유형별 유급 시간(주말·공휴일 제외).<br />
            · 연장 = 주(월~일)마다 「평일 8시간 초과분 합」과 「주 평일 실근로 − 40시간」 중 큰 쪽. 휴일(일요일·공휴일) 근로는 연장이 아니라 휴일근로. 야간 = 22:00~06:00 겹친 시간.<br />
            · 최대 주·52h 잔여·초과 주는 기간에 걸친 주 전체(월~일, 휴일근로 포함)로 계산합니다. 52h 잔여가 음수면 그 주에 52시간을 넘은 것입니다.<br />
            · 지각 = 기록 상태 지각(오전 반차 날 제외), 누락 = 지난 날 출근·퇴근 한쪽만, 결근 = 지난 날 근무일정이 있는데 기록·휴가 없음(출퇴근 보드와 같은 규칙, 조퇴는 세지 않음).
          </p>
        </>
      )}
    </div>
  );
}
