"use client";

// 개선 제안 관리 (관리자) — 전체 제안 목록, 상태 변경 + 답변.
// 상태를 바꾸거나 답변을 달면 작성자에게 큐브티 봇 DM으로 자동 통지된다.
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Lightbulb } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Suggestion = {
  id: string;
  seqNo: number;
  userName: string;
  userBranch: string | null;
  title: string;
  content: string;
  imageUrls: string[] | null;
  status: string;
  adminComment: string | null;
  createdAt: string;
};

const STATUSES = [
  { value: "RECEIVED", label: "접수", cls: "bg-gray-100 text-gray-600" },
  { value: "REVIEWING", label: "검토중", cls: "bg-blue-100 text-blue-700" },
  { value: "PLANNED", label: "반영 예정", cls: "bg-indigo-100 text-indigo-700" },
  { value: "DONE", label: "완료", cls: "bg-green-100 text-green-700" },
  { value: "HOLD", label: "보류", cls: "bg-amber-100 text-amber-700" },
];

export default function AdminSuggestionsPage() {
  const [list, setList] = useState<Suggestion[]>([]);
  const [filter, setFilter] = useState<string>("ALL");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    const res = await fetch("/api/suggestions");
    if (res.ok) {
      const items: Suggestion[] = (await res.json()).suggestions || [];
      setList(items);
      setComments((prev) => {
        const n = { ...prev };
        for (const s of items) if (n[s.id] === undefined) n[s.id] = s.adminComment || "";
        return n;
      });
    }
  }, []);
  useEffect(() => { fetchList(); }, [fetchList]);

  async function update(id: string, data: { status?: string; adminComment?: string }) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/suggestions/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || "저장 실패"); return; }
      toast.success("저장되었습니다. 작성자에게 봇 알림이 발송됩니다.");
      fetchList();
    } finally { setSavingId(null); }
  }

  const shown = filter === "ALL" ? list : list.filter((s) => s.status === filter);
  const countOf = (v: string) => list.filter((s) => s.status === v).length;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Lightbulb size={22} className="text-amber-500" />개선 제안 관리</h1>
        <p className="text-sm text-gray-500 mt-1">상태를 바꾸거나 답변을 저장하면 작성자에게 큐브티 봇 알림이 갑니다.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter("ALL")}
          className={`text-sm rounded-full px-3 py-1 border ${filter === "ALL" ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600"}`}>
          전체 {list.length}
        </button>
        {STATUSES.map((s) => (
          <button key={s.value} onClick={() => setFilter(s.value)}
            className={`text-sm rounded-full px-3 py-1 border ${filter === s.value ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600"}`}>
            {s.label} {countOf(s.value)}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-14">해당하는 제안이 없습니다.</div>
      ) : (
        shown.map((s) => {
          const badge = STATUSES.find((x) => x.value === s.status) || STATUSES[0];
          return (
            <Card key={s.id}>
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${badge.cls}`}>{badge.label}</span>
                  <h3 className="font-semibold flex-1 min-w-0 truncate"><span className="text-gray-400 font-normal mr-1">#{s.seqNo}</span>{s.title}</h3>
                  <span className="text-xs text-gray-500 shrink-0">
                    {s.userName}{s.userBranch ? ` · ${s.userBranch}` : ""} · {format(new Date(s.createdAt), "MM/dd HH:mm")}
                  </span>
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{s.content}</p>
                {(s.imageUrls?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {s.imageUrls!.map((u, i) => (
                      <a key={i} href={u} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt="첨부" className="max-h-28 rounded border" />
                      </a>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-gray-400 mr-1">상태 변경:</span>
                  {STATUSES.map((x) => (
                    <button key={x.value} disabled={savingId === s.id || s.status === x.value}
                      onClick={() => update(s.id, { status: x.value })}
                      className={`text-xs rounded-full px-2.5 py-1 border ${s.status === x.value ? `${x.cls} font-semibold` : "bg-white text-gray-500 hover:bg-gray-50"}`}>
                      {x.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 items-start">
                  <Textarea rows={2} placeholder="작성자에게 보낼 답변 (선택)" className="min-h-[44px] text-sm"
                    value={comments[s.id] ?? ""} onChange={(e) => setComments((p) => ({ ...p, [s.id]: e.target.value }))} />
                  <Button size="sm" variant="outline" disabled={savingId === s.id}
                    onClick={() => update(s.id, { adminComment: comments[s.id] ?? "" })}>
                    답변 저장
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
