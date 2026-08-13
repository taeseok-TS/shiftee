"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { HardDrive, RefreshCw, Trash2, Hash, User as UserIcon, Film } from "lucide-react";

type ChannelStorage = {
  channelId: string;
  channelName: string;
  type: string;
  files: number;
  bytes: number;
  images: number;
  videos: number;
  others: number;
};

type CompressJob = {
  id: string;
  fileUrl: string;
  status: string; // PENDING | RUNNING | DONE | FAILED | SKIPPED
  origSize: number;
  newSize: number | null;
  error: string | null;
  createdAt: string;
};

const JOB_LABEL: Record<string, { text: string; cls: string }> = {
  PENDING: { text: "대기", cls: "text-gray-500 bg-gray-50 border" },
  RUNNING: { text: "압축 중", cls: "text-indigo-600 bg-indigo-50 border border-indigo-200" },
  DONE: { text: "완료", cls: "text-green-600 bg-green-50 border border-green-200" },
  FAILED: { text: "실패", cls: "text-red-500 bg-red-50 border border-red-200" },
  SKIPPED: { text: "원본 유지", cls: "text-gray-500 bg-gray-50 border" },
};

function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

export default function StoragePage() {
  const [disk, setDisk] = useState<{ totalGb: number; usedGb: number; percent: number } | null>(null);
  const [uploadsBytes, setUploadsBytes] = useState(0);
  const [channels, setChannels] = useState<ChannelStorage[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [cleanupFor, setCleanupFor] = useState<ChannelStorage | null>(null);
  const [days, setDays] = useState("90");
  const [cleaning, setCleaning] = useState(false);
  const [compressJobs, setCompressJobs] = useState<CompressJob[]>([]);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/storage");
    if (res.ok) {
      const d = await res.json();
      setDisk(d.disk); setUploadsBytes(d.uploadsBytes || 0); setChannels(d.channels || []); setIssues(d.issues || []);
      setCompressJobs(d.compressJobs || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  async function runCleanup() {
    if (!cleanupFor) return;
    const d = parseInt(days);
    if (!Number.isInteger(d) || d < 30) { toast.error("보관 기간은 최소 30일 이상이어야 합니다."); return; }
    if (!window.confirm(`"${cleanupFor.channelName}" 채팅방에서 ${d}일 이전 첨부파일을 삭제합니다.\n대화 내용은 유지되고 파일만 삭제되며, 되돌릴 수 없습니다.\n진행할까요?`)) return;
    setCleaning(true);
    try {
      const res = await fetch("/api/admin/storage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: cleanupFor.channelId, olderThanDays: d }),
      });
      const r = await res.json();
      if (!res.ok) { toast.error(r.error || "정리 실패"); return; }
      toast.success(`정리 완료 — 파일 ${r.removedFiles}개, ${fmtBytes(r.freedBytes)} 확보`);
      setCleanupFor(null);
      fetchStats();
    } finally {
      setCleaning(false);
    }
  }

  const gaugeColor = !disk ? "bg-gray-300" : disk.percent >= 90 ? "bg-red-500" : disk.percent >= 80 ? "bg-amber-500" : "bg-green-500";

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><HardDrive className="text-indigo-500" /> 저장공간</h1>
          <p className="text-sm text-gray-500 mt-1">서버 디스크와 채팅방별 첨부파일 용량을 관리합니다.</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStats} className="gap-1"><RefreshCw size={13} />새로고침</Button>
      </div>

      {issues.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 space-y-1">
          {issues.map((i, idx) => <p key={idx} className="text-sm text-amber-800">{i}</p>)}
        </div>
      )}

      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium">서버 디스크</span>
            {disk && <span className="text-gray-500">{disk.usedGb}GB / {disk.totalGb}GB ({disk.percent}%)</span>}
          </div>
          <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full ${gaugeColor} transition-all`} style={{ width: `${disk?.percent ?? 0}%` }} />
          </div>
          <p className="text-xs text-gray-400 mt-2">채팅 첨부파일 합계: <span className="font-semibold text-gray-600">{fmtBytes(uploadsBytes)}</span></p>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-2">채팅방별 첨부 용량 (큰 순)</h2>
        {loading ? (
          <p className="text-gray-400 py-8 text-center">집계 중… (파일 실측이라 수 초 걸릴 수 있습니다)</p>
        ) : channels.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-gray-400">첨부파일이 있는 채팅방이 없습니다.</CardContent></Card>
        ) : (
          <div className="border rounded-lg bg-white divide-y">
            {channels.map((c) => (
              <div key={c.channelId} className="px-4 py-3 flex items-center gap-3">
                {c.type === "DM" ? <UserIcon size={15} className="text-gray-400 shrink-0" /> : <Hash size={15} className="text-gray-400 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{c.channelName}</p>
                  <p className="text-xs text-gray-400">사진 {c.images} · 동영상 {c.videos} · 파일 {c.others}</p>
                </div>
                <span className="text-sm font-bold text-indigo-600 shrink-0">{fmtBytes(c.bytes)}</span>
                <Button variant="outline" size="sm" className="gap-1 text-red-500 border-red-200 shrink-0"
                  onClick={() => { setDays("90"); setCleanupFor(c); }}>
                  <Trash2 size={12} />정리
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 영상 자동 압축 이력 (100MB 초과 영상 → 1080p 변환) */}
      {compressJobs.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
            <Film size={14} /> 영상 자동 압축 이력 <span className="font-normal text-gray-400">(100MB 초과 영상은 자동으로 1080p 압축)</span>
          </h2>
          <div className="border rounded-lg bg-white divide-y">
            {compressJobs.map((j) => {
              const label = JOB_LABEL[j.status] || JOB_LABEL.PENDING;
              return (
                <div key={j.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span className={`shrink-0 text-[11px] font-medium rounded-full px-2 py-0.5 ${label.cls}`}>{label.text}</span>
                  <span className="flex-1 truncate text-gray-600 font-mono text-xs">{j.fileUrl.split("/").pop()}</span>
                  <span className="shrink-0 text-xs text-gray-500">
                    {fmtBytes(j.origSize)}{j.status === "DONE" && j.newSize ? ` → ${fmtBytes(j.newSize)}` : ""}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {new Date(j.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 오래된 첨부 정리 */}
      <Dialog open={!!cleanupFor} onOpenChange={(v) => { if (!v) setCleanupFor(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>오래된 첨부 정리</DialogTitle></DialogHeader>
          {cleanupFor && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                <span className="font-semibold">{cleanupFor.channelName}</span> 채팅방의 오래된 첨부파일을 삭제합니다.
                대화 내용(텍스트)은 그대로 유지되고 파일만 삭제됩니다.
              </p>
              <div className="flex items-center gap-2 text-sm">
                <input type="number" min={30} className="w-24 rounded-md border px-3 py-2" value={days} onChange={(e) => setDays(e.target.value)} />
                일 이전 첨부 삭제 <span className="text-xs text-gray-400">(최소 30일)</span>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setCleanupFor(null)}>취소</Button>
                <Button size="sm" onClick={runCleanup} disabled={cleaning} className="bg-red-500 hover:bg-red-600">
                  {cleaning ? "정리 중…" : "삭제 실행"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
