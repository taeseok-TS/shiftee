"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Megaphone, Plus, Pin, Trash2, Paperclip, ImageIcon, X, ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

// 텍스트 속 URL을 클릭 가능한 링크로 (닫는 괄호·따옴표는 URL에서 제외)
function linkify(text: string, keyPrefix: string) {
  const re = /https?:\/\/[^\s<>")\]]+/g;
  const out: React.ReactNode[] = [];
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={`${keyPrefix}t${i}`} className="whitespace-pre-wrap">{text.slice(last, m.index)}</span>);
    out.push(
      <a key={`${keyPrefix}a${i}`} href={m[0]} target="_blank" rel="noreferrer" className="text-indigo-600 underline break-all">
        {m[0]}
      </a>
    );
    last = m.index + m[0].length; i++;
  }
  if (last < text.length) out.push(<span key={`${keyPrefix}t${i}`} className="whitespace-pre-wrap">{text.slice(last)}</span>);
  return out;
}

// 본문 렌더: ![alt](url) → 인라인 이미지, 나머지는 텍스트(줄바꿈 유지 + URL 링크화)
function renderBody(text: string) {
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const out: React.ReactNode[] = [];
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(...linkify(text.slice(last, m.index), `s${i}`));
    out.push(
      <a key={`i${i}`} href={m[2]} target="_blank" rel="noreferrer" className="block my-2">
        <img src={m[2]} alt={m[1]} className="max-h-80 rounded-lg border" />
      </a>
    );
    last = m.index + m[0].length; i++;
  }
  if (last < text.length) out.push(...linkify(text.slice(last), `e${i}`));
  return out;
}

type Attachment = { url: string; name: string; type: string };
type Announcement = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  attachments: Attachment[];
  authorName: string;
  createdAt: string;
  canEdit: boolean;
};

export default function WorkAnnouncementsPage() {
  const [list, setList] = useState<Announcement[]>([]);
  const [role, setRole] = useState("EMPLOYEE");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null); // 수정 중인 공지 ID (null=새 공지)
  const [form, setForm] = useState<{ title: string; content: string; pinned: boolean; attachments: Attachment[] }>({ title: "", content: "", pinned: false, attachments: [] });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 접기/펼치기 — 최초 로드 시 가장 최근 공지 1개만 펼침
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const openInitRef = useRef(false);
  useEffect(() => {
    if (!openInitRef.current && list.length > 0) {
      const latest = [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
      setOpenIds(new Set([latest.id]));
      openInitRef.current = true;
    }
  }, [list]);
  const toggleOpen = (id: string) =>
    setOpenIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const contentRef = useRef<HTMLTextAreaElement>(null);

  async function uploadFile(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/work/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "업로드 실패"); return null; }
    return data as { fileUrl: string; fileName: string; fileType: string };
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const data = await uploadFile(file);
      if (data) setForm((f) => ({ ...f, attachments: [...f.attachments, { url: data.fileUrl, name: data.fileName, type: data.fileType }] }));
    } finally { setUploading(false); }
  }

  // 내용 textarea에 이미지 붙여넣기 → 업로드 후 본문에 ![](url) 삽입
  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find((it) => it.type.startsWith("image/"));
    if (!imageItem) return; // 일반 텍스트 붙여넣기는 기본 동작
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    setUploading(true);
    try {
      const data = await uploadFile(new File([file], `paste-${Date.now()}.png`, { type: file.type }));
      if (!data) return;
      const ta = contentRef.current;
      const token = `\n![${data.fileName}](${data.fileUrl})\n`;
      setForm((f) => {
        const pos = ta?.selectionStart ?? f.content.length;
        const next = f.content.slice(0, pos) + token + f.content.slice(pos);
        return { ...f, content: next };
      });
      toast.success("이미지가 본문에 삽입되었습니다.");
    } finally { setUploading(false); }
  }

  const fetchList = useCallback(async () => {
    const res = await fetch("/api/work/announcements");
    if (res.ok) setList((await res.json()).announcements || []);
  }, []);

  useEffect(() => {
    fetchList();
    fetch("/api/auth/me").then(r => r.json()).then(d => setRole(d.user?.role || "EMPLOYEE")).catch(() => {});
  }, [fetchList]);

  async function save() {
    if (!form.title.trim() || !form.content.trim()) { toast.error("제목과 내용을 입력해주세요."); return; }
    setSaving(true);
    try {
      // editId가 있으면 기존 공지 수정, 없으면 새 공지 등록
      const res = await fetch(editId ? `/api/work/announcements/${editId}` : "/api/work/announcements", {
        method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || (editId ? "수정 실패" : "등록 실패")); return; }
      toast.success(editId ? "공지가 수정되었습니다." : "공지가 등록되었습니다.");
      setOpen(false); setEditId(null); setForm({ title: "", content: "", pinned: false, attachments: [] });
      fetchList();
    } finally { setSaving(false); }
  }

  function startEdit(a: Announcement) {
    setEditId(a.id);
    setForm({ title: a.title, content: a.content, pinned: a.pinned, attachments: a.attachments || [] });
    setOpen(true);
  }

  async function remove(id: string) {
    if (!window.confirm("이 공지를 삭제할까요?")) return;
    const res = await fetch(`/api/work/announcements/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제 실패"); return; }
    toast.success("삭제되었습니다.");
    fetchList();
  }

  async function togglePin(a: { id: string; pinned: boolean }) {
    const res = await fetch(`/api/work/announcements/${a.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: !a.pinned }),
    });
    if (!res.ok) { toast.error("변경 실패"); return; }
    toast.success(!a.pinned ? "상단에 고정했습니다." : "고정을 해제했습니다.");
    fetchList();
  }

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Megaphone size={22} className="text-indigo-500" />공지</h1>
        {role === "ADMIN" && (
          <Button onClick={() => { setEditId(null); setForm({ title: "", content: "", pinned: false, attachments: [] }); setOpen(true); }}
            className="gap-1 bg-indigo-500 hover:bg-indigo-600"><Plus size={16} />공지 작성</Button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="text-center text-gray-400 py-20">등록된 공지가 없습니다.</div>
      ) : (
        <div className="space-y-3">
          {list.map((a) => {
            const isOpen = openIds.has(a.id);
            return (
            <Card key={a.id} className={a.pinned ? "border-indigo-300 bg-indigo-50/40" : ""}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between gap-3">
                  <button className="flex items-center gap-2 min-w-0 flex-1 text-left" onClick={() => toggleOpen(a.id)}>
                    {isOpen ? <ChevronDown size={15} className="text-gray-400 shrink-0" /> : <ChevronRight size={15} className="text-gray-400 shrink-0" />}
                    {a.pinned && <Pin size={14} className="text-indigo-500 shrink-0" />}
                    <h3 className="font-semibold truncate">{a.title}</h3>
                    <span className="text-xs text-gray-400 shrink-0">{a.authorName} · {format(new Date(a.createdAt), "yyyy.MM.dd")}</span>
                    {!isOpen && (a.attachments?.length ?? 0) > 0 && <Paperclip size={12} className="text-gray-400 shrink-0" />}
                  </button>
                  {a.canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(a)} title="수정"
                        className="text-gray-400 hover:text-indigo-600">
                        <Pencil size={14} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => togglePin(a)} title={a.pinned ? "고정 해제" : "상단 고정"}
                        className={a.pinned ? "text-indigo-600" : "text-gray-400 hover:text-indigo-600"}>
                        <Pin size={14} className={a.pinned ? "fill-indigo-500" : ""} />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50" onClick={() => remove(a.id)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  )}
                </div>
                {isOpen && (
                  <div className="pl-6 mt-1">
                    <div className="text-sm text-gray-700 mt-1">{renderBody(a.content)}</div>
                    {a.attachments?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-3">
                        {a.attachments.map((att, i) =>
                          att.type === "image" ? (
                            <a key={i} href={att.url} target="_blank" rel="noreferrer">
                              <img src={att.url} alt={att.name} className="max-h-48 rounded-lg border" />
                            </a>
                          ) : (
                            <a key={i} href={att.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-indigo-600 underline border rounded-lg px-3 py-2">
                              <Paperclip size={12} />{att.name}
                            </a>
                          )
                        )}
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-3">{a.authorName} · {format(new Date(a.createdAt), "yyyy.MM.dd HH:mm")}</p>
                  </div>
                )}
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditId(null); }}>
        <DialogContent className="max-w-3xl w-[90vw]">
          <DialogHeader><DialogTitle>{editId ? "공지 수정" : "공지 작성"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="제목" value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} />
            <Textarea ref={contentRef} placeholder="내용 (이미지를 복사해 붙여넣으면 본문에 바로 삽입됩니다)" rows={14}
              value={form.content} onChange={(e) => setForm(f => ({ ...f, content: e.target.value }))}
              onPaste={handlePaste} className="min-h-[320px]" />

            {/* 첨부 */}
            <input ref={fileRef} type="file" className="hidden" accept="*/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <ImageIcon size={14} />{uploading ? "업로드 중..." : "이미지 / 파일 첨부"}
              </Button>
              <span className="text-xs text-gray-400">이미지는 본문 아래에 미리보기로 표시됩니다.</span>
            </div>
            {form.attachments.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {form.attachments.map((att, i) => (
                  <div key={i} className="relative border rounded-lg p-2">
                    {att.type === "image"
                      ? <img src={att.url} alt={att.name} className="max-h-28 rounded" />
                      : <div className="flex items-center gap-1.5 text-xs px-2 py-3"><Paperclip size={12} />{att.name}</div>}
                    <button onClick={() => setForm(f => ({ ...f, attachments: f.attachments.filter((_, idx) => idx !== i) }))}
                      className="absolute -top-2 -right-2 bg-white border rounded-full p-0.5 text-red-500"><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.pinned} onChange={(e) => setForm(f => ({ ...f, pinned: e.target.checked }))} />
              상단 고정
            </label>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
              <Button onClick={save} disabled={saving}>{saving ? "저장 중..." : editId ? "수정 저장" : "등록"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
