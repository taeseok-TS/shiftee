"use client";

// 개선 제안함 (직원) — 작성자와 관리자만 보는 비공개 창구.
// 글 + 스크린샷 첨부로 제안을 남기고, 처리 상태(접수→검토중→반영 예정→완료/보류)를 확인한다.
import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Lightbulb, ImageIcon, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Suggestion = {
  id: string;
  title: string;
  content: string;
  imageUrls: string[] | null;
  status: string;
  adminComment: string | null;
  createdAt: string;
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  RECEIVED: { label: "접수", cls: "bg-gray-100 text-gray-600" },
  REVIEWING: { label: "검토중", cls: "bg-blue-100 text-blue-700" },
  PLANNED: { label: "반영 예정", cls: "bg-indigo-100 text-indigo-700" },
  DONE: { label: "완료", cls: "bg-green-100 text-green-700" },
  HOLD: { label: "보류", cls: "bg-amber-100 text-amber-700" },
};

export default function SuggestionsPage() {
  const [list, setList] = useState<Suggestion[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchList = useCallback(async () => {
    const res = await fetch("/api/suggestions");
    if (res.ok) setList((await res.json()).suggestions || []);
  }, []);
  useEffect(() => { fetchList(); }, [fetchList]);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/work/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "업로드 실패"); return; }
      setImages((prev) => [...prev, data.fileUrl].slice(0, 5));
    } finally { setUploading(false); }
  }

  async function submit() {
    if (!title.trim() || !content.trim()) { toast.error("제목과 내용을 입력해주세요."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, imageUrls: images }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "등록 실패"); return; }
      toast.success("제안이 접수되었습니다. 처리 현황은 이 화면과 큐브티 봇 알림으로 알려드립니다.");
      setTitle(""); setContent(""); setImages([]);
      fetchList();
    } finally { setSaving(false); }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Lightbulb size={22} className="text-amber-500" />개선 제안</h1>
        <p className="text-sm text-gray-500 mt-1">
          큐브티를 쓰다가 불편한 점, 있었으면 하는 기능을 편하게 남겨주세요.
          <span className="font-medium text-gray-600"> 작성자와 관리자만 볼 수 있습니다.</span>
        </p>
      </div>

      {/* 작성 */}
      <Card>
        <CardContent className="pt-5 pb-5 space-y-3">
          <Input placeholder="제목 (예: 채팅방 멤버 목록 스크롤이 잘 안 돼요)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
          <Textarea placeholder="내용 — 어떤 화면에서, 어떤 점이 불편했는지 적어주시면 반영이 빨라집니다." rows={5}
            value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[120px]" />
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => fileRef.current?.click()} disabled={uploading || images.length >= 5}>
              <ImageIcon size={14} />{uploading ? "업로드 중..." : "스크린샷 첨부"}
            </Button>
            <span className="text-xs text-gray-400">화면 캡처를 붙이면 이해가 빨라요 (최대 5장)</span>
          </div>
          {images.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {images.map((u, i) => (
                <div key={i} className="relative border rounded-lg p-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="첨부" className="max-h-24 rounded" />
                  <button onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute -top-2 -right-2 bg-white border rounded-full p-0.5 text-red-500"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={submit} disabled={saving || uploading}>{saving ? "등록 중..." : "제안 등록"}</Button>
          </div>
        </CardContent>
      </Card>

      {/* 내 제안 목록 */}
      <div className="space-y-3">
        <h2 className="font-semibold text-gray-700">내 제안 {list.length > 0 ? `(${list.length})` : ""}</h2>
        {list.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-10">아직 등록한 제안이 없습니다.</div>
        ) : (
          list.map((s) => {
            const badge = STATUS_BADGE[s.status] || STATUS_BADGE.RECEIVED;
            return (
              <Card key={s.id}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${badge.cls}`}>{badge.label}</span>
                    <h3 className="font-semibold flex-1 truncate">{s.title}</h3>
                    <span className="text-xs text-gray-400 shrink-0">{format(new Date(s.createdAt), "yyyy.MM.dd")}</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{s.content}</p>
                  {(s.imageUrls?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {s.imageUrls!.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt="첨부" className="max-h-20 rounded border" />
                        </a>
                      ))}
                    </div>
                  )}
                  {s.adminComment && (
                    <div className="mt-3 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 text-sm text-indigo-900">
                      <span className="font-semibold">관리자 답변</span> · {s.adminComment}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
