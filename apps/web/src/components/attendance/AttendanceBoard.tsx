"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Chip } from "@/components/kit";
import EditedMark, { editExcelColumns } from "@/components/attendance/EditedMark";
import type { AttendanceEditView } from "@/lib/attendance-edit";

/**
 * 전 직원 출퇴근기록 — 달력형·목록형(2026-10-07 QA #27 #28 #17 #52 #68 #82).
 * 본부(/admin/attendance-board)와 원장(/manager/team-attendance)이 **같은 컴포넌트**를 쓴다.
 * 원장은 서버가 담당 지점만 돌려준다. 데이터: GET /api/attendance/board
 */

type Cell = {
  sched?: string; in?: string; out?: string; inPlace?: string | null; outPlace?: string | null;
  leave?: string; late?: boolean; missing?: boolean; absent?: boolean; pending?: boolean; workMin?: number; breakMin?: number;
  edit?: AttendanceEditView;   // 수정된 기록 — 원래 시각·사유·수정/승인자(#219-15)
};
type BoardUser = { id: string; name: string; empNo: number | null; branch: string | null; position: string | null; jobGroup: string | null; resigned: boolean; workDays: number };
type Board = { from: string; to: string; days: string[]; holidays: Record<string, true>; users: BoardUser[]; cells: Record<string, Record<string, Cell>>; truncated?: boolean;
  over49?: Record<string, { monday: string; sched: number; actual: number }[]> };

type Kind = "normal" | "late" | "missing" | "absent" | "leave" | "pending";
const KIND_LABEL: Record<Kind, string> = { normal: "정상", late: "지각", missing: "누락", absent: "결근", leave: "휴가", pending: "승인 대기" };
const kindsOf = (c: Cell): Kind[] => {
  const k: Kind[] = [];
  if (c.leave) k.push("leave");
  if (c.pending) k.push("pending");
  if (c.absent) k.push("absent");
  if (c.missing) k.push("missing");
  if (c.late) k.push("late");
  if (c.in && !c.late && !c.missing) k.push("normal");
  return k;
};
const statusText = (c: Cell) => {
  const base = c.pending ? "승인 대기" : c.absent ? "결근" : c.missing ? "누락" : c.late ? "지각" : c.in ? "정상" : "";
  // 반차처럼 휴가와 출근이 같이 있는 날은 둘 다 보인다(목록·엑셀에서 휴가 정보가 사라지지 않게)
  return c.leave ? (base ? `${base} · ${c.leave}` : c.leave) : base;
};

// 지점 색 띠 — 이름으로 정해지는 색(지점이 늘어도 따로 정할 필요 없음)
const BRANCH_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#ec4899", "#6366f1", "#84cc16", "#f97316"];
const branchColor = (b: string | null) => {
  if (!b) return "#9ca3af";
  let h = 0;
  for (const ch of b) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BRANCH_COLORS[h % BRANCH_COLORS.length];
};
const fmtH = (min?: number) => (min == null ? "" : `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}`);
const pad = (n: number) => String(n).padStart(2, "0");
const monthRange = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
};
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

// embedded — 본부 출퇴근 현황 「달력 · 목록」 탭(R10): 머리 · 알약 탭은 화면(AttendanceTabs)이 그리고, 주말 근무 엑셀은 따로 탭이 있어 뺀다
export default function AttendanceBoard({ scope, embedded = false }: { scope: "admin" | "manager"; embedded?: boolean }) {
  const [ym, setYm] = useState(() => {
    const now = new Date(Date.now() + 9 * 3600_000);   // 이번 달(KST)
    return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
  });
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [emp, setEmp] = useState<"active" | "resigned" | "all">("active");
  const [picked, setPicked] = useState<string[]>([]);
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [branchOpen, setBranchOpen] = useState(false);
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(["normal", "late", "missing", "absent", "leave", "pending"]));
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [colFilter, setColFilter] = useState<Record<string, string>>({});
  const branchBox = useRef<HTMLDivElement>(null);
  // 주말 근무 엑셀(본부, #86) — 기본 기간 전월 20일 ~ 당월 19일(KST)
  // 날짜와 상관없이 늘 전월 20일~당월 19일(2026-10-14 QA 지적으로 확정 — 전엔 20일 전이면 전전월 기간을 보여 줘 헷갈렸다)
  const [wk, setWk] = useState(() => {
    const k = new Date(Date.now() + 9 * 3600_000);
    const start = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() - 1, 20));
    const end = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 19));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  });

  // 지점 선택 상자는 바깥을 누르면 닫힌다(UI 드롭다운 규칙)
  useEffect(() => {
    if (!branchOpen) return;
    const close = (e: MouseEvent) => { if (branchBox.current && !branchBox.current.contains(e.target as Node)) setBranchOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [branchOpen]);

  // 지점 목록 — 본부는 전 지점, 원장은 처음 받은 자기 지점들
  useEffect(() => {
    if (scope !== "admin") return;
    fetch("/api/branches").then((r) => (r.ok ? r.json() : null)).then((d) => {
      const list = (d?.branches || []) as { name: string; isActive?: boolean }[];
      setBranchOptions(list.filter((b) => b.isActive !== false).map((b) => b.name).sort());
    }).catch(() => {});
  }, [scope]);

  const { from, to } = monthRange(ym);
  const query = `from=${from}&to=${to}&emp=${emp}${picked.length ? `&branches=${encodeURIComponent(picked.join(","))}` : ""}`;
  useEffect(() => {
    let alive = true;
    fetch(`/api/attendance/board?${query}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { toast.error(d.error || "불러오지 못했습니다"); setBoard(null); return; }
        setBoard(d as Board);
        if (scope === "manager") {
          setBranchOptions((prev) => (prev.length ? prev : [...new Set((d as Board).users.map((u) => u.branch).filter((b): b is string => !!b))].sort()));
        }
      })
      .catch(() => { if (alive) toast.error("불러오지 못했습니다"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [query, scope]);

  const moveMonth = (delta: number) => {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setLoading(true);
    setYm(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };

  // 목록형 행 — 근무일정·출퇴근·휴가 중 하나라도 있는 날
  const rows = useMemo(() => {
    if (!board) return [];
    const out: { u: BoardUser; d: string; c: Cell }[] = [];
    for (const u of board.users) {
      const row = board.cells[u.id] || {};
      for (const d of board.days) {
        const c = row[d];
        if (!c || !(c.sched || c.in || c.out || c.leave || c.pending)) continue;
        if (!kindsOf(c).some((k) => kinds.has(k))) continue;
        out.push({ u, d, c });
      }
    }
    return out;
  }, [board, kinds]);

  const COLS: { key: string; label: string; get: (r: { u: BoardUser; d: string; c: Cell }) => string }[] = [
    { key: "empNo", label: "사번", get: (r) => (r.u.empNo == null ? "" : String(r.u.empNo)) },
    { key: "name", label: "직원", get: (r) => r.u.name },
    { key: "date", label: "날짜", get: (r) => `${r.d.slice(5).replace("-", "/")}(${WEEK[dow(r.d)]})` },
    { key: "sched", label: "근무일정", get: (r) => r.c.sched?.replace("-", " - ") ?? "" },
    { key: "branch", label: "지점", get: (r) => r.u.branch ?? "" },
    { key: "job", label: "직무", get: (r) => r.u.jobGroup || r.u.position || "" },
    { key: "in", label: "출근", get: (r) => r.c.in ?? "" },
    { key: "inPlace", label: "출근 장소", get: (r) => r.c.inPlace ?? "" },
    { key: "out", label: "퇴근", get: (r) => r.c.out ?? "" },
    { key: "outPlace", label: "퇴근 장소", get: (r) => r.c.outPlace ?? "" },
    { key: "break", label: "휴게", get: (r) => fmtH(r.c.breakMin) },
    { key: "work", label: "총 시간", get: (r) => fmtH(r.c.workMin) },
    { key: "status", label: "상태", get: (r) => statusText(r.c) },
  ];
  const listRows = useMemo(() => {
    const active = Object.entries(colFilter).filter(([, v]) => v.trim());
    if (!active.length) return rows;
    return rows.filter((r) => active.every(([k, v]) => (COLS.find((c) => c.key === k)?.get(r) ?? "").toLowerCase().includes(v.trim().toLowerCase())));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- COLS 는 매 렌더 같은 정의
  }, [rows, colFilter]);

  const exportExcel = () => {
    const src = view === "list" ? listRows : rows;   // 달력형에서는 목록형 열 검색을 적용하지 않는다
    if (!src.length) { toast.error("내보낼 기록이 없습니다"); return; }
    // 수정 여부·원래 출근·원래 퇴근·수정 사유·수정·승인자 열을 뒤에 붙인다(#219-15 — 근로감독 제출용)
    const data = src.map((r) => ({ ...Object.fromEntries(COLS.map((c) => [c.label, c.get(r)])), ...editExcelColumns(r.c.edit) }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "출퇴근기록");
    XLSX.writeFile(wb, `출퇴근기록_${ym}${picked.length ? `_${picked.join("·")}` : ""}.xlsx`);
  };

  const toggleKind = (k: Kind) => setKinds((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const togglePick = (b: string) => { setLoading(true); setPicked((p) => (p.includes(b) ? p.filter((x) => x !== b) : [...p, b])); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!embedded && <h1 className="text-2xl font-bold text-gray-900 mr-2">{scope === "admin" ? "출퇴근기록" : "팀 출퇴근기록"}</h1>}
        {/* 달력형 · 목록형 — 검정 채움 버튼 대신 알약(R10) */}
        <Chip on={view === "calendar"} onClick={() => setView("calendar")}>달력형</Chip>
        <Chip on={view === "list"} onClick={() => setView("list")}>목록형</Chip>
        <div className="flex-1" />
        <Button size="icon" variant="outline" onClick={() => moveMonth(-1)} aria-label="이전 달"><ChevronLeft size={16} /></Button>
        <span className="font-medium w-24 text-center">{ym.replace("-", "년 ")}월</span>
        <Button size="icon" variant="outline" onClick={() => moveMonth(1)} aria-label="다음 달"><ChevronRight size={16} /></Button>

        <div className="relative" ref={branchBox}>
          <Button size="sm" variant="outline" onClick={() => setBranchOpen((o) => !o)}>
            지점: {picked.length ? (picked.length > 2 ? `${picked.slice(0, 2).join(", ")} 외 ${picked.length - 2}` : picked.join(", ")) : "전체"} ▾
          </Button>
          {branchOpen && (
            <div className="absolute right-0 z-20 mt-1 w-56 max-h-80 overflow-auto rounded-md border bg-white p-2 shadow-lg">
              <button className="w-full text-left text-sm px-2 py-1 rounded hover:bg-gray-100" onClick={() => { if (picked.length) { setLoading(true); setPicked([]); } }}>전체</button>
              {branchOptions.map((b) => (
                <label key={b} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={picked.includes(b)} onChange={() => togglePick(b)} />
                  <span className="w-2 h-2 rounded-full" style={{ background: branchColor(b) }} />
                  {b}
                </label>
              ))}
            </div>
          )}
        </div>
        <select className="h-8 rounded-md border px-2 text-sm" value={emp} onChange={(e) => { setLoading(true); setEmp(e.target.value as typeof emp); }}>
          <option value="active">재직</option>
          <option value="resigned">퇴사</option>
          <option value="all">전체</option>
        </select>
        <Button size="sm" variant="outline" onClick={exportExcel}><Download size={14} className="mr-1" />엑셀</Button>
      </div>

      {scope === "admin" && !embedded && (
        <div className="flex flex-wrap items-center gap-2 text-sm rounded-md border bg-white px-3 py-2">
          <span className="font-medium text-gray-700">주말 근무 엑셀</span>
          <input type="date" className="h-8 rounded border px-2" value={wk.from} onChange={(e) => setWk((w) => ({ ...w, from: e.target.value }))} />
          <span>~</span>
          <input type="date" className="h-8 rounded border px-2" value={wk.to} onChange={(e) => setWk((w) => ({ ...w, to: e.target.value }))} />
          <a className="inline-flex items-center h-8 px-3 rounded-md border text-sm hover:bg-gray-50"
            href={`/api/attendance/weekend-export?from=${wk.from}&to=${wk.to}`}
            onClick={(e) => {
              const days = (new Date(wk.to).getTime() - new Date(wk.from).getTime()) / 86400_000;
              if (!wk.from || !wk.to || days < 0) { e.preventDefault(); toast.error("기간을 확인해 주세요."); }
              else if (days > 93) { e.preventDefault(); toast.error("한 번에 3개월까지 받을 수 있습니다."); }
            }}>
            <Download size={14} className="mr-1" />받기
          </a>
          <span className="text-xs text-gray-400">토·일·공휴일 · 원장 포함 · 본부 양식(직영 재직자 급여 자료)</span>
        </div>
      )}

      {/* 범례 = 알약 필터(R10) — 칸 색: 휴가 연파랑 · 누락·결근 연분홍 · 지각 연노랑, 초록 칸 없음 */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <Chip key={k} on={kinds.has(k)} onClick={() => toggleKind(k)}>{KIND_LABEL[k]}</Chip>)}
        <span className="text-[12.5px] text-[#596578]">눌러서 켜고 끄기 · 결근은 근무일정이 있는 지난 날에 기록이 없을 때</span>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400"><Loader2 className="inline animate-spin mr-2" size={18} />불러오는 중…</div>
      ) : !board || board.users.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-gray-400">표시할 직원이 없습니다.</CardContent></Card>
      ) : (<>
      {board.truncated && <div className="text-xs text-amber-700">직원이 1000명을 넘어 앞의 1000명만 보입니다. 지점을 골라 좁혀 주세요.</div>}
      {view === "calendar" ? (
        <div className="overflow-auto border rounded-lg bg-white max-h-[75vh]">
          <table className="text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr>
                <th className="sticky left-0 z-20 bg-gray-50 border px-2 py-2 text-left min-w-[130px]">직원</th>
                {board.days.map((d) => {
                  const w = dow(d), hol = board.holidays[d];
                  return (
                    <th key={d} className={`border px-1 py-1 min-w-[52px] font-medium ${hol || w === 0 ? "text-red-500" : w === 6 ? "text-blue-500" : "text-gray-600"}`}>
                      {Number(d.slice(8))}<div className="font-normal">{WEEK[w]}</div>
                    </th>
                  );
                })}
                <th className="border px-2 py-1 min-w-[48px]">출근일</th>
              </tr>
            </thead>
            <tbody>
              {board.users.map((u) => (
                <tr key={u.id}>
                  <td className="sticky left-0 z-10 bg-white border px-2 py-1 whitespace-nowrap" style={{ boxShadow: `inset 4px 0 0 ${branchColor(u.branch)}` }}>
                    <span className="font-medium">{u.name}</span>
                    <span className="text-gray-400"> · {u.branch ?? "-"}</span>
                    {u.resigned && <span className="ml-1 text-gray-400">(퇴사)</span>}
                    {/* 주 49시간 초과(근무일정 또는 실제, #38) */}
                    {board.over49?.[u.id]?.length ? (
                      <span className="ml-1 text-red-600 font-semibold"
                        title={board.over49[u.id].map((w) => `${w.monday.slice(5).replace("-", "/")} 주 — 일정 ${Math.round(w.sched / 6) / 10}h · 실제 ${Math.round(w.actual / 6) / 10}h`).join(" / ")}>
                        49h 초과
                      </span>
                    ) : null}
                  </td>
                  {board.days.map((d) => {
                    const c = board.cells[u.id]?.[d];
                    const hol = board.holidays[d] || dow(d) === 0 || dow(d) === 6;
                    const show = c && kindsOf(c).some((k) => kinds.has(k));
                    return (
                      <td key={d} className={`border px-1 py-1 text-center align-middle ${!show ? (hol ? "bg-gray-50" : "") : c?.absent || c?.missing ? "bg-[#fff1f2]" : c?.late ? "bg-[#fffbeb]" : c?.leave && !c.in ? "bg-[#eff6ff]" : hol ? "bg-gray-50" : ""}`}
                        title={c ? [c.sched && `일정 ${c.sched}`, c.inPlace && `출근 장소 ${c.inPlace}`, c.outPlace && `퇴근 장소 ${c.outPlace}`, ...(c.edit ? ["— 수정됨", ...c.edit.lines] : [])].filter(Boolean).join("\n") : undefined}>
                        {show && c && (
                          c.absent ? <span className="text-[#be123c] font-medium">결근</span>
                          : c.leave && !c.in ? <span className="text-[#1d4ed8] font-medium">{c.leave}</span>
                          : (
                            <>
                              <div className={c.late ? "text-[#b45309] font-semibold" : ""}>{c.in ?? (c.pending ? <span className="text-amber-600">대기</span> : c.missing ? <span className="text-[#be123c]">누락</span> : "")}</div>
                              <div>{c.out ?? (c.missing ? <span className="text-[#be123c]">누락</span> : "")}</div>
                              {c.leave && <div className="text-[#1d4ed8]">{c.leave}</div>}
                              {c.edit && <div className="text-[10px] text-amber-700">수정됨</div>}
                            </>
                          )
                        )}
                      </td>
                    );
                  })}
                  <td className="border px-2 py-1 text-center font-semibold">{u.workDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-auto border rounded-lg bg-white max-h-[75vh]">
          <table className="text-xs w-full">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr>{COLS.map((c) => <th key={c.key} className="border-b px-2 py-2 text-left whitespace-nowrap">{c.label}</th>)}</tr>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} className="border-b px-1 py-1">
                    <Input className="h-7 text-xs" placeholder="검색" value={colFilter[c.key] ?? ""}
                      onChange={(e) => setColFilter((f) => ({ ...f, [c.key]: e.target.value }))} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listRows.length === 0 ? (
                <tr><td colSpan={COLS.length} className="py-10 text-center text-gray-400">기록이 없습니다.</td></tr>
              ) : listRows.map((r) => (
                <tr key={`${r.u.id}-${r.d}`} className="border-b last:border-0 hover:bg-gray-50">
                  {COLS.map((c) => {
                    const v = c.get(r);
                    const warn = c.key === "status" && (v === "결근" || v === "누락" || v === "지각");
                    return (
                      <td key={c.key} className={`px-2 py-1.5 whitespace-nowrap ${warn ? "text-red-600 font-medium" : ""}`}>
                        {v || "-"}
                        {/* 수정된 기록 — 원래 시각·사유·수정/승인자(#219-15) */}
                        {c.key === "status" && <EditedMark edit={r.c.edit} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 text-xs text-gray-400 border-t">{listRows.length}건 · 휴게는 실제 근무 간격 기준(4.5시간 이상 30분, 9시간 이상 1시간)</div>
        </div>
      )}
      </>)}
    </div>
  );
}
