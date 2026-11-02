"use client";

// 재무팀 — 전 직원 전자계약 보기 · PDF 받기(2026-11-02 디렉터 회의 5번, 디렉터 결정 「열람 + PDF 받기」)
// 보내기 · 결재 · 고치기 · 지우기는 없다. 목록은 api/finance/contracts, 파일은 api/contracts/[id]/signed-document(PDF 만).
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, Download, FileSignature } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Row = { id: string; title: string; status: string; createdAt: string; signedAt: string | null; docNo: string | null; name: string; branch: string | null; empNo: number | null; external: boolean; resigned: boolean };

const STATUS_LABEL: Record<string, string> = { SENT: "서명 진행 중", APPROVED: "서명 진행 중", SIGNED: "체결 완료", REJECTED: "반려", EXPIRED: "기한 만료", REVOKED: "회수" };
const selectCls = "h-9 rounded-md border border-gray-300 bg-white px-2 text-sm";

export default function FinanceContractsPage() {
  const [status, setStatus] = useState("signed");
  const [year, setYear] = useState("");
  const [branch, setBranch] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");   // 찾기 버튼 · 엔터로 확정한 검색어
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(500);
  const [branches, setBranches] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    const sp = new URLSearchParams({ status });
    if (year) sp.set("year", year);
    if (branch) sp.set("branch", branch);
    if (query) sp.set("q", query);
    fetch(`/api/finance/contracts?${sp}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || "목록을 불러오지 못했습니다."); setRows([]); return; }
      setRows(d.contracts || []); setTotal(d.total ?? 0); setLimit(d.limit ?? 500); setBranches(d.branches || []);
    }).catch(() => { toast.error("목록을 불러오지 못했습니다."); setRows([]); });
  }, [status, year, branch, query]);
  useEffect(() => { load(); }, [load]);

  // PDF 받기 — <a href> 로 열면 오류 응답(JSON)이 원문 페이지로 넘어가 화면을 잃는다 → fetch 로 받아 저장
  async function download(r: Row) {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/contracts/${r.id}/signed-document?pdf=1`);
      if (!res.ok) { const x = await res.json().catch(() => ({})); toast.error(x.error || "PDF 를 받지 못했습니다."); return; }
      const blob = await res.blob();
      const m = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") || "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = m ? decodeURIComponent(m[1]) : `${r.title}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch { toast.error("PDF 를 받지 못했습니다. 연결을 확인하고 다시 시도해주세요."); }
    finally { setBusy(null); }
  }

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 2019 }, (_, i) => String(thisYear - i));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><FileSignature className="text-indigo-600" size={22} />전 직원 전자계약</h1>
        <p className="text-sm text-gray-500 mt-1">계약서를 화면에서 보거나 PDF 로 받을 수 있습니다. 계약서를 보내거나 고치는 일은 직영사업본부에 문의해 주세요.</p>
      </div>
      <Card><CardContent className="pt-5 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="signed">체결 완료</option>
            <option value="progress">서명 진행 중</option>
            <option value="all">전체(초안 제외)</option>
          </select>
          <select className={selectCls} value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">작성 연도 전체</option>
            {years.map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
          <select className={selectCls} value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">전 지점</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 서류 이름" className="h-9 w-52" />
            <Button type="submit" size="sm" variant="outline" className="h-9">찾기</Button>
          </form>
          <span className="ml-auto text-xs text-gray-500">{rows ? `${total.toLocaleString()}건${total > limit ? ` 중 최근 ${limit}건 표시 — 조건을 좁혀 주세요` : ""}` : ""}</span>
        </div>
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-gray-50 text-gray-600 text-xs">
              <tr><th className="text-left p-2">이름</th><th className="text-left p-2">지점</th><th className="text-left p-2">서류</th><th className="text-left p-2">상태</th><th className="text-left p-2">체결일</th><th className="text-left p-2">작성일</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{r.name}{r.external && <span className="ml-1 text-xs text-gray-400">외부</span>}{r.resigned && <span className="ml-1 text-xs text-gray-400">퇴사</span>}</td>
                  <td className="p-2 whitespace-nowrap text-gray-600">{r.branch ?? "-"}</td>
                  <td className="p-2">{r.title}{r.docNo && <span className="block text-[11px] text-gray-400">{r.docNo}</span>}</td>
                  <td className="p-2 whitespace-nowrap">{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td className="p-2 whitespace-nowrap text-gray-600">{r.signedAt ? format(new Date(r.signedAt), "yyyy-MM-dd") : "-"}</td>
                  <td className="p-2 whitespace-nowrap text-gray-600">{format(new Date(r.createdAt), "yyyy-MM-dd")}</td>
                  <td className="p-2 whitespace-nowrap text-right space-x-1">
                    {r.status !== "REJECTED" && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => window.open(`/api/contracts/${r.id}/signed-document?pdf=1&inline=1`, "_blank", "noopener")}><Eye size={12} />보기</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy === r.id} onClick={() => download(r)}><Download size={12} />{busy === r.id ? "받는 중…" : "PDF"}</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {rows !== null && !rows.length && <tr><td colSpan={7} className="p-6 text-center text-gray-400">조건에 맞는 계약서가 없습니다.</td></tr>}
              {rows === null && <tr><td colSpan={7} className="p-6 text-center text-gray-400">불러오는 중…</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">서명 진행 중인 계약서는 지금까지 된 서명까지만 담긴 「서명진행본」으로 열립니다. 아직 서명이 하나도 없으면 열리지 않습니다.</p>
      </CardContent></Card>
    </div>
  );
}
