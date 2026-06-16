"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Megaphone, Plus, Pin, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Announcement = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  authorName: string;
  createdAt: string;
  canEdit: boolean;
};

export default function WorkAnnouncementsPage() {
  const [list, setList] = useState<Announcement[]>([]);
  const [role, setRole] = useState("EMPLOYEE");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", pinned: false });
  const [saving, setSaving] = useState(false);

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
      const res = await fetch("/api/work/announcements", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "등록 실패"); return; }
      toast.success("공지가 등록되었습니다.");
      setOpen(false); setForm({ title: "", content: "", pinned: false });
      fetchList();
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/work/announcements/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제 실패"); return; }
    toast.success("삭제되었습니다.");
    fetchList();
  }

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Megaphone size={22} className="text-indigo-500" />공지</h1>
        {role !== "EMPLOYEE" && (
          <Button onClick={() => setOpen(true)} className="gap-1 bg-indigo-500 hover:bg-indigo-600"><Plus size={16} />공지 작성</Button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="text-center text-gray-400 py-20">등록된 공지가 없습니다.</div>
      ) : (
        <div className="space-y-3">
          {list.map((a) => (
            <Card key={a.id} className={a.pinned ? "border-indigo-300 bg-indigo-50/40" : ""}>
              <CardContent className="pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {a.pinned && <Pin size={14} className="text-indigo-500" />}
                      <h3 className="font-semibold">{a.title}</h3>
                    </div>
                    <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{a.content}</p>
                    <p className="text-xs text-gray-400 mt-3">{a.authorName} · {format(new Date(a.createdAt), "yyyy.MM.dd HH:mm")}</p>
                  </div>
                  {a.canEdit && (
                    <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50 shrink-0" onClick={() => remove(a.id)}>
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>공지 작성</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="제목" value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} />
            <Textarea placeholder="내용" rows={6} value={form.content} onChange={(e) => setForm(f => ({ ...f, content: e.target.value }))} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.pinned} onChange={(e) => setForm(f => ({ ...f, pinned: e.target.checked }))} />
              상단 고정
            </label>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
              <Button onClick={save} disabled={saving}>{saving ? "등록 중..." : "등록"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
