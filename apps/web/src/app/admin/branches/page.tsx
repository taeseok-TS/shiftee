"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, MapPin, Navigation, CheckCircle2, AlertCircle, Map } from "lucide-react";
import { toast } from "sonner";
import { geocodeAddress } from "@/lib/kakao-geocoding";

type Branch = {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radius: number;
  _count?: { users: number };
};

const EMPTY_FORM = { name: "", address: "", latitude: "", longitude: "", radius: "100" };

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [myRole, setMyRole]     = useState<string | null>(null);  // null = 로딩 중

  const [addOpen, setAddOpen]   = useState(false);
  const [form, setForm]         = useState({ ...EMPTY_FORM });

  const [editOpen, setEditOpen]     = useState(false);
  const [editTarget, setEditTarget] = useState<Branch | null>(null);
  const [editForm, setEditForm]     = useState({ ...EMPTY_FORM });

  const [deleteOpen, setDeleteOpen]     = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);

  const isAdmin = myRole === "ADMIN";
  const canAccess = myRole === "ADMIN" || myRole === "MANAGER";

  const fetchBranches = useCallback(async () => {
    const data = await fetch("/api/branches", { credentials: "include" }).then(r => r.json());
    setBranches(data.branches || []);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" }).then(r => r.json()).then(d => setMyRole(d.user?.role || "EMPLOYEE"));
    fetchBranches();
  }, [fetchBranches]);

  /* ── 내 위치로 좌표 채우기 ── */
  function fillMyLocation(target: "add" | "edit") {
    if (!navigator.geolocation) { toast.error("이 브라우저는 위치를 지원하지 않습니다."); return; }

    // HTTPS 또는 localhost 환경 확인
    const isSecure = window.location.protocol === "https:" || window.location.hostname === "localhost";
    if (!isSecure) {
      toast.error("HTTPS 연결에서만 위치 기능을 사용할 수 있습니다.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude.toFixed(7);
        const lon = pos.coords.longitude.toFixed(7);
        if (target === "add") setForm(f => ({ ...f, latitude: lat, longitude: lon }));
        else                  setEditForm(f => ({ ...f, latitude: lat, longitude: lon }));
        toast.success("현재 위치 좌표를 불러왔습니다.");
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          toast.error("위치 권한이 거부되었습니다.");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          toast.error("위치 정보를 얻을 수 없습니다.");
        } else {
          toast.error("위치를 불러올 수 없습니다.");
        }
      }
    );
  }

  /* ── 주소로부터 좌표 검색 (Kakao Geocoding) ── */
  async function fillLocationFromAddress(target: "add" | "edit") {
    const address = target === "add" ? form.address : editForm.address;

    if (!address.trim()) {
      toast.error("주소를 입력해주세요.");
      return;
    }

    try {
      toast.loading("주소를 검색 중입니다...");
      const result = await geocodeAddress(address);

      const lat = result.latitude.toFixed(7);
      const lon = result.longitude.toFixed(7);

      if (target === "add") {
        setForm(f => ({ ...f, latitude: lat, longitude: lon }));
      } else {
        setEditForm(f => ({ ...f, latitude: lat, longitude: lon }));
      }

      toast.success(`주소 위치를 찾았습니다.\n${result.fullAddress}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "주소 검색에 실패했습니다.";
      toast.error(errorMsg);
    }
  }

  /* ── 추가 ── */
  async function handleAdd(ev: React.FormEvent) {
    ev.preventDefault();
    const res  = await fetch("/api/branches", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        address: form.address || null,
        latitude:  form.latitude  !== "" ? Number(form.latitude)  : null,
        longitude: form.longitude !== "" ? Number(form.longitude) : null,
        radius: Number(form.radius) || 100,
      }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("지점이 등록되었습니다.");
    setAddOpen(false); setForm({ ...EMPTY_FORM }); fetchBranches();
  }

  /* ── 수정 열기 ── */
  function openEdit(b: Branch) {
    setEditTarget(b);
    setEditForm({
      name:      b.name,
      address:   b.address   ?? "",
      latitude:  b.latitude  != null ? String(b.latitude)  : "",
      longitude: b.longitude != null ? String(b.longitude) : "",
      radius:    String(b.radius),
    });
    setEditOpen(true);
  }

  /* ── 수정 저장 ── */
  async function handleEdit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!editTarget) return;
    const res = await fetch(`/api/branches/${editTarget.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:      editForm.name,
        address:   editForm.address || null,
        latitude:  editForm.latitude  !== "" ? Number(editForm.latitude)  : null,
        longitude: editForm.longitude !== "" ? Number(editForm.longitude) : null,
        radius:    Number(editForm.radius) || 100,
      }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("지점 정보가 수정되었습니다.");
    setEditOpen(false); fetchBranches();
  }

  /* ── 삭제 ── */
  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/branches/${deleteTarget.id}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("지점이 삭제되었습니다.");
    setDeleteOpen(false); setDeleteTarget(null); fetchBranches();
  }

  if (myRole === null) {
    return <div className="text-center text-gray-400 py-32">로딩 중...</div>;
  }

  if (!canAccess) {
    return <div className="text-center text-gray-400 py-32">접근 권한이 없습니다.</div>;
  }

  const configured = branches.filter(b => b.latitude != null && b.longitude != null).length;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">지점 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            총 {branches.length}개 지점 · GPS 설정 완료 <span className="font-semibold text-blue-600">{configured}</span>개
          </p>
        </div>
        {isAdmin && (
          <Button className="gap-2" onClick={() => setAddOpen(true)}>
            <Plus size={16} />지점 추가
          </Button>
        )}
      </div>

      {/* 안내 배너 */}
      {isAdmin && branches.some(b => b.latitude == null) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-2 text-sm text-amber-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            위도/경도가 설정되지 않은 지점은 지오펜스가 적용되지 않습니다.
            좌표는 <a href="https://map.kakao.com" target="_blank" rel="noreferrer" className="underline font-medium">카카오맵</a>이나
            <a href="https://maps.google.com" target="_blank" rel="noreferrer" className="underline font-medium ml-1">구글맵</a>에서
            지점 위치를 우클릭하면 확인할 수 있습니다.
          </span>
        </div>
      )}

      {/* 지점 목록 */}
      <div className="grid gap-3">
        {branches.map(b => {
          const hasGeo = b.latitude != null && b.longitude != null;
          return (
            <Card key={b.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-4 px-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* 상태 아이콘 */}
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                      hasGeo ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"
                    }`}>
                      <MapPin size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{b.name}</span>
                        {hasGeo ? (
                          <Badge variant="outline" className="text-xs text-blue-600 border-blue-200 bg-blue-50 gap-1">
                            <CheckCircle2 size={11} />지오펜스 {b.radius}m
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-gray-400 border-gray-200">
                            GPS 미설정
                          </Badge>
                        )}
                        {b._count?.users ? (
                          <Badge variant="secondary" className="text-xs">
                            직원 {b._count.users}명
                          </Badge>
                        ) : null}
                      </div>
                      {b.address && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{b.address}</p>
                      )}
                      {hasGeo && (
                        <p className="text-xs text-gray-400 mt-0.5 font-mono">
                          {b.latitude?.toFixed(5)}, {b.longitude?.toFixed(5)}
                        </p>
                      )}
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0"
                        onClick={() => openEdit(b)}>
                        <Pencil size={14} />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => { setDeleteTarget(b); setDeleteOpen(true); }}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {branches.length === 0 && (
        <div className="text-center text-gray-400 py-20">등록된 지점이 없습니다.</div>
      )}

      {/* ═══ 지점 추가 다이얼로그 ═══ */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>지점 추가</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-1.5">
              <Label>지점명 *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="예: A지점" required />
            </div>
            <div className="space-y-1.5">
              <Label>주소</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="예: 서울시 강남구 테헤란로 123" />
            </div>

            {/* 좌표 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>GPS 좌표 (위도 / 경도)</Label>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => fillLocationFromAddress("add")}>
                    <Map size={12} />주소 위치
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => fillMyLocation("add")}>
                    <Navigation size={12} />현재 위치
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input value={form.latitude}
                  onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))}
                  placeholder="위도  예: 37.5665" />
                <Input value={form.longitude}
                  onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))}
                  placeholder="경도  예: 126.9780" />
              </div>
              <p className="text-xs text-gray-400">
                위의 버튼으로 자동 입력하거나 카카오맵/구글맵에서 우클릭 → 위도·경도 복사
              </p>
            </div>

            {/* 반경 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>허용 반경</Label>
                <span className="text-sm font-semibold text-blue-600">{form.radius}m</span>
              </div>
              <input type="range" min="50" max="300" step="10"
                value={form.radius}
                onChange={e => setForm(f => ({ ...f, radius: e.target.value }))}
                className="w-full accent-blue-600" />
              <div className="flex justify-between text-xs text-gray-400">
                <span>50m</span><span>100m</span><span>200m</span><span>300m</span>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>취소</Button>
              <Button type="submit">등록</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ 지점 수정 다이얼로그 ═══ */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>지점 정보 수정 — {editTarget?.name}</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>지점명 *</Label>
              <Input value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>주소</Label>
              <Input value={editForm.address}
                onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
                placeholder="예: 서울시 강남구 테헤란로 123" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>GPS 좌표 (위도 / 경도)</Label>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => fillLocationFromAddress("edit")}>
                    <Map size={12} />주소 위치
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => fillMyLocation("edit")}>
                    <Navigation size={12} />현재 위치
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input value={editForm.latitude}
                  onChange={e => setEditForm(f => ({ ...f, latitude: e.target.value }))}
                  placeholder="위도  예: 37.5665" />
                <Input value={editForm.longitude}
                  onChange={e => setEditForm(f => ({ ...f, longitude: e.target.value }))}
                  placeholder="경도  예: 126.9780" />
              </div>
              <p className="text-xs text-gray-400">
                위의 버튼으로 자동 입력하거나 카카오맵/구글맵에서 우클릭 → 위도·경도 복사
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>허용 반경</Label>
                <span className="text-sm font-semibold text-blue-600">{editForm.radius}m</span>
              </div>
              <input type="range" min="50" max="300" step="10"
                value={editForm.radius}
                onChange={e => setEditForm(f => ({ ...f, radius: e.target.value }))}
                className="w-full accent-blue-600" />
              <div className="flex justify-between text-xs text-gray-400">
                <span>50m</span><span>100m</span><span>200m</span><span>300m</span>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
              <Button type="submit">저장</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ 지점 삭제 확인 다이얼로그 ═══ */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>지점 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              '{deleteTarget?.name}' 지점을 정말로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
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
