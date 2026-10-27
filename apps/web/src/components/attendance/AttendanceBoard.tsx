"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Box, Btn, Chip, FilterRow, PageHead, PillTabs, StatusPill, btnClass, inputClass, type PillTone } from "@/components/kit";
import EditedMark, { editExcelColumns } from "@/components/attendance/EditedMark";
import BoardPhoneToday from "@/components/attendance/BoardPhoneToday";
import { dayState, hasIn, hasOut, kstNow } from "@/components/attendance/board-state";
import type { AttendanceEditView } from "@/lib/attendance-edit";

/**
 * 전 직원 출퇴근기록 — 달력형·목록형(2026-10-07 QA #27 #28 #17 #52 #68 #82).
 * 본부(/admin/attendance-board)와 원장(/manager/team-attendance)이 **같은 컴포넌트**를 쓴다.
 * 원장은 서버가 담당 지점만 돌려준다. 데이터: GET /api/attendance/board
 * 원장 화면(2026-10-23 본부 요청 ■0-11 · ■2): 서버가 시각을 빼고(timesHidden) 보내면 칸마다 상태만(출근 · 지각 · 퇴근 · 퇴근 누락 ·
 * 미출근 · 휴가), 목록 · 엑셀에서도 시각 · 휴게 · 총 시간 열을 뺀다. 범례 안내는 「?」로 접고, 폰은 오늘 · 이번 주 목록이 먼저.
 * 본부 화면은 그대로(시각 보임).
 */

type Cell = {
  sched?: string; in?: string; out?: string; hasIn?: boolean; hasOut?: boolean; inPlace?: string | null; outPlace?: string | null; granted?: boolean;
  leave?: string; late?: boolean; missing?: boolean; absent?: boolean; pending?: boolean; workMin?: number; breakMin?: number;
  edit?: AttendanceEditView;   // 수정된 기록 — 원래 시각·사유·수정/승인자(#219-15)
};
type BoardUser = { id: string; name: string; empNo: number | null; branch: string | null; position: string | null; jobGroup: string | null; resigned: boolean; workDays: number };
type Board = { from: string; to: string; days: string[]; holidays: Record<string, true>; users: BoardUser[]; cells: Record<string, Record<string, Cell>>; truncated?: boolean;
  over49?: Record<string, { monday: string; sched: number; actual: number }[]>; timesHidden?: boolean };

type Kind = "normal" | "late" | "missing" | "absent" | "leave" | "pending";
const KIND_LABEL: Record<Kind, string> = { normal: "정상", late: "지각", missing: "누락", absent: "결근", leave: "휴가", pending: "승인 대기" };
// 원장 화면 범례 — 요청서 상태 이름(■0-11)
const MGR_KIND_LABEL: Record<Kind, string> = { normal: "출근 · 퇴근", late: "지각", missing: "퇴근 누락", absent: "미출근", leave: "휴가", pending: "승인 대기" };
const kindsOf = (c: Cell): Kind[] => {
  const k: Kind[] = [];
  if (c.leave) k.push("leave");
  if (c.pending) k.push("pending");
  if (c.absent) k.push("absent");
  if (c.missing) k.push("missing");
  if (c.late) k.push("late");
  if (hasIn(c) && !c.late && !c.missing) k.push("normal");
  return k;
};
const statusText = (c: Cell) => {
  const base = c.pending ? "승인 대기" : c.absent ? "결근" : c.missing ? "누락" : c.late ? "지각" : hasIn(c) ? "정상" : "";
  // 반차처럼 휴가와 출근이 같이 있는 날은 둘 다 보인다(목록·엑셀에서 휴가 정보가 사라지지 않게)
  return c.leave ? (base ? `${base} · ${c.leave}` : c.leave) : base;
};
// 상태 알약 색(R10) — 누락 · 결근 분홍 · 지각 · 승인 대기 주황 · 휴가만 파랑 · 정상 회색
const statusTone = (c: Cell): PillTone => (c.absent || c.missing ? "rej" : c.pending || c.late ? "wait" : c.leave && !hasIn(c) ? "done" : "gray");
// 원장 화면(시각 없음)의 한 마디 상태 — 출근 · 지각 · 퇴근 · 퇴근 누락 · 미출근 · 휴가(반차와 출근이 같이 있으면 둘 다)
const stateText = (c: Cell, d: string, today: string, nowMin: number) => {
  const s = dayState(c, d, today, nowMin);
  const base = s?.label ?? "";
  return c.leave && hasIn(c) ? (base ? `${base} · ${c.leave}` : c.leave) : base;
};

// 지점 색 띠 — 이름으로 정해지는 색(지점이 늘어도 따로 정할 필요 없음). 초록 계열은 뺐다(R10 — 초록 없음, 개수는 그대로 10)
const BRANCH_COLORS = ["#3b82f6", "#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#64748b", "#ec4899", "#6366f1", "#a855f7", "#f97316"];
const branchColor = (b: string | null) => {
  if (!b) return "#9ca3af";
  let h = 0;
  for (const ch of b) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BRANCH_COLORS[h % BRANCH_COLORS.length];
};
// 달력 칸 글자색 — 상태 알약 색과 같은 뜻(문제 분홍 · 대기 주황 · 휴가 파랑 · 출근 인디고 · 그 밖 회색)
const CELL_TONE: Record<PillTone, string> = { rej: "text-[#be123c]", wait: "text-[#b45309]", done: "text-[#1d4ed8]", ind: "text-[#4f46e5]", gray: "text-[#475569]" };
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
  const [helpOpen, setHelpOpen] = useState(false);          // 원장 — 범례 안내 「?」
  const [monthOnPhone, setMonthOnPhone] = useState(false);  // 원장 폰 — 한 달 표를 열었나(처음엔 오늘 · 이번 주 목록)
  const [{ today, nowMin }] = useState(kstNow);
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
    fetch("/api/branches?pick=1").then((r) => (r.ok ? r.json() : null)).then((d) => {   // 숨긴 지점(테스트 · 통계 제외)은 고르기에서 뺀다
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
        if (!c || !(c.sched || hasIn(c) || hasOut(c) || c.leave || c.pending)) continue;
        if (!kindsOf(c).some((k) => kinds.has(k))) continue;
        out.push({ u, d, c });
      }
    }
    return out;
  }, [board, kinds]);

  const mgr = scope === "manager";
  const hidden = !!board?.timesHidden;   // 서버가 시각을 뺐다(원장 · 「출퇴근 시각 보기」 끔)
  const kindLabel = mgr ? MGR_KIND_LABEL : KIND_LABEL;
  const TIME_COLS = new Set(["in", "out", "break", "work"]);
  const ALL_COLS: { key: string; label: string; get: (r: { u: BoardUser; d: string; c: Cell }) => string }[] = [
    { key: "empNo", label: "사번", get: (r) => (r.u.empNo == null ? "" : String(r.u.empNo)) },
    { key: "name", label: "직원", get: (r) => r.u.name },
    // 좁은 칸 날짜 「10/3 (금)」 · 시간 「13:00–22:00」(■4 표기 규칙)
    { key: "date", label: "날짜", get: (r) => `${Number(r.d.slice(5, 7))}/${Number(r.d.slice(8, 10))} (${WEEK[dow(r.d)]})` },
    { key: "sched", label: "근무일정", get: (r) => r.c.sched?.replace("-", "–") ?? "" },
    { key: "branch", label: "지점", get: (r) => r.u.branch ?? "" },
    { key: "job", label: "직무", get: (r) => r.u.jobGroup || r.u.position || "" },
    { key: "in", label: "출근", get: (r) => r.c.in ?? "" },
    { key: "inPlace", label: "출근 장소", get: (r) => r.c.inPlace ?? "" },
    { key: "out", label: "퇴근", get: (r) => r.c.out ?? "" },
    { key: "outPlace", label: "퇴근 장소", get: (r) => r.c.outPlace ?? "" },
    { key: "break", label: "휴게", get: (r) => fmtH(r.c.breakMin) },
    { key: "work", label: "총 시간", get: (r) => fmtH(r.c.workMin) },
    { key: "status", label: "상태", get: (r) => (hidden ? stateText(r.c, r.d, today, nowMin) : statusText(r.c)) },
  ];
  // 시각을 뺀 응답이면 출근 · 퇴근 시각 · 휴게 · 총 시간 열도 뺀다(■0-11)
  const COLS = hidden ? ALL_COLS.filter((c) => !TIME_COLS.has(c.key)) : ALL_COLS;
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
    const data = src.map((r) => ({ ...Object.fromEntries(COLS.map((c) => [c.label, c.get(r)])), ...(hidden ? {} : editExcelColumns(r.c.edit)) }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "출퇴근기록");
    XLSX.writeFile(wb, `출퇴근기록_${ym}${picked.length ? `_${picked.join("·")}` : ""}.xlsx`);
  };

  const toggleKind = (k: Kind) => setKinds((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const togglePick = (b: string) => { setLoading(true); setPicked((p) => (p.includes(b) ? p.filter((x) => x !== b) : [...p, b])); };

  const monthLabel = `${ym.replace("-", "년 ")}월`;
  const excelBtn = <Btn onClick={exportExcel}><Download size={14} />엑셀</Btn>;
  // 달력형 · 목록형 — 원장 화면은 머리 아래 알약 탭 한 줄(R10), 본부 「달력 · 목록」 탭 안(embedded)은 위에 이미 알약 탭이 있어 필터 줄의 알약으로(탭 두 겹 금지)
  const viewTabs = [{ key: "calendar", label: "달력형" }, { key: "list", label: "목록형" }];

  return (
    <div>
      {!embedded && (
        <>
          <PageHead crumb={scope === "admin" ? "근태 › 출퇴근 현황" : "근태 › 지점 출퇴근기록"} title={scope === "admin" ? "출퇴근기록" : "지점 출퇴근기록"}>
            {excelBtn}
          </PageHead>
          <PillTabs tabs={viewTabs} value={view} onChange={(k) => setView(k as typeof view)} className={mgr && !monthOnPhone ? "hidden sm:flex" : undefined} />
        </>
      )}

      {/* 원장 폰 — 한 달(31칸) 표 대신 오늘 · 이번 주 목록 먼저(■2 · 시안 S2-3). 한 달 표는 「한 달 표 보기」로 */}
      {mgr && !monthOnPhone && <BoardPhoneToday branches={picked} onShowMonth={() => setMonthOnPhone(true)} />}

      {scope === "admin" && !embedded && (
        <Box icon={<Download />} tone="sl" title="주말 근무 엑셀" sub="토·일·공휴일 · 원장 포함 · 본부 양식(직영 재직자 급여 자료)">
          <div className="flex flex-wrap items-center gap-2 px-6 py-4 text-[13.5px] text-[#475569]">
            <input type="date" aria-label="시작일" className={inputClass} value={wk.from} onChange={(e) => setWk((w) => ({ ...w, from: e.target.value }))} />
            <span>~</span>
            <input type="date" aria-label="종료일" className={inputClass} value={wk.to} onChange={(e) => setWk((w) => ({ ...w, to: e.target.value }))} />
            <a className={btnClass("secondary")}
              href={`/api/attendance/weekend-export?from=${wk.from}&to=${wk.to}`}
              onClick={(e) => {
                const days = (new Date(wk.to).getTime() - new Date(wk.from).getTime()) / 86400_000;
                if (!wk.from || !wk.to || days < 0) { e.preventDefault(); toast.error("기간을 확인해 주세요."); }
                else if (days > 93) { e.preventDefault(); toast.error("한 번에 3개월까지 받을 수 있습니다."); }
              }}>
              <Download size={14} />받기
            </a>
          </div>
        </Box>
      )}

      <Box icon={<CalendarDays />} tone="ind" title="출퇴근기록"
        sub={`${monthLabel}${board && !loading ? ` · ${board.users.length}명` : ""}`}
        right={embedded ? excelBtn : undefined} className={mgr && !monthOnPhone ? "hidden sm:block" : undefined}>
        <FilterRow
          right={/* 범례 = 알약 필터(R10) — 칸 색: 휴가 연파랑 · 누락·결근 연분홍 · 지각 연노랑, 초록 칸 없음 */
            <>
              {(Object.keys(kindLabel) as Kind[]).map((k) => <Chip key={k} on={kinds.has(k)} onClick={() => toggleKind(k)}>{kindLabel[k]}</Chip>)}
              {/* 원장 — 범례 안내는 「?」로 접는다(■2) */}
              {mgr && (
                <button type="button" aria-label="범례 안내" aria-expanded={helpOpen} onClick={() => setHelpOpen((o) => !o)}
                  className="grid h-[30px] w-[30px] place-items-center rounded-full border border-[#e2e8f0] bg-white text-[13px] font-bold text-[#475569] hover:bg-[#f8fafc] after:absolute after:-inset-[7px] after:content-[''] relative">?</button>
              )}
            </>}>
          {embedded && viewTabs.map((t) => <Chip key={t.key} on={view === t.key} onClick={() => setView(t.key as typeof view)}>{t.label}</Chip>)}
          {embedded && <span className="mx-0.5 h-5 w-px bg-[#e2e8f0]" aria-hidden />}
          <div className="flex items-center gap-1">
            <Btn className="px-2" onClick={() => moveMonth(-1)} aria-label="이전 달"><ChevronLeft size={16} /></Btn>
            <span className="w-24 text-center text-[14px] font-bold text-[#0f172a]">{monthLabel}</span>
            <Btn className="px-2" onClick={() => moveMonth(1)} aria-label="다음 달"><ChevronRight size={16} /></Btn>
          </div>
          <div className="relative" ref={branchBox}>
            <button type="button" className={inputClass} onClick={() => setBranchOpen((o) => !o)} aria-expanded={branchOpen}>
              지점: {picked.length ? (picked.length > 2 ? `${picked.slice(0, 2).join(", ")} 외 ${picked.length - 2}` : picked.join(", ")) : "전체"} ▾
            </button>
            {branchOpen && (
              <div className="absolute left-0 z-20 mt-1 max-h-80 w-56 overflow-auto rounded-[10px] border border-[#e2e8f0] bg-white p-2 shadow-lg">
                <button type="button" className="w-full rounded px-2 py-1 text-left text-[13.5px] hover:bg-[#f8fafc]" onClick={() => { if (picked.length) { setLoading(true); setPicked([]); } }}>전체</button>
                {branchOptions.map((b) => (
                  <label key={b} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13.5px] hover:bg-[#f8fafc]">
                    <input type="checkbox" className="accent-[#4f46e5]" checked={picked.includes(b)} onChange={() => togglePick(b)} />
                    <span className="h-2 w-2 rounded-full" style={{ background: branchColor(b) }} />
                    {b}
                  </label>
                ))}
              </div>
            )}
          </div>
          <select className={inputClass} aria-label="재직 구분" value={emp} onChange={(e) => { setLoading(true); setEmp(e.target.value as typeof emp); }}>
            <option value="active">재직</option>
            <option value="resigned">퇴사</option>
            <option value="all">전체</option>
          </select>
        </FilterRow>
        {(!mgr || helpOpen || (board?.truncated && !loading)) && (
          <p className="border-b border-[#eef1f5] px-6 py-2 text-[12.5px] text-[#596578]">
            {(!mgr || helpOpen) && (mgr
              ? `오른쪽 알약을 눌러서 켜고 끄기 · 미출근은 근무일정이 있는 지난 날에 기록이 없을 때 · 출퇴근 시각은 본부만 봅니다`
              : "오른쪽 알약을 눌러서 켜고 끄기 · 결근은 근무일정이 있는 지난 날에 기록이 없을 때")}
            {board?.truncated && !loading && <span className="ml-2 font-semibold text-[#b45309]">직원이 1000명을 넘어 앞의 1000명만 보입니다. 지점을 골라 좁혀 주세요.</span>}
          </p>
        )}

      {loading ? (
        <div className="py-16 text-center text-[14px] text-[#596578]"><Loader2 className="mr-2 inline animate-spin" size={18} />불러오는 중…</div>
      ) : !board || board.users.length === 0 ? (
        <div className="py-12 text-center text-[14px] text-[#596578]">표시할 직원이 없습니다.</div>
      ) : (<>
      {view === "calendar" ? (
        <div className="max-h-[75vh] overflow-auto rounded-b-[14px]">
          <table className="border-collapse text-xs [&_td]:border-[#eef1f5] [&_th]:border-[#eef1f5]">
            <thead className="sticky top-0 z-10 bg-[#fafbfd]">
              <tr>
                <th className="sticky left-0 z-20 min-w-[130px] border bg-[#fafbfd] px-2 py-2 text-left text-[13px] font-semibold text-[#596578]">직원</th>
                {board.days.map((d) => {
                  const w = dow(d), hol = board.holidays[d];
                  return (
                    <th key={d} className={`min-w-[52px] border px-1 py-1 font-semibold ${hol || w === 0 || w === 6 ? "text-[#64748b]" : "text-[#596578]"}`}>
                      {Number(d.slice(8))}<div className="font-normal">{WEEK[w]}</div>
                    </th>
                  );
                })}
                <th className="min-w-[48px] border px-2 py-1 font-semibold text-[#596578]">출근일</th>
              </tr>
            </thead>
            <tbody>
              {board.users.map((u) => (
                <tr key={u.id}>
                  <td className="sticky left-0 z-10 whitespace-nowrap border bg-white px-2 py-1" style={{ boxShadow: `inset 4px 0 0 ${branchColor(u.branch)}` }}>
                    <span className="font-bold text-[#0f172a]">{u.name}</span>
                    <span className="text-[#596578]"> · {u.branch ?? "-"}</span>
                    {u.resigned && <span className="ml-1 text-[#94a3b8]">(퇴사)</span>}
                    {/* 주 49시간 초과(근무일정 또는 실제, #38) — 처리할 것이라 빨강 */}
                    {board.over49?.[u.id]?.length ? (
                      <span className="ml-1 font-semibold text-[#dc2626]"
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
                      <td key={d} className={`border px-1 py-1 text-center align-middle text-[#334155] ${!show ? (hol ? "bg-[#f8fafc]" : "") : c?.absent || c?.missing ? "bg-[#fff1f2]" : c?.late ? (hidden ? "bg-[#fff1f2]" : "bg-[#fffbeb]") : c?.leave && !hasIn(c) ? "bg-[#eff6ff]" : hol ? "bg-[#f8fafc]" : ""}`}
                        title={c ? [c.sched && `일정 ${c.sched}`, c.inPlace && `출근 장소 ${c.inPlace}`, c.outPlace && `퇴근 장소 ${c.outPlace}`, ...(c.edit ? ["— 수정됨", ...c.edit.lines] : [])].filter(Boolean).join("\n") : undefined}>
                        {show && c && hidden && !(c.granted && (c.in || c.out)) ? (
                          /* 시각 없이 상태 한 마디(■0-11) — 「12:51 / 22:25」 대신 출근 · 지각 · 퇴근 · 퇴근 누락 · 미출근 · 휴가 */
                          (() => { const t = stateText(c, d, today, nowMin); const st = dayState(c, d, today, nowMin);
                            return t ? <span className={`whitespace-nowrap font-medium ${CELL_TONE[st?.tone ?? (c.leave ? "done" : "gray")]}`}>{t}</span> : null; })()
                        ) : show && c && (
                          c.absent ? <span className="text-[#be123c] font-medium">결근</span>
                          : c.leave && !c.in ? <span className="text-[#1d4ed8] font-medium">{c.leave}</span>
                          : (
                            <>
                              <div className={c.late ? "text-[#b45309] font-semibold" : ""}>{c.in ?? (c.pending ? <span className="text-[#b45309]">대기</span> : c.missing ? <span className="text-[#be123c]">누락</span> : "")}</div>
                              <div>{c.out ?? (c.missing ? <span className="text-[#be123c]">누락</span> : "")}</div>
                              {c.leave && <div className="text-[#1d4ed8]">{c.leave}</div>}
                              {c.edit && <div className="text-[10px] text-[#b45309]">수정됨</div>}
                              {hidden && c.granted && <div className="text-[10px] text-[#4f46e5]" title="본부가 승인한 출퇴근 기록 요청 기간 — 이 날짜만 시각이 보입니다">기록 요청 승인</div>}
                            </>
                          )
                        )}
                      </td>
                    );
                  })}
                  <td className="border px-2 py-1 text-center font-semibold text-[#0f172a]">{u.workDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <div className="max-h-[75vh] overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-[#fafbfd]">
                <tr>{COLS.map((c) => <th key={c.key} className="whitespace-nowrap border-b border-[#eef1f5] px-3 pb-2 pt-3 text-left text-[13px] font-semibold text-[#596578]">{c.label}</th>)}</tr>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} className="border-b border-[#eef1f5] px-1.5 pb-2">
                      <input className="h-7 w-full min-w-[56px] rounded-md border border-[#e2e8f0] bg-white px-2 text-xs font-normal text-[#334155] outline-none focus:border-[#c7d2fe]" placeholder="검색" aria-label={`${c.label} 검색`} value={colFilter[c.key] ?? ""}
                        onChange={(e) => setColFilter((f) => ({ ...f, [c.key]: e.target.value }))} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listRows.length === 0 ? (
                  <tr><td colSpan={COLS.length} className="py-10 text-center text-[14px] text-[#596578]">기록이 없습니다.</td></tr>
                ) : listRows.map((r) => (
                  <tr key={`${r.u.id}-${r.d}`} className="border-b border-[#f1f5f9] last:border-0 hover:bg-[#fafbfd]">
                    {COLS.map((c) => {
                      const v = c.get(r);
                      return (
                        <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${c.key === "name" ? "font-bold text-[#0f172a]" : "text-[#475569]"}`}>
                          {/* 상태 = 상태 알약(R10) — 누락 · 결근 분홍 · 지각 · 대기 주황 · 휴가 파랑 · 정상 회색 */}
                          {c.key === "status" && v ? <StatusPill tone={hidden ? (dayState(r.c, r.d, today, nowMin)?.tone ?? (r.c.leave ? "done" : "gray")) : statusTone(r.c)}>{v}</StatusPill> : (v || "-")}
                          {/* 수정된 기록 — 원래 시각·사유·수정/승인자(#219-15) */}
                          {c.key === "status" && <EditedMark edit={r.c.edit} />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[#eef1f5] px-6 py-2.5 text-[12.5px] text-[#596578]">{listRows.length}건{hidden ? "" : " · 휴게는 실제 근무 간격 기준(4.5시간 이상 30분, 9시간 이상 1시간)"}</div>
        </div>
      )}
      </>)}
      </Box>
    </div>
  );
}
