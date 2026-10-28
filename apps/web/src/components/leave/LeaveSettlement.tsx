"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import type { ActiveRow, ResignedRow, SettlementResponse } from "@/lib/leave-settlement";

/**
 * 연차 정산(2026-10-16 이예지 QA76 #57 #58 #59 #60) — 관리자 휴가 관리 「연차 정산」 탭. 본부(ADMIN)만.
 *  · [재직자 정산(미사용)] 연도·기준일·지점 → 그해 회계 기준 발생 − 그해 사용 = 정산 일수(#57 #59)
 *  · [퇴사자 정산] 퇴사 기간·지점 → 입사일 기준 총 발생 − 회계 기준 전년도까지 누적 − 당해 사용(#60)
 *  · 행을 누르면 산정 내역(발생 이벤트) — 휴대폰 폭(md 미만)은 카드형, 칸 함수는 표와 같이 쓴다(#219-16 과 같은 방식)
 *  · 엑셀(#58 휴가 다운로드 4종 중 3종 — 리포트는 「휴가 리포트」 탭): 연차 발생 내역 · 미사용 연차(재직자 정산) · 퇴사자 정산
 *    숫자는 숫자 칸(소수 둘째 자리), 날짜는 문자열 YYYY-MM-DD(xlsx 날짜 칸이 KST 에서 하루 밀리는 함정을 피한다)
 * 계산은 서버(GET /api/leave/settlement → lib/leave-settlement → lib/leave-accrual)가 한다. 금액은 계산하지 않는다(일수까지만).
 */
type Mode = "active" | "resigned";
type ActiveRes = Extract<SettlementResponse, { mode: "active" }>;
type ResignedRes = Extract<SettlementResponse, { mode: "resigned" }>;
type Cell = string | number;
type Col<R> = { label: string; value: (r: R) => Cell; num?: boolean; render?: (r: R) => ReactNode };

const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const empNoText = (n: number | null) => (n == null ? "" : String(n).padStart(5, "0"));
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: number) => r2(n).toString();
const compact = (ymd: string) => ymd.replaceAll("-", "");
const NO_HIRE = "입사일 없음";

// 정산 일수 칸 — 음수(초과 사용)는 빨갛게, 값은 그대로
const settleCell = (v: number | null | undefined) =>
  v == null ? <span className="text-gray-400">-</span>
    : <span className={v < 0 ? "text-red-600 font-semibold" : "font-semibold text-gray-900"}>{num(v)}{v < 0 && <span className="ml-1 text-[10px] font-normal">초과 사용</span>}</span>;
const hoursCell = (v: number) => <span className={v === 0 ? "text-gray-300" : v < 0 ? "text-red-600" : ""}>{num(v)}</span>;

// ── 칸 정의 — 화면 표·카드·엑셀이 같은 값을 쓴다 ──
const ACTIVE_COLS: Col<ActiveRow>[] = [
  { label: "지점", value: (r) => r.branch ?? "" },
  { label: "이름", value: (r) => r.name + (r.role === "ADMIN" ? " (관리자)" : "") },
  { label: "직급", value: (r) => r.position ?? "" },
  { label: "사번", value: (r) => empNoText(r.empNo) },
  { label: "입사일", value: (r) => r.hireDate ?? NO_HIRE, render: (r) => r.hireDate ?? <span className="text-amber-600">{NO_HIRE}</span> },
  { label: "당해 발생(일)", num: true, value: (r) => r.calc?.accrued ?? "" },
  { label: "산정 근거", value: (r) => r.calc?.basis ?? "", render: (r) => <span className="text-xs text-gray-500 whitespace-normal">{r.calc?.basis ?? ""}</span> },
  { label: "당해 사용(일)", num: true, value: (r) => r.calc?.used ?? "" },
  // 참고 칸 — 기준일 뒤에 시작하는 그해 승인 휴가(정산 일수에는 넣지 않는다)
  { label: "기준일 뒤 승인 휴가(일)", num: true, value: (r) => r.usedAfterAsOf, render: (r) => <span className={r.usedAfterAsOf ? "text-gray-600" : "text-gray-300"}>{num(r.usedAfterAsOf)}</span> },
  { label: "정산(미사용) 일수", num: true, value: (r) => r.calc?.settlement ?? "", render: (r) => settleCell(r.calc?.settlement) },
  { label: "보상휴가 잔여(시간)", num: true, value: (r) => r.compHours, render: (r) => hoursCell(r.compHours) },
  { label: "대체휴일 잔여(시간)", num: true, value: (r) => r.substHours, render: (r) => hoursCell(r.substHours) },
];
const RESIGNED_COLS: Col<ResignedRow>[] = [
  { label: "지점", value: (r) => r.branch ?? "" },
  { label: "이름", value: (r) => r.name + (r.role === "ADMIN" ? " (관리자)" : "") },
  { label: "직급", value: (r) => r.position ?? "" },
  { label: "사번", value: (r) => empNoText(r.empNo) },
  { label: "입사일", value: (r) => r.hireDate ?? NO_HIRE, render: (r) => r.hireDate ?? <span className="text-amber-600">{NO_HIRE}</span> },
  { label: "퇴사일", value: (r) => r.resignDate },
  { label: "입사일 기준 총 발생(일)", num: true, value: (r) => r.calc?.hireBasis ?? "" },
  { label: "회계 기준 전년도까지 누적(일)", num: true, value: (r) => r.calc?.fiscalBeforeYear ?? "" },
  { label: "당해 사용(일)", num: true, value: (r) => r.calc?.used ?? "" },
  { label: "정산 일수", num: true, value: (r) => r.calc?.settlement ?? "", render: (r) => settleCell(r.calc?.settlement) },
  { label: "보상휴가 잔여(시간)", num: true, value: (r) => r.compHours, render: (r) => hoursCell(r.compHours) },
  { label: "대체휴일 잔여(시간)", num: true, value: (r) => r.substHours, render: (r) => hoursCell(r.substHours) },
];

const noteOf = (r: ActiveRow | ResignedRow): string => {
  const out: string[] = [];
  if (!r.hireDate) out.push("입사일 없음 — 직원 관리에서 입사일을 넣으면 계산됩니다");
  else if (!r.calc) out.push("입사일이 퇴사일보다 늦음 — 직원 정보를 확인해 주세요");
  if (r.calc?.negative) out.push("초과 사용");
  const after = "usedAfterAsOf" in r ? r.usedAfterAsOf : r.usedAfterResignInYear;   // 잔여 행 대조 — 그해 몫만
  if ("usedAfterResign" in r && r.usedAfterResign > 0) out.push(`퇴사일 뒤 승인 휴가 ${num(r.usedAfterResign)}일 — 취소 필요(정산에 넣지 않음)`);
  if (r.crossYear) out.push("연도를 걸친 휴가 있음 — 날짜별로 나눠 이 해 몫만 넣음");
  if ("crossAsOf" in r && r.crossAsOf) out.push("기준일을 걸친 휴가 있음 — 확인(사용에 통째로 넣음)");
  if ("crossResign" in r && r.crossResign) out.push("퇴사일을 걸친 휴가 있음 — 확인(사용에 통째로 넣음)");
  // 잔여 행 「사용」은 자르는 날 뒤 승인분까지 들어 있으므로 그 몫을 더해 대조한다
  if (r.calc && r.balanceUsed != null && Math.abs(r.balanceUsed - (r.calc.used + after)) > 0.001) out.push(`연차 잔여 행의 사용 ${num(r.balanceUsed)}일과 다름`);
  return out.join(" · ");
};

// 검색 — 이름·사번·지점·직급 어디든
const matches = (r: ActiveRow | ResignedRow, q: string) => {
  const k = q.trim();
  return !k || [r.name, empNoText(r.empNo), r.branch ?? "", r.position ?? ""].some((v) => v.includes(k));
};

/** 엑셀 한 장 — 숫자는 소수 둘째 자리 숫자 칸, 나머지는 문자열 */
function sheetOf(aoa: Cell[][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(aoa.map((row) => row.map((c) => (typeof c === "number" ? r2(c) : c))));
  ws["!cols"] = aoa[0].map((h, i) => ({ wch: Math.min(60, Math.max(String(h).length * 2, ...aoa.slice(1, 200).map((r) => String(r[i] ?? "").length)) + 2) }));
  return ws;
}

export default function LeaveSettlement() {
  const thisYear = new Date().getFullYear();
  const [mode, setMode] = useState<Mode>("active");
  const [year, setYear] = useState(thisYear);
  const [asOf, setAsOf] = useState("");   // 비우면 서버 기본(올해 = 오늘, 지난해 = 12/31)
  const [from, setFrom] = useState(`${thisYear}-01-01`);
  const [to, setTo] = useState(() => ymdLocal(new Date()));
  const [branches, setBranches] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [inclAdmins, setInclAdmins] = useState(false);
  const [inclTest, setInclTest] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<ActiveRes | null>(null);
  const [resigned, setResigned] = useState<ResignedRes | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/branches?pick=1").then((r) => (r.ok ? r.json() : null))
      .then((d) => setBranches(((d?.branches ?? []) as { name: string }[]).map((b) => b.name)))
      .catch(() => {});
  }, []);

  const load = async () => {
    if (mode === "resigned" && (!from || !to || from > to)) { toast.error("퇴사 기간을 확인해 주세요."); return; }
    if (mode === "active" && asOf && asOf.slice(0, 4) !== String(year)) { toast.error("기준일은 고른 연도 안의 날짜여야 합니다."); return; }
    setLoading(true);
    try {
      const p = new URLSearchParams({ mode });
      if (mode === "active") { p.set("year", String(year)); if (asOf) p.set("asOf", asOf); }
      else { p.set("from", from); p.set("to", to); }
      if (picked.length) p.set("branches", picked.join(","));
      if (inclAdmins) p.set("includeAdmins", "true");
      if (inclTest) p.set("includeTest", "true");
      const res = await fetch(`/api/leave/settlement?${p}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "정산을 불러오지 못했습니다."); return; }
      if (d.mode === "active") setActive(d as ActiveRes); else setResigned(d as ResignedRes);
      setOpen(new Set());
    } catch {
      toast.error("네트워크 오류로 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const activeRows = useMemo(() => (active?.rows ?? []).filter((r) => matches(r, q)), [active, q]);
  const resignedRows = useMemo(() => (resigned?.rows ?? []).filter((r) => matches(r, q)), [resigned, q]);

  const toggleOpen = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleBranch = (b: string) => setPicked((p) => (p.includes(b) ? p.filter((x) => x !== b) : [...p, b]));

  // ── 엑셀 3종 ──
  const downloadEvents = () => {
    if (!active) return;
    const head: Cell[] = ["지점", "이름", "직급", "사번", "입사일", "발생일", "종류", "일수", "비고", "상태"];
    const body: Cell[][] = [];
    for (const r of activeRows) {
      const who: Cell[] = [r.branch ?? "", r.name, r.position ?? "", empNoText(r.empNo), r.hireDate ?? NO_HIRE];
      if (!r.calc) { body.push([...who, "", "", "", r.hireDate ? "" : "입사일 없음 — 계산 안 함", ""]); continue; }
      if (!r.calc.events.length) { body.push([...who, "", "", 0, `${active.year}년 발생 없음`, ""]); continue; }
      for (const e of r.calc.events) body.push([...who, e.date, e.kind, e.days, e.note, e.future ? `예정(기준일 ${active.asOf} 뒤)` : "발생"]);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetOf([head, ...body]), "연차 발생 내역");
    XLSX.writeFile(wb, `연차발생내역_${active.year}_기준${compact(active.asOf)}.xlsx`);
  };
  const downloadActive = () => {
    if (!active) return;
    const head: Cell[] = [...ACTIVE_COLS.map((c) => c.label), "연말까지 발생 예정(일)", "비고"];
    const body = activeRows.map((r) => [...ACTIVE_COLS.map((c) => c.value(r)), r.calc?.yearEnd ?? "", noteOf(r)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetOf([head, ...body]), "미사용 연차(재직자 정산)");
    XLSX.writeFile(wb, `연차정산_재직자_${active.year}_기준${compact(active.asOf)}.xlsx`);
  };
  const downloadResigned = () => {
    if (!resigned) return;
    const head: Cell[] = [...RESIGNED_COLS.map((c) => c.label), "산정 근거", "비고"];
    const body = resignedRows.map((r) => [...RESIGNED_COLS.map((c) => c.value(r)), r.calc?.basis ?? "", noteOf(r)]);
    // 둘째 장 — 계산 내역(입사일 기준 발생 · 회계 기준 전년도까지 발생)
    const dHead: Cell[] = ["지점", "이름", "사번", "구분", "발생일", "종류", "일수", "비고"];
    const dBody: Cell[][] = [];
    for (const r of resignedRows) {
      if (!r.calc) continue;
      const who: Cell[] = [r.branch ?? "", r.name, empNoText(r.empNo)];
      for (const e of r.calc.hireEvents) dBody.push([...who, "입사일 기준", e.date, e.kind, e.days, e.note]);
      for (const e of r.calc.fiscalEvents) dBody.push([...who, `회계 기준 ${Number(r.resignDate.slice(0, 4)) - 1}년까지`, e.date, e.kind, e.days, e.note]);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetOf([head, ...body]), "퇴사자 정산");
    XLSX.utils.book_append_sheet(wb, sheetOf([dHead, ...dBody]), "계산 내역");
    XLSX.writeFile(wb, `연차정산_퇴사자_${compact(resigned.from)}_${compact(resigned.to)}.xlsx`);
  };

  // ── 펼침 — 산정 내역 ──
  const eventList = (title: string, list: { date: string; kind: string; days: number; note: string; future?: boolean }[], total?: number) => (
    <div className="min-w-0">
      <div className="text-xs font-medium text-gray-600 mb-1">{title}{total != null && <span className="ml-1 text-gray-900">{num(total)}일</span>}</div>
      {list.length === 0 ? <div className="text-xs text-gray-400">발생 없음</div> : (
        <ul className="text-xs text-gray-600 space-y-0.5">
          {list.map((e, i) => (
            <li key={i} className={e.future ? "text-gray-400" : ""}>
              <span className="tabular-nums">{e.date}</span> · {e.kind} <span className="tabular-nums font-medium">{num(e.days)}일</span> <span className="text-gray-400">({e.note})</span>{e.future && " — 예정"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  const activeDetail = (r: ActiveRow) => (
    <div className="space-y-2">
      {r.calc ? eventList(`${active?.year}년 회계 기준 발생(기준일 ${active?.asOf}까지)`, r.calc.events, r.calc.accrued) : <div className="text-xs text-amber-600">{noteOf(r)}</div>}
      {r.calc && <div className="text-xs text-gray-500">정산 = 발생 {num(r.calc.accrued)}일 − 사용 {num(r.calc.used)}일 = <b>{num(r.calc.settlement)}일</b>{r.calc.yearEnd !== r.calc.accrued && ` · 연말까지 발생 예정 ${num(r.calc.yearEnd)}일`}</div>}
      {r.calc && noteOf(r) && <div className="text-xs text-amber-600">{noteOf(r)}</div>}
    </div>
  );
  const resignedDetail = (r: ResignedRow) => (
    <div className="space-y-2">
      {r.calc ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {eventList("입사일 기준 발생(퇴사일까지)", r.calc.hireEvents, r.calc.hireBasis)}
            {eventList(`회계 기준 ${Number(r.resignDate.slice(0, 4)) - 1}년까지 발생`, r.calc.fiscalEvents, r.calc.fiscalBeforeYear)}
          </div>
          <div className="text-xs text-gray-500">{r.calc.basis}</div>
        </>
      ) : null}
      {noteOf(r) && <div className="text-xs text-amber-600">{noteOf(r)}</div>}
    </div>
  );

  // ── 표(md 이상) + 카드(md 미만) — 같은 칸 정의 ──
  function board<R extends ActiveRow | ResignedRow>(rows: R[], cols: Col<R>[], detail: (r: R) => ReactNode) {
    if (!rows.length) return <Card><CardContent className="p-8 text-center text-sm text-gray-500">조건에 맞는 직원이 없습니다.</CardContent></Card>;
    const show = (c: Col<R>, r: R) => (c.render ? c.render(r) : typeof c.value(r) === "number" ? num(c.value(r) as number) : c.value(r));
    return (
      <>
        <Card className="hidden md:block">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500 bg-gray-50/60">
                    <th className="w-6" />
                    {cols.map((c) => <th key={c.label} className={`px-3 py-2.5 font-medium whitespace-nowrap ${c.num ? "text-right" : ""}`}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Fragment key={r.userId}>
                      <tr className="border-b last:border-b-0 hover:bg-gray-50/50 cursor-pointer" onClick={() => toggleOpen(r.userId)}>
                        <td className="pl-2 text-gray-400">{open.has(r.userId) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        {cols.map((c) => (
                          <td key={c.label} className={`px-3 py-2 ${c.label === "산정 근거" ? "min-w-[220px] max-w-[360px]" : "whitespace-nowrap"} ${c.num ? "text-right tabular-nums" : ""}`}>{show(c, r)}</td>
                        ))}
                      </tr>
                      {open.has(r.userId) && (
                        <tr className="border-b bg-gray-50/40"><td /><td colSpan={cols.length} className="px-3 py-3">{detail(r)}</td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        <div className="space-y-2 md:hidden">
          {rows.map((r) => (
            <div key={r.userId} className="rounded-xl border bg-white p-3">
              <button type="button" className="w-full text-left" onClick={() => toggleOpen(r.userId)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">{[r.branch, r.position, empNoText(r.empNo)].filter(Boolean).join(" · ")}</p>
                    <p className="font-medium text-gray-900">{cols[1].value(r)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-gray-500">{mode === "active" ? "정산(미사용)" : "정산"}</p>
                    <p className="text-base">{settleCell(r.calc?.settlement)}</p>
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {cols.slice(4).filter((c) => c.label !== "산정 근거" && !c.label.startsWith("정산")).map((c) => (
                    <Fragment key={c.label}>
                      <dt className="text-gray-500">{c.label}</dt>
                      <dd className={`text-right ${c.num ? "tabular-nums" : ""}`}>{show(c, r)}</dd>
                    </Fragment>
                  ))}
                </dl>
                <p className="mt-1 text-[11px] text-blue-600">{open.has(r.userId) ? "산정 내역 접기" : "산정 내역 보기"}</p>
              </button>
              {open.has(r.userId) && <div className="mt-2 border-t pt-2">{detail(r)}</div>}
            </div>
          ))}
        </div>
      </>
    );
  }

  const shownCount = mode === "active" ? activeRows.length : resignedRows.length;
  const data = mode === "active" ? active : resigned;

  return (
    <div className="space-y-4">
      <div className="flex bg-white border rounded-lg overflow-hidden shadow-sm w-fit">
        {([["active", "재직자 정산(미사용)"], ["resigned", "퇴사자 정산"]] as [Mode, string][]).map(([v, l]) => (
          <button key={v} onClick={() => setMode(v)}
            className={`px-3 py-1.5 text-sm font-medium border-r last:border-r-0 ${mode === v ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}>{l}</button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            {mode === "active" ? (
              <>
                <div>
                  <div className="text-xs text-gray-500 mb-1">기준 연도</div>
                  <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setAsOf(""); }} className="h-8 rounded-md border bg-white px-2 text-sm">
                    {Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}년</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">기준일 <span className="text-gray-400">(비우면 {year === thisYear ? "오늘" : `${year}-12-31`})</span></div>
                  <Input type="date" value={asOf} min={`${year}-01-01`} max={`${year}-12-31`} onChange={(e) => setAsOf(e.target.value)} className="h-8 w-40" />
                </div>
              </>
            ) : (
              <div>
                <div className="text-xs text-gray-500 mb-1">퇴사 기간(직원 관리의 퇴사일)</div>
                <div className="flex flex-wrap items-center gap-1">
                  <Input type="date" max="9999-12-31" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40" />
                  <span className="text-gray-400">~</span>
                  <Input type="date" max="9999-12-31" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-8 w-40" />
                </div>
              </div>
            )}
            <label className="flex items-center gap-1.5 text-xs text-gray-600 h-8 cursor-pointer select-none">
              <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={inclAdmins} onChange={(e) => setInclAdmins(e.target.checked)} />관리자 포함
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 h-8 cursor-pointer select-none">
              <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={inclTest} onChange={(e) => setInclTest(e.target.checked)} />통계 제외 지점(본부·테스트) 포함
            </label>
            <Button size="sm" onClick={load} disabled={loading}>{loading ? "불러오는 중..." : "조회"}</Button>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">지점 {picked.length ? `(${picked.length}개 선택)` : "(전체)"}</div>
            <div className="flex flex-wrap gap-1.5">
              {branches.map((b) => (
                <button key={b} type="button" onClick={() => toggleBranch(b)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${picked.includes(b) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                  {b}
                </button>
              ))}
              {picked.length > 0 && <button type="button" onClick={() => setPicked([])} className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600">선택 해제</button>}
            </div>
          </div>
        </CardContent>
      </Card>

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2 text-gray-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·사번·지점·직급" className="h-8 w-56 pl-8 text-sm" />
            </div>
            <span className="text-xs text-gray-500">
              {mode === "active" && active ? `${active.year}년 · 기준일 ${active.asOf}` : resigned ? `퇴사 ${resigned.from} ~ ${resigned.to}` : ""} · {shownCount}명
            </span>
            <div className="flex flex-wrap gap-2 ml-auto">
              {mode === "active" ? (
                <>
                  <Button size="sm" variant="outline" className="gap-1" onClick={downloadEvents} disabled={!activeRows.length}><Download size={14} />연차 발생 내역</Button>
                  <Button size="sm" variant="outline" className="gap-1" onClick={downloadActive} disabled={!activeRows.length}><Download size={14} />미사용 연차(재직자 정산)</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" className="gap-1" onClick={downloadResigned} disabled={!resignedRows.length}><Download size={14} />퇴사자 정산</Button>
              )}
            </div>
          </div>
          {mode === "active"
            ? board(activeRows, ACTIVE_COLS, activeDetail)
            : board(resignedRows, RESIGNED_COLS, resignedDetail)}
          <p className="text-xs text-gray-400">
            {mode === "active"
              ? "정산(미사용) = 그해 회계 기준 발생(기준일까지) − 그해 사용(기준일까지 시작한 휴가). 사용 = 승인된 연차 차감 휴가(반차 0.5·반반차 0.25, 시프티에서 가져온 휴가 포함, 시작일 연도 기준), 시간 ÷ 8. 「기준일 뒤 승인 휴가」는 참고용이며 정산에 넣지 않습니다. 미사용분은 수당으로 정산하므로 촉진·자동 소멸 없음. 금액은 계산하지 않습니다."
              : "정산 = 입사일 기준 총 발생(퇴사일까지, 퇴사일과 같은 날 발생분 포함) − 회계 기준 전년도까지 누적 발생 − 퇴사 연도 사용(퇴사일까지 시작한 휴가 — 퇴사일 뒤 승인 휴가는 넣지 않고 비고로 알립니다). 퇴사일은 직원 관리에 적힌 날짜 그대로입니다. 금액은 계산하지 않습니다."}
            {" "}보상휴가·대체휴일 잔여는 유효기간이 지나도 자동 소멸하지 않으며 본부가 따로 정산합니다(시간 = 일 × 8{mode === "active" ? ", 기준일까지" : ", 지금까지 기록 전부"}).
          </p>
        </>
      )}
    </div>
  );
}
