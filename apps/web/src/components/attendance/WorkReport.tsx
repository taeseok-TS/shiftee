"use client";

// 근로시간 리포트(2026-10-08 QA76 #41) — 본부·원장 공용. 기간·지점·재직 조건으로 직원별 근로시간을 집계하고 엑셀로 내려받는다.
// 숫자는 서버(GET /api/attendance/work-report, lib/work-report)가 계산한다. 시간 칸은 「시간」 단위(소수 1자리), 횟수 칸은 건수.
import { jobGroupLabel } from "@/lib/job-group-label";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { BarChart3, Download, Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Box, Btn, Chip, DateInput, FilterRow, PageHead, inputClass, selectClass, tableClass } from "@/components/kit";

type Row = {
  userId: string; empNo: number | null; name: string; branch: string | null; position: string | null; jobGroup: string | null; resigned: boolean;
  schedDays: number; workDays: number; workMin: number; leaveHours: number;
  overtimeMin: number; nightMin: number; holidayMin: number; holidayWithinMin: number; holidayOverMin: number; publicHolidayMin: number;
  maxWeekMin: number; over52Weeks: number; remain52Min: number;
  late: number; missing: number; absent: number;
};
const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const empNoText = (n: number | null) => (n == null ? "" : String(n).padStart(5, "0"));
const h = (min: number) => Math.round((min / 60) * 10) / 10;
const HEAD = ["사번", "직원", "지점", "직무", "소정근무일", "실근무일", "실근로(h)", "유급휴가(h)", "연장(h)", "야간(h)", "휴일 8h 이내(h)", "휴일 8h 초과(h)", "공휴일(h)", "최대 주(h)", "52h 잔여(h)", "52h 초과 주", "지각", "누락", "결근"];

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
    fetch("/api/branches?pick=1").then((r) => (r.ok ? r.json() : null))   // 숨긴 지점은 고르기에서 뺀다
      // 「본부」는 지점이 아니라 뺀다 — 직영 지점만(2026-10-28 이예지 디자인 ⑦)
      .then((d) => setBranches(((d?.branches ?? []) as { name: string }[]).map((b) => b.name).filter((n) => !n.includes("본부"))))
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
  // 들어오면 이번 달 1일 ~ 오늘 · 전체 지점 결과를 바로(조회 조건만 있고 아래가 비어 있던 것 — 이예지 디자인 ⑦). 처음 한 번만
  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const k = q.trim();
    if (!rows) return [];
    return k ? rows.filter((r) => [r.name, empNoText(r.empNo), r.branch ?? "", r.jobGroup ?? "", jobGroupLabel(r.jobGroup ?? ""), r.position ?? ""].some((v) => v.includes(k))) : rows;
  }, [rows, q]);

  // 표 하나 = [머리, ...줄] — 화면과 엑셀이 같은 값을 쓴다
  const table = useMemo((): (string | number)[][] => [HEAD, ...shown.map((r) => [
    empNoText(r.empNo), r.name + (r.resigned ? " (퇴사)" : ""), r.branch ?? "", jobGroupLabel(r.jobGroup ?? r.position ?? ""),
    r.schedDays, r.workDays, h(r.workMin), Math.round(r.leaveHours * 10) / 10, h(r.overtimeMin), h(r.nightMin), h(r.holidayWithinMin), h(r.holidayOverMin), h(r.publicHolidayMin),
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
    <div>
      {/* 머리(R10 톤) — 제목 = 메뉴 이름 + 위 작은 경로, 오른쪽 흰 「엑셀」(조회한 뒤에 받기). 실행 버튼(인디고)은 조회 하나 */}
      <PageHead crumb="근태 › 근로시간 리포트" title="근로시간 리포트" note={scope === "manager" ? "담당 지점만 보입니다" : undefined}>
        <Btn onClick={download} disabled={!rows || !shown.length}><Download size={14} />엑셀</Btn>
      </PageHead>

      <Box icon={<SlidersHorizontal />} tone="sl" title="조회 조건" sub="직원별 실근로·연장·야간·휴일 근로시간과 주 52시간 — 가산수당 근거">
        <FilterRow>
          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-[#596578]">기간
            <DateInput value={from} onChange={setFrom} aria-label="시작일" className="font-normal" />
          </label>
          <span className="text-[#94a3b8]">~</span>
          <DateInput aria-label="종료일" value={to} min={from} onChange={setTo} />
          <select aria-label="대상" value={emp} onChange={(e) => setEmp(e.target.value as typeof emp)} className={selectClass}>
            <option value="active">재직자</option><option value="resigned">퇴사자(기간 안에 다닌 사람)</option><option value="all">전체</option>
          </select>
          <Btn kind="primary" onClick={load} disabled={loading}>{loading ? "불러오는 중..." : "조회"}</Btn>
        </FilterRow>
        <div className="px-6 py-4">
          <div className="mb-2 text-[13px] font-semibold text-[#596578]">지점 {picked.length ? `(${picked.length}개 선택)` : "(전체)"}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* 맨 앞 「전체」 — 아무 지점도 고르지 않은 상태가 켜져 보이게 */}
            <Chip on={!picked.length} onClick={() => setPicked([])}>전체</Chip>
            {branches.map((b) => <Chip key={b} on={picked.includes(b)} onClick={() => toggle(b)}>{b}</Chip>)}
            {picked.length > 0 && <Btn kind="text" className="text-[13px]" onClick={() => setPicked([])}>선택 해제</Btn>}
          </div>
        </div>
      </Box>

      {rows && (
        <>
          <Box icon={<BarChart3 />} tone="ind" title="직원별 근로시간" sub={`${queried?.from} ~ ${queried?.to} · ${shown.length}명`}>
            <FilterRow>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·사번·지점·직무" aria-label="직원 찾기" className={`${inputClass} w-56 pl-8`} />
              </div>
              {truncated && <span className="text-[12.5px] font-semibold text-[#b45309]">1,000명까지만 보입니다 — 지점을 골라 주세요</span>}
              {queried && queried.key !== condKey && <span className="text-[12.5px] font-semibold text-[#b45309]">조건을 바꿨습니다 — 「조회」를 눌러야 반영됩니다</span>}
            </FilterRow>
            <div className="overflow-x-auto">
              {shown.length === 0 ? (
                <div className="p-8 text-center text-[14px] text-[#596578]">조건에 맞는 직원이 없습니다.</div>
              ) : (
                <table className={cn(tableClass, "[&_th]:px-3 [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2.5 [&_th:first-child]:pl-6 [&_td:first-child]:pl-6")}>
                  <thead>
                    <tr>
                      {HEAD.map((c, i) => <th key={i} className={i >= 4 ? "!text-right" : undefined}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {table.slice(1).map((r, i) => {
                      const src = shown[i];
                      return (
                        <tr key={src.userId} className="hover:bg-[#fafbfd]">
                          {r.map((c, j) => (
                            // 숫자는 검정, 0 은 옅게, 처리할 것(52h 잔여 음수 · 52h 초과 주 1 이상)만 빨강
                            <td key={j} className={`whitespace-nowrap ${j === 1 ? "font-bold text-[#0f172a]" : j < 4 ? "text-[#475569]" : "text-[#0f172a]"} ${typeof c === "number" ? "text-right tabular-nums" : ""} ${typeof c === "number" && c === 0 ? "!text-[#cbd5e1]" : ""} ${j === 14 && typeof c === "number" && c < 0 ? "!text-[#dc2626] font-semibold" : ""} ${j === 15 && typeof c === "number" && c > 0 ? "!text-[#dc2626] font-semibold" : ""}`}>
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
          </Box>
          <p className="text-[12.5px] leading-relaxed text-[#596578]">
            · 실근로 = 실제 출퇴근 간격 − 휴게(4.5h↑ 30분, 9h↑ 1시간). 유급휴가 = 승인된 휴가의 기간 안 날 × 유형별 유급 시간(주말·공휴일 제외).<br />
            · 연장 = 주(월~일)마다 「평일 8시간 초과분 합」과 「주 평일 실근로 − 40시간」 중 큰 쪽. 휴일(일요일·공휴일) 근로는 연장이 아니라 휴일근로이며 하루 8시간 이내(가산 1.5배)와 초과(2배)로 나눕니다. 야간 = 22:00~06:00 겹친 시간.<br />
            · 최대 주·52h 잔여·초과 주는 기간에 걸친 주 전체(월~일, 휴일근로 포함)로 계산합니다. 52h 잔여가 음수면 그 주에 52시간을 넘은 것입니다.<br />
            · 지각 = 기록 상태 지각(오전 반차 날 제외), 누락 = 지난 날 출근·퇴근 한쪽만, 결근 = 지난 날 근무일정이 있는데 기록·휴가 없음(출퇴근 보드와 같은 규칙, 조퇴는 세지 않음).
          </p>
        </>
      )}
    </div>
  );
}
