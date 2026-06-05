"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Edit2, Trash2, Upload } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type ContractTemplate = {
  id: string;
  name: string;
  description?: string;
  type: string;
  fileUrl: string;
  version: number;
  isActive: boolean;
  createdBy: string;
  createdByUser: { id: string; name: string };
  approverIds: string[];
  createdAt: string;
  updatedAt: string;
};

const typeLabel: Record<string, string> = {
  EMPLOYMENT: "근로계약서",
  PART_TIME: "단시간근로계약서",
  CONFIDENTIAL: "비밀유지계약",
  OTHER: "기타",
};

export default function ContractTemplatesPage() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ContractTemplate | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const [form, setForm] = useState({
    name: "",
    description: "",
    type: "EMPLOYMENT",
    file: null as File | null,
  });

  const [uploading, setUploading] = useState(false);

  // 템플릿 목록 조회
  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/contract-templates");
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (error) {
      console.error("템플릿 로드 실패:", error);
      toast.error("템플릿 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // 템플릿 생성
  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error("템플릿명을 입력해주세요");
      return;
    }
    if (!form.file) {
      toast.error("PDF 파일을 선택해주세요");
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("name", form.name);
      formData.append("description", form.description || "");
      formData.append("type", form.type);
      formData.append("file", form.file);

      const res = await fetch("/api/contract-templates", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "생성 실패");
      }

      toast.success("템플릿이 생성되었습니다");
      setForm({ name: "", description: "", type: "EMPLOYMENT", file: null });
      setCreateOpen(false);
      fetchTemplates();
    } catch (error) {
      console.error("템플릿 생성 실패:", error);
      toast.error(error instanceof Error ? error.message : "생성 실패");
    } finally {
      setUploading(false);
    }
  };

  // 템플릿 수정
  const handleUpdate = async () => {
    if (!editTarget) return;
    if (!form.name.trim()) {
      toast.error("템플릿명을 입력해주세요");
      return;
    }

    try {
      setUploading(true);
      const body: any = {
        name: form.name,
        description: form.description || "",
      };

      // 파일이 변경된 경우에만 업로드
      if (form.file) {
        const formData = new FormData();
        formData.append("file", form.file);
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          body.fileUrl = uploadData.fileUrl;
        }
      }

      const res = await fetch(`/api/contract-templates/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "수정 실패");
      }

      toast.success("템플릿이 수정되었습니다");
      setForm({ name: "", description: "", type: "EMPLOYMENT", file: null });
      setEditOpen(false);
      setEditTarget(null);
      fetchTemplates();
    } catch (error) {
      console.error("템플릿 수정 실패:", error);
      toast.error(error instanceof Error ? error.message : "수정 실패");
    } finally {
      setUploading(false);
    }
  };

  // 템플릿 삭제
  const handleDelete = async (templateId: string) => {
    if (!confirm("정말로 삭제하시겠습니까?")) return;

    try {
      const res = await fetch(`/api/contract-templates/${templateId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("삭제 실패");
      }

      toast.success("템플릿이 삭제되었습니다");
      fetchTemplates();
    } catch (error) {
      console.error("템플릿 삭제 실패:", error);
      toast.error("삭제 실패");
    }
  };

  // 수정 모달 열기
  const openEditDialog = (template: ContractTemplate) => {
    setEditTarget(template);
    setForm({
      name: template.name,
      description: template.description || "",
      type: template.type,
      file: null,
    });
    setEditOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-500">로드 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">계약서 템플릿</h1>
        <Button onClick={() => { setForm({ name: "", description: "", type: "EMPLOYMENT", file: null }); setCreateOpen(true); }} className="gap-2">
          <Plus size={16} />
          새 템플릿 만들기
        </Button>
      </div>

      {/* 템플릿 목록 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.length === 0 ? (
          <Card className="md:col-span-2">
            <CardContent className="pt-10">
              <p className="text-center text-gray-500">등록된 템플릿이 없습니다</p>
            </CardContent>
          </Card>
        ) : (
          templates.map(template => (
            <Card key={template.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{template.name}</CardTitle>
                    <p className="text-xs text-gray-500 mt-1">
                      {template.createdByUser.name} · {format(new Date(template.createdAt), "yyyy-MM-dd")}
                    </p>
                  </div>
                  <Badge variant="outline">{typeLabel[template.type] || template.type}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {template.description && (
                  <p className="text-sm text-gray-600">{template.description}</p>
                )}
                <p className="text-xs text-gray-500">v{template.version}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1"
                    onClick={() => openEditDialog(template)}
                  >
                    <Edit2 size={14} />
                    수정
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => handleDelete(template.id)}
                  >
                    <Trash2 size={14} />
                    삭제
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* 생성 모달 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>새 템플릿 만들기</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>템플릿명 *</Label>
              <Input
                placeholder="예: 2026 신입사원 근로계약서"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>설명</Label>
              <Textarea
                placeholder="템플릿 설명 (선택사항)"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="h-20"
              />
            </div>

            <div className="space-y-2">
              <Label>계약서 유형 *</Label>
              <Select value={form.type} onValueChange={type => setForm(f => ({ ...f, type }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(typeLabel).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>PDF 파일 *</Label>
              <div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-gray-50">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={e => setForm(f => ({ ...f, file: e.target.files?.[0] || null }))}
                  className="hidden"
                  id="file-input-create"
                />
                <label htmlFor="file-input-create" className="cursor-pointer block">
                  {form.file ? (
                    <div className="space-y-1">
                      <p className="text-sm font-medium">📄 {form.file.name}</p>
                      <p className="text-xs text-gray-500">{(form.file.size / 1024 / 1024).toFixed(2)}MB</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload size={24} className="mx-auto text-gray-400" />
                      <p className="text-sm font-medium">PDF 파일 선택</p>
                      <p className="text-xs text-gray-500">또는 여기에 드래그</p>
                    </div>
                  )}
                </label>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>취소</Button>
              <Button onClick={handleCreate} disabled={uploading}>
                {uploading ? "업로드 중..." : "생성"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 수정 모달 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>템플릿 수정</DialogTitle></DialogHeader>
          {editTarget && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>템플릿명 *</Label>
                <Input
                  placeholder="예: 2026 신입사원 근로계약서"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>설명</Label>
                <Textarea
                  placeholder="템플릿 설명 (선택사항)"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="h-20"
                />
              </div>

              <div className="space-y-2">
                <Label>계약서 유형 (읽기 전용)</Label>
                <Input value={typeLabel[editTarget.type] || editTarget.type} disabled />
              </div>

              <div className="space-y-2">
                <Label>PDF 파일 (선택사항)</Label>
                <p className="text-xs text-gray-500 mb-2">새 파일을 선택하면 기존 파일이 교체됩니다</p>
                <div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-gray-50">
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={e => setForm(f => ({ ...f, file: e.target.files?.[0] || null }))}
                    className="hidden"
                    id="file-input-edit"
                  />
                  <label htmlFor="file-input-edit" className="cursor-pointer block">
                    {form.file ? (
                      <div className="space-y-1">
                        <p className="text-sm font-medium">📄 {form.file.name}</p>
                        <p className="text-xs text-gray-500">{(form.file.size / 1024 / 1024).toFixed(2)}MB</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload size={24} className="mx-auto text-gray-400" />
                        <p className="text-sm font-medium">새 PDF 파일 선택</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
                <Button onClick={handleUpdate} disabled={uploading}>
                  {uploading ? "업로드 중..." : "저장"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
