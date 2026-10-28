"use client";

// 내 요청(2026-10-07 QA76 #51 #43 #76) — 휴가·휴가 취소·근무일정·출퇴근 요청을 한 목록으로.
// 「내 요청」은 누구나, 「내가 처리한 것」은 결재한 적이 있는 사람(원장·본부·원장대행)에게 의미가 있다.
// 결재하기는 각 결재함에서 — 여기는 보기·찾기 전용이다.
// 직원 「내 요청」(/requests)과 관리자 결재함 › 처리한 요청(/admin/requests, embedded — 결재함 머리 아래라 제목만 뺀다. 토글은 둔다: 본부도 자기 휴가를 올린다)이 같이 쓴다.
// 새 톤(2026-10-21 본부 시안 「원장 · 직원 나머지 화면」): 표(종류 · 날짜 · 상태 알약 · 반려 사유). 위 머리 = kit PageHead(embedded 면 결재함 머리가 대신),
// 「내가 올린 요청 / 내가 처리한 것」은 필터 줄 오른쪽 알약 필터(Chip) — 결재함 화면 안에서 알약 탭이 두 줄이 되지 않게(R11 「탭은 한 줄만」).
import { useCallback, useEffect, useRef, useState } from "react";
import { Inbox, Search } from "lucide-react";
import { PageHead, Box, FilterRow, Chip, inputClass, tableClass, Cell2, StatusPill, type PillTone } from "@/components/kit";
import { fmtDayKo, fmtDayShort } from "@/lib/leave-period";

type Item = {
  kind: "LEAVE" | "LEAVE_CANCEL" | "SCHEDULE" | "ATTENDANCE";
  id: string; title: string; period: string; requester: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: string | null;   // 출퇴근 요청은 시각을 볼 수 없는 사람(직원 · 원장)에게 null — 그때는 createdDate(KST 날짜)만
  createdDate?: string;
  reason: string | null;
  progress: { done: number; total: number } | null;
  lastComment: { by: string; text: string } | null;
  rejectReason: string | null;
  myDecision?: "APPROVED" | "REJECTED";
};

// 종류는 글자로만(숫자·종류 색칠 없음 — 시안 원칙 2)
const KIND: Record<Item["kind"], { label: string }> = {
  LEAVE: { label: "휴가" },
  LEAVE_CANCEL: { label: "휴가 취소" },
  SCHEDULE: { label: "근무 변경" },
  ATTENDANCE: { label: "출퇴근 수정" },
};
// 상태 알약(kit) — 대기 주황 · 승인 파랑 · 반려 분홍 · 취소 회색
const STATUS: Record<Item["status"], { label: string; tone: PillTone }> = {
  PENDING: { label: "대기", tone: "wait" },
  APPROVED: { label: "승인", tone: "done" },
  REJECTED: { label: "반려", tone: "rej" },
  CANCELLED: { label: "취소", tone: "gray" },
};
const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
// 올린 때 — 시각이 오면 「올린 시각 2026-10-23 09:12」, 시각을 숨긴 출퇴근 요청은 날짜만 「올린 날 10월 23일 (금)」(좁은 카드는 「10/23 (금)」)
const uploaded = (i: Item, narrow = false) =>
  i.createdAt ? `올린 시각 ${kst(i.createdAt)}`
    : i.createdDate ? `올린 날 ${narrow ? fmtDayShort(i.createdDate) : fmtDayKo(i.createdDate)}`
    : "";

export default function RequestsView({ initialWho, embedded = false }: { initialWho: "mine" | "decided"; embedded?: boolean }) {
  const [who, setWho] = useState<"mine" | "decided">(initialWho);
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [limited, setLimited] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);   // 조건을 빨리 바꾸면 늦게 온 옛 응답이 새 목록을 덮지 않게

  const load = useCallback(async () => {
    const my = ++seq.current;
    const p = new URLSearchParams({ who });
    if (status) p.set("status", status);
    if (kind) p.set("kind", kind);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (q.trim()) p.set("q", q.trim());
    try {
      const res = await fetch(`/api/requests?${p}`);
      const d = await res.json().catch(() => ({}));
      if (my !== seq.current) return;
      setItems(res.ok ? d.items || [] : []); setLimited(res.ok && !!d.limited); setFailed(!res.ok);
    } catch { if (my === seq.current) { setItems([]); setLimited(false); setFailed(true); } }
  }, [who, status, kind, from, to, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const decided = who === "decided";
  // 칸 내용(표·카드 공용) — 모양만 둘이고 내용은 여기 하나
  const statusCell = (i: Item) => (
    <>
      <StatusPill tone={STATUS[i.status].tone}>{STATUS[i.status].label}</StatusPill>
      {i.progress && i.progress.total > 1 && <span className="mt-0.5 block whitespace-nowrap text-[12.5px] text-[#596578]">결재 {i.progress.done}/{i.progress.total}</span>}
      {i.myDecision && <span className="mt-0.5 block whitespace-nowrap text-[12.5px] text-[#596578]">내가 {i.myDecision === "APPROVED" ? "승인" : "반려"}</span>}
    </>
  );
  const notesCell = (i: Item) => {
    const rej = i.status === "REJECTED" && i.rejectReason && !i.lastComment;
    if (!i.reason && !i.lastComment && !rej) return <span className="text-[#94a3b8]">—</span>;
    return (
      <div className="space-y-0.5 text-[13px] text-[#475569]">
        {rej && <p className="font-semibold text-[#be123c]">반려 사유: {i.rejectReason}</p>}
        {i.lastComment && <p className={i.status === "REJECTED" ? "font-semibold text-[#be123c]" : undefined}>의견 {i.lastComment.by}: {i.lastComment.text}</p>}
        {i.reason && <p className="text-[#596578]">사유: {i.reason}</p>}
      </div>
    );
  };

  const title = initialWho === "decided" ? "처리한 요청" : "내 요청";
  return (
    <div>
      {!embedded && <PageHead crumb={initialWho === "decided" ? "결재 › 결재함" : "결재 › 내 요청"} title={title} />}
      <Box icon={<Inbox />} tone="sky" title={decided ? "내가 처리한 것" : "내가 올린 요청"}
        sub={items && !failed ? `${items.length}건` : undefined} className="!mb-3">
        <FilterRow right={<>
          <Chip on={who === "mine"} onClick={() => setWho("mine")}>내가 올린 요청</Chip>
          <Chip on={who === "decided"} onClick={() => setWho("decided")}>내가 처리한 것</Chip>
        </>}>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·이름·사유·의견 검색" aria-label="요청 찾기"
              className={`${inputClass} w-56 pl-8`} />
          </div>
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="종류" className={inputClass}>
            <option value="">전체 종류</option>
            {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="상태" className={inputClass}>
            <option value="">전체 상태</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <div className="flex flex-wrap items-center gap-1.5 text-[13.5px]">
            <span className="text-[#596578]">올린 날</span>
            <input type="date" max="9999-12-31" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="올린 날 시작" className={inputClass} />
            <span className="text-[#596578]">~</span>
            <input type="date" max="9999-12-31" value={to} onChange={(e) => setTo(e.target.value)} aria-label="올린 날 끝" className={inputClass} />
          </div>
        </FilterRow>

        {items === null ? (
          <div className="p-8 text-center text-[14px] text-[#596578]">불러오는 중…</div>
        ) : failed ? (
          <div className="p-8 text-center text-[14px] text-[#be123c]">불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-[14px] text-[#596578]">{decided ? "처리한 요청이 없습니다." : "올린 요청이 없습니다."}</div>
        ) : (<>
          {/* 넓은 화면은 표, 휴대폰(md 미만)은 카드 — 같은 칸 함수를 쓴다 */}
          <div className="hidden overflow-x-auto md:block">
            <table className={tableClass}>
              <thead>
                <tr>
                  {decided && <th className="whitespace-nowrap">요청자</th>}
                  <th className="whitespace-nowrap">종류</th>
                  <th className="whitespace-nowrap">날짜</th>
                  <th className="whitespace-nowrap">상태</th>
                  <th>반려 사유 · 의견</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={`${i.kind}:${i.id}`} className="hover:bg-[#fafbfd]">
                    {decided && <td className="whitespace-nowrap"><Cell2 main={i.requester} /></td>}
                    <td><Cell2 main={i.title} sub={KIND[i.kind].label} /></td>
                    <td className="whitespace-nowrap"><Cell2 main={<span className="font-semibold">{i.period}</span>} sub={uploaded(i) || undefined} /></td>
                    <td>{statusCell(i)}</td>
                    <td className="max-w-[28rem]">{notesCell(i)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-[#f1f5f9] md:hidden">
            {items.map((i) => (
              <div key={`${i.kind}:${i.id}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-[#596578]">{KIND[i.kind].label}{decided ? ` · ${i.requester}` : ""}</p>
                    <p className="font-bold text-[#0f172a]">{i.title}</p>
                    <p className="text-[13.5px] text-[#475569]">{i.period}</p>
                    {uploaded(i, true) && <p className="text-[12.5px] text-[#596578]">{uploaded(i, true)}</p>}
                  </div>
                  <div className="shrink-0 text-right">{statusCell(i)}</div>
                </div>
                {(i.reason || i.lastComment || (i.status === "REJECTED" && i.rejectReason)) && <div className="mt-2">{notesCell(i)}</div>}
              </div>
            ))}
          </div>
        </>)}
      </Box>
      {limited && <p className="mb-1 text-[12.5px] font-semibold text-[#b45309]">요청이 많아 최근 것까지만 보입니다. 올린 날 기간이나 검색어로 좁혀 주세요.</p>}
      <p className="text-[12.5px] text-[#596578]">결재하기는 각 결재함에서 합니다. 이 화면은 보기·찾기 전용입니다.</p>
    </div>
  );
}
