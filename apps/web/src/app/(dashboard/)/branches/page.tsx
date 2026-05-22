"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Building2, Plus, PenLine, Trash2, MapPin } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Branch = {
  id: string;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radius: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { users: number };
};

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [role, setRole] = useState("EMPLOYEE");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    address: "",
    radius: 100,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Branch | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    address: "",
    radius: 100,
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      const userRole = d.user?.role || "EMPLOYEE";
      setRole(userRole);
      if (userRole !== "EMPLOYEE") {
        fetchBranches();
      }
    });
  }, []);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch("/api/branches");
      const data = await res.json();
      setBranches(data.branches || []);
    } catch (error) {
      console.error("지점 로드 실패:", error);
      toast.error("지점을 불러올 수 없습니다.");
    }
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.name) {
      toast.error("지점명을 입력해주세요.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createForm),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast.error(data.error);
      return;
    }
    toast.success("지점이 생성되었습니다.");
    setCreateOpen(false);
    setCreateForm({ name: "", address: "", radius: 100 });
    fetchBranches();
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;

    setLoading(true);
    const res = await fetch(`/api/branches/${editTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast.error(data.error);
      return;
    }
    toast.success("지점이 수정되었습니다.");
    setEditOpen(false);
    setEditTarget(null);
    fetchBranches();
  }

  async function handleDelete() {
    if (!deleteTarget) return;

    setLoading(true);
    const res = await fetch(`/api/branches/${deleteTarget.id}`, {
      method: "DELETE",
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast.error(data.error);
      return;
    }
    toast.success("지점이 삭제되었습니다.");
    setDeleteOpen(false);
    setDeleteTarget(null);
    fetchBranches();
  }

  const openEdit = (branch: Branch) => {
    setEditTarget(branch);
    setEditForm({
      name: branch.name,
      address: branch.address || "",
      radius: branch.radius,
    });
    setEditOpen(true);
  };

  if (role === "EMPLOYEE") {
    return (
      <div className="flex items-center justify-center min-h-screen text-center">
        <div className="space-y-2">
          <p className="text-gray-600">권한이 없습니다.</p>
          <p className="text-sm text-gray-500">관리자 또는 매니저만 지점을 관리할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">지점 관리</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <Button variant="default" className="gap-2">
            <Plus size={16} />
            새 지점 추가
          </Button>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>새 지점 추가</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>지점명 *</Label>
                <Input
                  value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="예: 서울강남점"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>주소</Label>
                <Input
                  value={createForm.address}
                  onChange={e => setCreateForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="예: 서울시 강남구..."
                />
              </div>
              <div className="space-y-2">
                <Label>위치 허용 반경 (미터) *</Label>
                <Input
                  type="number"
                  value={createForm.radius}
                  onChange={e => setCreateForm(f => ({ ...f, radius: parseInt(e.target.value) || 100 }))}
                  min="50"
                  max="1000"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  취소
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "저장 중..." : "추가"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 size={18} />
            지점 목록
          </CardTitle>
        </CardHeader>
        <CardContent>
          {branches.length === 0 ? (
            <div className="py-8 text-center text-gray-400">지점이 없습니다.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {branches.map(branch => (
                <div key={branch.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg text-gray-900">{branch.name}</h3>
                      {branch.address && (
                        <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                          <MapPin size={12} />
                          {branch.address}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-2">
                        반경: {branch.radius}m
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => openEdit(branch)}
                      >
                        <PenLine size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-red-600 hover:text-red-700"
                        onClick={() => {
                          setDeleteTarget(branch);
                          setDeleteOpen(true);
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                  <div className="border-t pt-2">
                    <p className="text-xs text-gray-500">
                      생성: {format(new Date(branch.createdAt), "yyyy-MM-dd")}
                    </p>
                    {branch._count?.users !== undefined && (
                      <p className="text-xs text-gray-600 font-medium mt-1">
                        배치된 직원: {branch._count.users}명
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 수정 모달 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>지점 수정</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="space-y-2">
                <Label>지점명</Label>
                <Input
                  value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>주소</Label>
                <Input
                  value={editForm.address}
                  onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>위치 허용 반경 (미터)</Label>
                <Input
                  type="number"
                  value={editForm.radius}
                  onChange={e => setEditForm(f => ({ ...f, radius: parseInt(e.target.value) || 100 }))}
                  min="50"
                  max="1000"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  취소
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "저장 중..." : "수정"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 모달 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>지점 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              '{deleteTarget?.name}' 지점을 삭제하시겠습니까?
              {deleteTarget?._count?.users && deleteTarget._count.users > 0 && (
                <span className="block mt-2 text-red-600">
                  경고: {deleteTarget._count.users}명의 직원이 이 지점에 배치되어 있습니다.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2 justify-end">
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={loading}
              className="bg-red-600 hover:bg-red-700"
            >
              {loading ? "삭제 중..." : "삭제"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
