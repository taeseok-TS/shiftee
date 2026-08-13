"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { FileWarning, RefreshCw, Trash2, ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react";

type ErrorLog = {
  id: string;
  path: string;
  method: string | null;
  userName: string | null;
  message: string;
  stack: string | null;
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export default function SystemLogsPage() {
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [count24h, setCount24h] = useState(0);
  const [count7d, setCount7d] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/system-logs");
    if (res.ok) {
      const d = await res.json();
      setLogs(d.logs || []);
      setCount24h(d.count24h || 0);
      setCount7d(d.count7d || 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  async function toggleResolved(l: ErrorLog) {
    const res = await fetch("/api/admin/system-logs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: l.id, resolved: !l.resolved }),
    });
    if (res.ok) {
      const { log } = await res.json();
      setLogs((prev) => prev.map((x) => (x.id === l.id ? { ...x, ...log } : x)));
      toast.success(l.resolved ? "처리 완료를 해제했습니다." : "처리 완료로 표시했습니다.");
    } else {
      toast.error("저장에 실패했습니다.");
    }
  }

  async function clearAll() {
    if (!window.confirm("모든 시스템 로그를 비울까요?")) return;
    const res = await fetch("/api/admin/system-logs", { method: "DELETE" });
    if (res.ok) { toast.success("로그를 비웠습니다."); fetchLogs(); }
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileWarning className="text-amber-500" /> 시스템 로그</h1>
          <p className="text-sm text-gray-500 mt-1">서버에서 발생한 오류 기록입니다. (14일 보관 후 자동 삭제)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchLogs} className="gap-1"><RefreshCw size={13} />새로고침</Button>
          <Button variant="outline" size="sm" onClick={clearAll} className="gap-1 text-red-500"><Trash2 size={13} />비우기</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card><CardContent className="pt-5 pb-4">
          <p className="text-xs text-gray-500">최근 24시간 오류</p>
          <p className={`text-2xl font-bold ${count24h >= 20 ? "text-red-500" : count24h > 0 ? "text-amber-500" : "text-green-600"}`}>{count24h}건</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5 pb-4">
          <p className="text-xs text-gray-500">최근 7일 오류</p>
          <p className="text-2xl font-bold text-gray-700">{count7d}건</p>
        </CardContent></Card>
      </div>

      {loading ? (
        <p className="text-gray-400 py-10 text-center">불러오는 중…</p>
      ) : logs.length === 0 ? (
        <Card><CardContent className="py-14 text-center text-gray-400">
          ✅ 기록된 오류가 없습니다. 시스템이 깨끗합니다!
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {logs.map((l) => (
            <div key={l.id} className="border rounded-lg bg-white">
              <button className="w-full text-left px-4 py-2.5 flex items-center gap-3" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                {expanded === l.id ? <ChevronDown size={14} className="shrink-0 text-gray-400" /> : <ChevronRight size={14} className="shrink-0 text-gray-400" />}
                <span className="text-xs text-gray-400 shrink-0 w-32">{new Date(l.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="text-xs font-mono text-indigo-600 shrink-0 max-w-[220px] truncate">{l.method} {l.path}</span>
                <span className={`text-sm truncate flex-1 ${l.resolved ? "text-gray-400 line-through" : "text-gray-800"}`}>{l.message}</span>
                {l.resolved && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                    <CheckCircle2 size={11} /> 처리 완료
                  </span>
                )}
              </button>
              {expanded === l.id && (
                <div className="px-4 pb-3 border-t pt-2">
                  {l.userName && <p className="text-xs text-gray-500 mb-1">요청자: {l.userName}</p>}
                  <p className="text-sm text-red-600 whitespace-pre-wrap">{l.message}</p>
                  {l.stack && <pre className="mt-2 text-[11px] text-gray-500 bg-gray-50 rounded p-2 overflow-x-auto max-h-48">{l.stack}</pre>}
                  <div className="mt-2 flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => toggleResolved(l)}
                      className={`gap-1 ${l.resolved ? "text-gray-500" : "text-green-600"}`}>
                      <CheckCircle2 size={13} /> {l.resolved ? "처리 완료 해제" : "처리 완료로 표시"}
                    </Button>
                    {l.resolved && l.resolvedAt && (
                      <span className="text-xs text-gray-400">
                        {l.resolvedBy ?? "관리자"} · {new Date(l.resolvedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 처리
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
