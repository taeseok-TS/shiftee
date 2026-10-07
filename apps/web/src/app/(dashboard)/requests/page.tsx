"use client";

// 내 요청(2026-10-07 QA76 #51 #43 #76) — 휴가·휴가 취소·근무일정·출퇴근 요청을 한 목록으로.
// 「내 요청」은 누구나, 「내가 처리한 것」은 결재한 적이 있는 사람(원장·본부·원장대행)에게 의미가 있다.
// 결재하기는 각 결재함에서 — 여기는 보기·찾기 전용이다.
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Inbox } from "lucide-react";

type Item = {
  kind: "LEAVE" | "LEAVE_CANCEL" | "SCHEDULE" | "ATTENDANCE";
  id: string; title: string; period: string; requester: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: string;
  progress: { done: number; total: number } | null;
  lastComment: { by: string; text: string } | null;
  rejectReason: string | null;
  myDecision?: "APPROVED" | "REJECTED";
};

const KIND: Record<Item["kind"], { label: string; cls: string }> = {
  LEAVE: { label: "휴가", cls: "bg-blue-50 text-blue-700" },
  LEAVE_CANCEL: { label: "휴가 취소", cls: "bg-orange-50 text-orange-700" },
  SCHEDULE: { label: "근무일정", cls: "bg-emerald-50 text-emerald-700" },
  ATTENDANCE: { label: "출퇴근", cls: "bg-violet-50 text-violet-700" },
};
const STATUS: Record<Item["status"], { label: string; cls: string }> = {
  PENDING: { label: "진행 중", cls: "bg-amber-100 text-amber-700" },
  APPROVED: { label: "승인", cls: "bg-green-100 text-green-700" },
  REJECTED: { label: "반려", cls: "bg-red-100 text-red-700" },
  CANCELLED: { label: "취소", cls: "bg-gray-100 text-gray-500" },
};
const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

export default function RequestsPage() {
  const [who, setWho] = useState<"mine" | "decided">("mine");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ who });
    if (status) p.set("status", status);
    if (kind) p.set("kind", kind);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (q.trim()) p.set("q", q.trim());
    try {
      const res = await fetch(`/api/requests?${p}`);
      const d = await res.json().catch(() => ({}));
      setItems(res.ok ? d.items || [] : []);
    } catch { setItems([]); }
  }, [who, status, kind, from, to, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const chip = (on: boolean) => `px-3 py-1.5 text-sm font-medium border-r last:border-r-0 ${on ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Inbox size={22} />내 요청</h1>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-white border rounded-lg overflow-hidden shadow-sm">
          <button className={chip(who === "mine")} onClick={() => setWho("mine")}>내가 올린 요청</button>
          <button className={chip(who === "decided")} onClick={() => setWho("decided")}>내가 처리한 것</button>
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 rounded border px-2 text-sm bg-white">
          <option value="">전체 종류</option>
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded border px-2 text-sm bg-white">
          <option value="">전체 상태</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-gray-500">올린 날</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded border px-1" />
          <span>~</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 rounded border px-1" />
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·이름·의견 검색" className="h-8 w-52 text-sm" />
      </div>
      <Card>
        <CardContent className="p-0">
          {items === null ? (
            <div className="p-8 text-center text-sm text-gray-400">불러오는 중…</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">{who === "mine" ? "올린 요청이 없습니다." : "처리한 요청이 없습니다."}</div>
          ) : (
            <ul className="divide-y">
              {items.map((i) => (
                <li key={`${i.kind}:${i.id}`} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded ${KIND[i.kind].cls}`}>{KIND[i.kind].label}</span>
                    <span className="font-medium text-gray-900">{i.title}</span>
                    <span className="text-gray-500">{i.period}</span>
                    {who === "decided" && <span className="text-gray-500">· {i.requester}</span>}
                    <span className={`ml-auto text-[11px] px-1.5 py-0.5 rounded ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span>
                    {i.progress && i.progress.total > 1 && <span className="text-[11px] text-gray-400">결재 {i.progress.done}/{i.progress.total}</span>}
                    {i.myDecision && <span className="text-[11px] text-gray-400">· 내가 {i.myDecision === "APPROVED" ? "승인" : "반려"}</span>}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    올린 시각 {kst(i.createdAt)}
                    {i.lastComment && <span className="ml-2">· 💬 {i.lastComment.by}: {i.lastComment.text}</span>}
                    {i.status === "REJECTED" && i.rejectReason && !i.lastComment && <span className="ml-2 text-red-600">· 반려 사유: {i.rejectReason}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-gray-400">결재하기는 각 결재함에서 합니다. 이 화면은 보기·찾기 전용입니다. 최근 500건까지 보입니다.</p>
    </div>
  );
}
