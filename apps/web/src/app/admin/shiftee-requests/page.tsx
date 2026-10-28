"use client";
// 근태 › 시프티 기록 — 시프티(2026-10-31 종료)에서 올린 요청·승인 기록 22,057건(2021~2026)과 첨부 사진의 **읽기 전용** 보관 화면
// (2026-10-26 디렉터 승인 「요청이력은 표+화면으로」). 법정 보존·분쟁 조회용 — 고치거나 지우는 기능은 없다.
//  · 필터 한 줄(이름·요청번호 검색 · 종류 · 상태 · 기간 · 지점) — 바뀌면 1쪽부터 다시 서버에서 받는다(50건씩)
//  · 줄을 누르면 요청내용 JSON 을 키 그대로 표로 펼친 상세 + 첨부 사진(전용 라우트 api/shiftee-requests/[id]/attachment)
//  · 폰은 카드(md 아래) — 표와 같은 정보·같은 누르기
//  · 지점·종류 고르기 목록은 기록에 실제로 있는 값(?facets=1) — 2021~2026 지점명은 지금 지점 표와 다를 수 있다
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Paperclip, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHead, Btn, Box, FilterRow, inputClass, tableClass, Cell2, StatusPill } from "@/components/kit";
import { SHIFTEE_STATUS_OPTIONS, fmtKstDateTime, fmtKstRange, isIsoDateTime, shifteeStatusTone } from "@/lib/shiftee-request";

type Row = {
  id: string; userId: string | null; empNo: string | null; name: string; branch: string | null;
  kind: string; kindLabel: string; status: string; statusLabel: string; step: number | null; cancelled: boolean;
  requestedAt: string; content: unknown; approver: string | null; comment: string | null; attachments: string[]; summary: string;
};
type Facets = { branches: { name: string; count: number }[]; kinds: { key: string; label: string; count: number }[] };
type Filters = { q: string; kind: string; status: string; from: string; to: string; branch: string };
const EMPTY: Filters = { q: "", kind: "", status: "", from: "", to: "", branch: "" };

/* ── 요청내용 값 하나를 사람이 읽게 — ISO 시각은 KST, [시작,끝] 쌍은 기간, 비면 「—」, 안쪽 객체·배열은 표를 겹쳐 그린다 ── */
function Val({ v, depth = 0 }: { v: unknown; depth?: number }) {
  if (v === null || v === undefined || v === "") return <span className="text-[#94a3b8]">—</span>;
  if (typeof v === "boolean") return <>{v ? "예" : "아니요"}</>;
  if (typeof v === "number") return <span className="tabular-nums">{v}</span>;
  if (isIsoDateTime(v)) return <span title={v}>{fmtKstDateTime(v) ?? v}</span>;
  if (typeof v === "string") return <span className="whitespace-pre-wrap break-words">{v}</span>;
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-[#94a3b8]">(없음)</span>;
    if (v.length === 2 && isIsoDateTime(v[0]) && isIsoDateTime(v[1])) return <span title={`${v[0]} ~ ${v[1]}`}>{fmtKstRange(v[0], v[1])}</span>;
    if (v.every((x) => x === null || typeof x !== "object")) return <>{v.map((x, i) => <span key={i}>{i > 0 && ", "}<Val v={x} depth={depth + 1} /></span>)}</>;
    return <div className="space-y-1.5">{v.map((x, i) => <div key={i} className="rounded-lg border border-[#eef1f5] p-2"><Val v={x} depth={depth + 1} /></div>)}</div>;
  }
  if (typeof v === "object") return <KeyTable obj={v as Record<string, unknown>} depth={depth + 1} />;
  return <>{String(v)}</>;
}
function KeyTable({ obj, depth = 0 }: { obj: Record<string, unknown>; depth?: number }) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return <span className="text-[#94a3b8]">(비어 있음)</span>;
  return (
    <table className={`w-full border-collapse text-[13px] ${depth > 0 ? "" : "[&_tr:last-child_td]:border-b-0"}`}>
      <tbody>
        {keys.map((k) => (
          <tr key={k}>
            <td className="w-[38%] border-b border-[#f1f5f9] py-1.5 pr-3 align-top font-mono text-[12px] text-[#596578] break-all">{k}</td>
            <td className="border-b border-[#f1f5f9] py-1.5 align-top text-[#0f172a]"><Val v={obj[k]} depth={depth} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ShifteeRequestsPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [qInput, setQInput] = useState("");          // 검색칸 입력(엔터·검색 버튼으로 filters.q 에 반영)
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<Facets>({ branches: [], kinds: [] });
  const [open, setOpen] = useState<Row | null>(null);
  const seq = useRef(0);   // 늦게 온 응답이 새 목록을 덮지 않게

  const load = useCallback(async (f: Filters, p: number) => {
    const my = ++seq.current;
    setLoading(true); setError(null);
    try {
      const u = new URLSearchParams({ page: String(p) });
      (Object.keys(f) as (keyof Filters)[]).forEach((k) => { if (f[k]) u.set(k, f[k]); });
      const res = await fetch(`/api/shiftee-requests?${u.toString()}`);
      const d = await res.json().catch(() => ({}));
      if (my !== seq.current) return;
      if (!res.ok) { setError(d.error || "불러오지 못했습니다."); setRows([]); setTotal(0); setPages(1); return; }
      setRows(d.rows || []); setTotal(d.total || 0); setPages(d.pages || 1);
    } catch {
      if (my !== seq.current) return;
      setError("서버에 연결하지 못했습니다.");
    } finally { if (my === seq.current) setLoading(false); }
  }, []);

  useEffect(() => {
    // 필터·쪽이 바뀌면 다시 — load 가 바로 로딩 표시를 켠다(변경 로그 화면과 같은 예외)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filters, page);
  }, [filters, page, load]);

  useEffect(() => {
    fetch("/api/shiftee-requests?facets=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setFacets({ branches: d.branches || [], kinds: d.kinds || [] }); })
      .catch(() => toast.error("지점·종류 목록을 불러오지 못했습니다."));
  }, []);

  const setF = (patch: Partial<Filters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const search = () => setF({ q: qInput.trim() });
  const reset = () => { setQInput(""); setFilters(EMPTY); setPage(1); };
  const dirty = useMemo(() => (Object.keys(filters) as (keyof Filters)[]).some((k) => !!filters[k]), [filters]);

  const attachmentUrl = (r: Row, name: string) => `/api/shiftee-requests/${encodeURIComponent(r.id)}/attachment?name=${encodeURIComponent(name)}`;
  const rowProps = (r: Row) => ({
    role: "button" as const, tabIndex: 0, onClick: () => setOpen(r),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(r); } },
  });
  const statusPill = (r: Row) => (
    <>
      <StatusPill tone={shifteeStatusTone(r.status)}>{r.statusLabel}</StatusPill>
      {r.cancelled && r.status !== "cancelled" && <span className="mt-0.5 block text-[12px] font-semibold text-[#596578]">취소됨</span>}
    </>
  );
  const attachBadge = (r: Row) => r.attachments.length > 0
    ? <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#4f46e5]"><Paperclip size={13} />{r.attachments.length}</span>
    : <span className="text-[#94a3b8]">—</span>;

  return (
    <div>
      <PageHead crumb="근태 › 시프티 기록" title="시프티 요청 기록(보관)" note="읽기 전용 · 시프티 2021~2026" />
      <p className="-mt-2 mb-4 text-[13.5px] text-[#596578]">2021~2026 시프티에서 올린 요청과 승인 기록입니다. 읽기만 됩니다.</p>

      <Box icon={<Archive />} tone="sl" title="요청 기록" sub={loading ? "불러오는 중…" : `${total.toLocaleString()}건`}>
        <FilterRow right={dirty ? <Btn kind="text" onClick={reset}>초기화</Btn> : undefined}>
          <form className="relative" onSubmit={(e) => { e.preventDefault(); search(); }}>
            <Search size={14} className="absolute left-2.5 top-[11px] text-[#94a3b8]" />
            <input type="search" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="이름 · 요청번호 · 승인자" maxLength={60}
              className={`${inputClass} w-56 pl-8`} aria-label="이름 · 요청번호 · 승인자 검색" />
          </form>
          <select value={filters.kind} onChange={(e) => setF({ kind: e.target.value })} className={inputClass} aria-label="종류">
            <option value="">종류: 전체</option>
            {facets.kinds.map((k) => <option key={k.key} value={k.key}>{k.label} ({k.count.toLocaleString()})</option>)}
          </select>
          <select value={filters.status} onChange={(e) => setF({ status: e.target.value })} className={inputClass} aria-label="상태">
            <option value="">상태: 전체</option>
            {SHIFTEE_STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span className="inline-flex items-center gap-1.5">
            <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setF({ from: e.target.value })} className={inputClass} aria-label="신청일 시작" />
            <span className="text-[13px] text-[#94a3b8]">~</span>
            <input type="date" max="9999-12-31" value={filters.to} min={filters.from || undefined} onChange={(e) => setF({ to: e.target.value })} className={inputClass} aria-label="신청일 끝" />
          </span>
          <select value={filters.branch} onChange={(e) => setF({ branch: e.target.value })} className={inputClass} aria-label="지점">
            <option value="">지점: 전체</option>
            {facets.branches.map((b) => <option key={b.name} value={b.name}>{b.name} ({b.count.toLocaleString()})</option>)}
          </select>
        </FilterRow>

        {error ? (
          <p className="px-6 py-8 text-center text-[14px] text-[#be123c]">{error}</p>
        ) : loading && rows.length === 0 ? (
          <p className="px-6 py-8 text-center text-[14px] text-[#94a3b8]">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="px-6 py-8 text-center text-[14px] text-[#94a3b8]">{dirty ? "조건에 맞는 기록이 없습니다." : "보관된 시프티 기록이 없습니다."}</p>
        ) : (<>
          {/* 넓은 화면 = 표. 줄을 누르면 상세 */}
          <div className="hidden overflow-x-auto md:block">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>신청일</th><th>이름</th><th>지점</th><th>종류</th><th>상태</th><th>요청 요약</th><th>승인자</th><th>코멘트</th><th className="text-right">첨부</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} {...rowProps(r)} className="cursor-pointer outline-none hover:bg-[#f8fafc] focus-visible:bg-[#eef2ff]">
                    <td className="whitespace-nowrap text-[#475569]">{fmtKstDateTime(r.requestedAt)}</td>
                    <td className="whitespace-nowrap"><Cell2 main={r.name} sub={r.empNo ? `사번 ${r.empNo}` : undefined} /></td>
                    <td className="whitespace-nowrap text-[#475569]">{r.branch || "—"}</td>
                    <td className="whitespace-nowrap">{r.kindLabel}</td>
                    <td className="whitespace-nowrap">{statusPill(r)}</td>
                    <td className="max-w-[26rem] text-[#0f172a]"><span className="line-clamp-2 break-words">{r.summary || "—"}</span></td>
                    <td className="whitespace-nowrap text-[#475569]">{r.approver || "—"}</td>
                    <td className="max-w-[14rem] text-[#475569]"><span className="line-clamp-2 break-words">{r.comment || "—"}</span></td>
                    <td className="whitespace-nowrap text-right">{attachBadge(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 휴대폰 = 카드 */}
          <div className="divide-y divide-[#f1f5f9] md:hidden">
            {rows.map((r) => (
              <div key={r.id} {...rowProps(r)} className="cursor-pointer px-4 py-3 outline-none focus-visible:bg-[#eef2ff]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-[#0f172a]">{r.name} <span className="text-[13.5px] font-semibold text-[#475569]">· {r.kindLabel}</span></p>
                    <p className="text-[12.5px] text-[#596578]">{fmtKstDateTime(r.requestedAt)}{r.branch ? ` · ${r.branch}` : ""}</p>
                  </div>
                  <div className="shrink-0 text-right">{statusPill(r)}</div>
                </div>
                {r.summary && <p className="mt-1.5 line-clamp-2 text-[14px] text-[#0f172a]">{r.summary}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12.5px] text-[#596578]">
                  {r.approver && <span>승인자 {r.approver}</span>}
                  {r.comment && <span className="truncate">코멘트 {r.comment}</span>}
                  {r.attachments.length > 0 && attachBadge(r)}
                </p>
              </div>
            ))}
          </div>
          {/* 쪽 넘기기 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#eef1f5] px-6 py-3 text-[13px] text-[#596578]">
            <span>{total.toLocaleString()}건 중 {((page - 1) * 50 + 1).toLocaleString()}~{Math.min(page * 50, total).toLocaleString()} · {page}/{pages}쪽</span>
            <span className="inline-flex gap-1.5">
              <Btn className="px-3 py-1.5" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>이전</Btn>
              <Btn className="px-3 py-1.5" disabled={page >= pages || loading} onClick={() => setPage((p) => Math.min(pages, p + 1))}>다음</Btn>
            </span>
          </div>
        </>)}
      </Box>

      {/* 상세 — 기본 정보 + 요청내용(키 그대로) + 첨부 사진 */}
      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{open ? `${open.name} · ${open.kindLabel}` : ""}</DialogTitle>
          </DialogHeader>
          {open && (
            <div className="space-y-4 text-[14px]">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px] sm:grid-cols-[auto_1fr_auto_1fr]">
                <dt className="text-[#596578]">신청일</dt><dd className="text-[#0f172a]">{fmtKstDateTime(open.requestedAt)}</dd>
                <dt className="text-[#596578]">요청번호</dt><dd className="tabular-nums text-[#0f172a]">{open.id}</dd>
                <dt className="text-[#596578]">이름</dt><dd className="text-[#0f172a]">{open.name}{open.empNo ? <span className="ml-1 text-[#596578]">(사번 {open.empNo})</span> : null}</dd>
                <dt className="text-[#596578]">지점</dt><dd className="text-[#0f172a]">{open.branch || "—"}</dd>
                <dt className="text-[#596578]">종류</dt><dd className="text-[#0f172a]">{open.kindLabel}{open.kindLabel !== open.kind && <span className="ml-1 font-mono text-[12px] text-[#94a3b8]">{open.kind}</span>}</dd>
                <dt className="text-[#596578]">상태</dt><dd>{statusPill(open)}{open.step !== null && <span className="ml-1.5 text-[12.5px] text-[#596578]">{open.step}단계</span>}</dd>
                <dt className="text-[#596578]">승인자</dt><dd className="text-[#0f172a]">{open.approver || "—"}</dd>
                <dt className="text-[#596578]">코멘트</dt><dd className="whitespace-pre-wrap break-words text-[#0f172a]">{open.comment || "—"}</dd>
                {!open.userId && <><dt className="text-[#596578]">큐브티 계정</dt><dd className="text-[#b45309]">매칭 안 됨(시프티 이름만)</dd></>}
              </dl>

              <section>
                <h3 className="mb-1.5 text-[13px] font-semibold text-[#596578]">요청내용(시프티 원문)</h3>
                <div className="rounded-xl border border-[#eef1f5] bg-[#fafbfd] px-3 py-1">
                  {open.content && typeof open.content === "object" && !Array.isArray(open.content)
                    ? <KeyTable obj={open.content as Record<string, unknown>} />
                    : <div className="py-1.5"><Val v={open.content} /></div>}
                </div>
              </section>

              {open.attachments.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-[13px] font-semibold text-[#596578]">첨부 사진 {open.attachments.length}장</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {open.attachments.map((name) => (
                      <a key={name} href={attachmentUrl(open, name)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-[#eef1f5] bg-white hover:border-[#c7d2fe]" title={name}>
                        {/* 전용 라우트가 권한을 다시 본다 — next/image 최적화는 쿠키를 싣지 않아 사설 사진에는 못 쓴다 */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={attachmentUrl(open, name)} alt={name} loading="lazy" className="aspect-square w-full object-cover" />
                        <span className="block truncate px-2 py-1 text-[11.5px] text-[#596578]">{name}</span>
                      </a>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
