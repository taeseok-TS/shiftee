"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { FileSignature, Plus, Download, Trash2, PenLine } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type ContractTemplate = {
  id: string;
  name: string;
  description?: string;
  type: string;
  fileUrl: string;
  version: number;
  createdByUser: { id: string; name: string };
  createdAt: string;
  approverIds?: string;
};

type Employee = { id: string; name: string; department: string | null };

const typeLabel: Record<string, string> = {
  EMPLOYMENT: "근로계약서",
  PART_TIME: "단시간근로계약서",
  CONFIDENTIAL: "비밀유지계약",
  OTHER: "기타",
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [role, setRole] = useState("EMPLOYEE");

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ContractTemplate | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContractTemplate | null>(null);

  const [createForm, setCreateForm] = useState({
    name: "",
    description: "",
    type: "EMPLOYMENT",
    approverIds: [] as string[],
  });
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    approverIds: [] as string[],
  });

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      const userRole = d.user?.role || "EMPLOYEE";
      setRole(userRole);
      if (userRole !== "EMPLOYEE") {
        fetchTemplates();
      }
    });
    fetch("/api/employees").then(r => r.json()).then(d => setEmployees(d.employees || [])).catch(() => {});
  }, []);

  const fetchTemplates = async () => {
    try {
      const res = await fetch("/api/contract-templates");
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (error) {
      console.error("템플릿 로드 실패:", error);
      toast.error("템플릿을 불러올 수 없습니다.");
    }
  };

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { toast.error("파일을 선택해주세요."); return; }
    if (!createForm.name) { toast.error("템플릿명을 입력해주세요."); return; }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", createForm.name);
    formData.append("description", createForm.description);
    formData.append("type", createForm.type);
    if (createForm.approverIds.length > 0) {
      formData.append("approverIds", JSON.stringify(createForm.approverIds));
    }

    const res = await fetch("/api/contract-templates", { method: "POST", body: formData });
    const data = await res.json();
    setUploading(false);

    if (!res.ok) { toast.error(data.error); return; }
    toast.success("템플릿이 생성되었습니다.");
    setCreateOpen(false);
    setFile(null);
    setCreateForm({ name: "", description: "", type: "EMPLOYMENT", approverIds: [] });
    fetchTemplates();
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;

    const res = await fetch(`/api/contract-templates/${editTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: editForm.description,
        approverIds: editForm.approverIds.length > 0 ? editForm.approverIds : [],
      }),
    });
    const data = await res.json();

    if (!res.ok) { toast.error(data.error); return; }
    toast.success("템플릿이 수정되었습니다.");
    setEditOpen(false);
    setEditTarget(null);
    fetchTemplates();
  }

  async function handleDelete() {
    if (!deleteTarget) return;

    const res = await fetch(`/api/contract-templates/${deleteTarget.id}`, {
      method: "DELETE",
    });
    const data = await res.json();

    if (!res.ok) { toast.error(data.error); return; }
    toast.success("템플릿이 삭제되었습니다.");
    setDeleteOpen(false);
    setDeleteTarget(null);
    fetchTemplates();
  }

  const openEdit = (template: ContractTemplate) => {
    setEditTarget(template);
    const approverIds = template.approverIds ? JSON.parse(template.approverIds) : [];
    setEditForm({
      name: template.name,
      description: template.description || "",
      approverIds,
    });
    setEditOpen(true);
  };

  if (role === "EMPLOYEE") {
    return (
      <div className="flex items-center justify-center min-h-screen text-center">
        <div className="space-y-2">
          <p className="text-gray-600">권한이 없습니다.</p>
          <p className="text-sm text-gray-500">관리자 또는 매니저만 템플릿을 관리할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">계약서 템플릿</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger>
            <Button className="gap-2"><Plus size={16} />새 템플릿</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>템플릿 생성</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>템플릿명 *</Label>
                <Input
                  value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="예: 2025 신입사원 근로계약서"
                />
              </div>
              <div className="space-y-2">
                <Label>설명</Label>
                <Textarea
                  value={createForm.description}
                  onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="템플릿에 대한 설명"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>유형 *</Label>
                <Select value={createForm.type} onValueChange={v => v && setCreateForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(typeLabel).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>파일 (PDF) *</Label>
                <Input
                  type="file"
                  accept=".pdf"
                  onChange={e => setFile(e.target.files?.[0] || null)}
                  disabled={uploading}
                />
              </div>
              <div className="space-y-2">
                <Label>기본 승인자 (선택사항)</Label>
                <div className="space-y-1 border rounded-lg p-2 max-h-40 overflow-y-auto">
                  {employees.map(e => (
                    <label key={e.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                      <input
                        type="checkbox"
                        checked={createForm.approverIds.includes(e.id)}
                        onChange={ev => {
                          if (ev.target.checked) {
                            setCreateForm(f => ({ ...f, approverIds: [...f.approverIds, e.id] }));
                          } else {
                            setCreateForm(f => ({ ...f, approverIds: f.approverIds.filter(id => id !== e.id) }));
                          }
                        }}
                      />
                      <span className="text-sm">{e.name} ({e.department})</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>취소</Button>
                <Button type="submit" disabled={uploading}>{uploading ? "업로드" : "생성"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileSignature size={18} />템플릿 목록</CardTitle></CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <div className="py-8 text-center text-gray-400">생성된 템플릿이 없습니다.</div>
          ) : (
            <div className="space-y-3">
              {templates.map(t => {
                const approverIds = t.approverIds ? JSON.parse(t.approverIds) : [];
                const approvers = employees.filter(e => approverIds.includes(e.id));
                return (
                  <div key={t.id} className="border rounded-lg p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{t.name}</p>
                        {t.description && <p className="text-xs text-gray-600 mt-1">{t.description}</p>}
                        <div className="flex items-center gap-3 mt-2">
                          <Badge variant="outline" className="text-xs">{typeLabel[t.type]}</Badge>
                          <p className="text-xs text-gray-500">
                            {t.createdByUser.name} · {format(new Date(t.createdAt), "yyyy-MM-dd")}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <a href={t.fileUrl} target="_blank">
                          <Button size="sm" variant="ghost" className="h-8"><Download size={14} /></Button>
                        </a>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          onClick={() => openEdit(t)}
                        >
                          <PenLine size={14} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-red-600 hover:text-red-700"
                          onClick={() => { setDeleteTarget(t); setDeleteOpen(true); }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                    {approvers.length > 0 && (
                      <div className="text-xs text-gray-500 mt-2">
                        기본 승인자: {approvers.map(a => a.name).join(", ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 수정 모달 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>템플릿 수정</DialogTitle></DialogHeader>
          {editTarget && (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="space-y-2">
                <Label>템플릿명</Label>
                <Input value={editForm.name} disabled className="bg-gray-100" />
              </div>
              <div className="space-y-2">
                <Label>설명</Label>
                <Textarea
                  value={editForm.description}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>승인자</Label>
                <div className="space-y-1 border rounded-lg p-2 max-h-40 overflow-y-auto">
                  {employees.map(e => (
                    <label key={e.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                      <input
                        type="checkbox"
                        checked={editForm.approverIds.includes(e.id)}
                        onChange={ev => {
                          if (ev.target.checked) {
                            setEditForm(f => ({ ...f, approverIds: [...f.approverIds, e.id] }));
                          } else {
                            setEditForm(f => ({ ...f, approverIds: f.approverIds.filter(id => id !== e.id) }));
                          }
                        }}
                      />
                      <span className="text-sm">{e.name} ({e.department})</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
                <Button type="submit">수정</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 모달 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>템플릿 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              '{deleteTarget?.name}' 템플릿을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2 justify-end">
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              삭제
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
