"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Download, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

/**
 * 연차 대장 화면 — 관리자(/admin/leave-ledger) · 원장(/manager/leave-ledger) · 직원(/leave/ledger)이
 * **같은 컴포넌트**를 쓴다(세 화면에 따로 만들면 한쪽만 고치는 짝 누락이 생긴다).
 * 대상·연도는 주소(?userId=&year=)로 받는다 — userId 가 없으면 본인.
 * 열람 권한은 서버(api/leave/ledger)가 판정하고, PDF 버튼은 서버가 준 canDownloadPdf(관리자만)로만 그린다.
 */

type Step = { order: number; role: string | null; approverName: string | null; status: string; decidedAt: string | null; comment: string | null };
type Ledger = {
  user: { id: string; name: string; branch: string | null; position: string | null; hireDate: string | null };
  year: number;
  balance: { total: number; used: number; remaining: number } | null;
  entries: {
    id: string; type: string; startDate: string; endDate: string; days: number; status: string; deductible: boolean;
    reason: string | null; rejectedReason: string | null; createdAt: string; steps: Step[];
    cancelRequests: { id: string; status: string; reason: string | null; rejectedReason: string | null; createdAt: string; steps: Step[] }[];
  }[];
  adjustments: { at: string; actorName: string; detail: string | null }[];
  summary: { approvedDeductibleDays: number; balanceUsed: number | null; match: boolean | null };
};

const TYPE_LABEL: Record<string, string> = {
  ANNUAL: "연차", HALF_AM: "오전반차", HALF_PM: "오후반차", QUARTER_AM: "오전반반차", QUARTER_PM: "오후반반차",
  SICK: "병가", PERSONAL: "개인휴가", SPECIAL: "특별휴가", COMPENSATORY: "대체휴무", COMPENSATORY_HALF: "대체휴무반차",
  CIVIL_DEFENSE: "민방위", RESERVE_FORCES: "예비군훈련", MATERNITY: "출산휴가", BEREAVEMENT: "상주휴가",
  FAMILY_EVENT: "경조사", FAMILY_MARRIAGE: "결혼", FAMILY_BIRTH: "출산", FAMILY_BEREAVEMENT: "사망(조사)",
};
const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "대기", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  APPROVED: { label: "승인", cls: "bg-green-50 text-green-700 border-green-200" },
  REJECTED: { label: "반려", cls: "bg-red-50 text-red-700 border-red-200" },
  CANCELLED: { label: "취소", cls: "bg-gray-100 text-gray-500 border-gray-200" },
  WAITING: { label: "대기 전", cls: "bg-gray-50 text-gray-500 border-gray-200" },
};
const ROLE_LABEL: Record<string, string> = { ADMIN: "관리자", MANAGER: "원장" };
/** 실제 시각 → "YYYY-MM-DD HH:mm"(KST) */
const kst = (s: string | null) =>
  s ? new Date(new Date(s).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") : "-";
const stepText = (st: Step) =>
  `${st.order}. ${ROLE_LABEL[st.role ?? ""] ?? "결재자"} ${st.approverName ?? ""} — ${STATUS[st.status]?.label ?? st.status}` +
  `${st.decidedAt ? ` ${kst(st.decidedAt)}` : ""}${st.comment ? ` (${st.comment})` : ""}`;

export default function LeaveLedgerView({ backHref, backLabel }: { backHref?: string; backLabel?: string }) {
  const [userId, setUserId] = useState<string | null>(null);   // null = 본인
  const [year, setYear] = useState<number>(() => new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear());
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<{ ledger: Ledger; canDownloadPdf: boolean } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const u = sp.get("userId");
    const y = Number(sp.get("year"));
    if (u) setUserId(u);
    if (Number.isInteger(y) && y >= 2020 && y <= 2100) setYear(y);
    setReady(true);
  }, []);

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({ year: String(year) });
      if (userId) q.set("userId", userId);
      const res = await fetch(`/api/leave/ledger?${q}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setData(null); setError(d.error || "연차 대장을 불러오지 못했습니다"); return; }
      setData(d);
    } catch {
      setData(null);
      setError("연차 대장을 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, [ready, userId, year]);
  useEffect(() => { load(); }, [load]);

  const moveYear = (delta: number) => {
    const y = year + delta;
    setYear(y);
    // 주소에도 남긴다 — 새로고침·링크 공유 시 같은 연도가 열린다
    const sp = new URLSearchParams(window.location.search);
    sp.set("year", String(y));
    window.history.replaceState(null, "", `${window.location.pathname}?${sp}`);
  };

  const downloadPdf = async () => {
    if (!data) return;
    setDownloading(true);
    try {
      const res = await fetch("/api/leave/ledger/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: data.ledger.user.id, year }),
      });
      if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error || "PDF 를 만들지 못했습니다"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `연차대장_${data.ledger.user.name}_${year}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("PDF 를 내려받지 못했습니다");
    } finally {
      setDownloading(false);
    }
  };

  const L = data?.ledger;
  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          {backHref && <a href={backHref} className="text-xs text-gray-500 hover:underline">← {backLabel ?? "돌아가기"}</a>}
          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            연차 대장{L ? ` — ${L.user.name}` : ""}
          </h1>
          {L && (
            <p className="text-sm text-gray-500 mt-0.5">
              {L.user.branch ?? "-"} · {L.user.position ?? "-"} · 입사 {L.user.hireDate ? L.user.hireDate.slice(0, 10) : "-"}
              <span className="ml-2 text-xs text-gray-400">연도 기준: 휴가를 쓰는 해(시작일)</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => moveYear(-1)}><ChevronLeft size={14} /></Button>
          <span className="text-sm font-semibold w-16 text-center">{year}년</span>
          <Button variant="outline" size="sm" onClick={() => moveYear(1)}><ChevronRight size={14} /></Button>
          {data?.canDownloadPdf && (
            <Button size="sm" className="gap-1" disabled={downloading || !L} onClick={downloadPdf}>
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}PDF 내려받기
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <Card><CardContent className="pt-6 text-center text-gray-500"><Loader2 className="inline-block animate-spin" /></CardContent></Card>
      ) : error ? (
        <Card><CardContent className="pt-6 text-center text-gray-500">
          <AlertCircle className="inline-block mb-2 text-gray-400" size={24} /><p>{error}</p>
        </CardContent></Card>
      ) : L ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs text-gray-500">{year}년 연차</p>
                {L.balance ? (
                  <p className="text-lg font-semibold text-gray-900 mt-1">
                    총 {L.balance.total}일 · 사용 {L.balance.used}일 · <span className="text-blue-700">잔여 {L.balance.remaining}일</span>
                  </p>
                ) : <p className="text-sm text-gray-500 mt-1">이 해의 연차 기록이 없습니다</p>}
              </CardContent>
            </Card>
            <Card className={L.summary.match === false ? "border-red-200" : ""}>
              <CardContent className="pt-5">
                <p className="text-xs text-gray-500">대조 — 승인된 연차 차감 휴가 합계 vs 잔여 기록의 사용</p>
                <p className={`text-lg font-semibold mt-1 ${L.summary.match === false ? "text-red-600" : "text-gray-900"}`}>
                  {L.summary.approvedDeductibleDays}일 / {L.summary.balanceUsed ?? "-"}일
                  <span className="text-sm font-normal ml-2">
                    {L.summary.match === null ? "비교할 기록 없음" : L.summary.match ? "일치" : "불일치 — 아래 잔여 조정 이력 확인"}
                  </span>
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-600 font-medium">휴가 {L.entries.length}건 (승인·반려·취소·대기 전부)</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {L.entries.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 text-center">이 해에 신청한 휴가가 없습니다</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-gray-500 bg-gray-50/60 text-left">
                      <th className="px-4 py-2 font-medium whitespace-nowrap">기간</th>
                      <th className="px-4 py-2 font-medium">유형·일수</th>
                      <th className="px-4 py-2 font-medium">상태</th>
                      <th className="px-4 py-2 font-medium">신청·결재 기록</th>
                    </tr>
                  </thead>
                  <tbody>
                    {L.entries.map((e) => (
                      <tr key={e.id} className="border-b last:border-0 align-top">
                        <td className="px-4 py-3 whitespace-nowrap text-gray-800">
                          {e.startDate}{e.startDate !== e.endDate && <><br />~ {e.endDate}</>}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {TYPE_LABEL[e.type] ?? e.type} · {e.days}일
                          {!e.deductible && <div className="text-[11px] text-gray-400">연차 미차감</div>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={STATUS[e.status]?.cls}>{STATUS[e.status]?.label ?? e.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600 space-y-0.5">
                          <div>신청 {kst(e.createdAt)}{e.reason ? ` · 사유: ${e.reason}` : ""}</div>
                          {e.rejectedReason && <div className="text-red-600">반려 사유: {e.rejectedReason}</div>}
                          {e.steps.map((st) => <div key={`s${st.order}`}>결재 {stepText(st)}</div>)}
                          {e.cancelRequests.map((c) => (
                            <div key={c.id} className="mt-1 pl-2 border-l-2 border-amber-200 text-amber-800">
                              <div>
                                취소 요청 {kst(c.createdAt)} — {STATUS[c.status]?.label ?? c.status}
                                {c.reason ? ` · 사유: ${c.reason}` : ""}{c.rejectedReason ? ` · ${c.rejectedReason}` : ""}
                              </div>
                              {c.steps.map((st) => <div key={`c${st.order}`}>취소 결재 {stepText(st)}</div>)}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-600 font-medium">잔여 조정 이력 {L.adjustments.length}건</CardTitle></CardHeader>
            <CardContent className="text-sm text-gray-700 space-y-1">
              {L.adjustments.length === 0 ? <p className="text-gray-500">이 해에 잔여 조정 기록이 없습니다</p> :
                L.adjustments.map((a, i) => <p key={i}>{kst(a.at)} · {a.actorName} · {a.detail ?? ""}</p>)}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
