"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Building2, Search, ChevronRight, ArrowLeft, Users, Upload, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { getAllBranches } from "@/lib/branches";
import * as XLSX from "xlsx";

/* ── 직군/직급 정의 ── */
type JobGroupKey = "원장" | "CM" | "TM" | "코디";

const JOB_GROUPS: Record<JobGroupKey, {
  label: string;
  badge: string;
  dot: string;
  positions: string[];
}> = {
  원장: {
    label: "원장",
    badge: "bg-purple-100 text-purple-700 border-purple-200",
    dot:   "bg-purple-400",
    positions: ["원장"],
  },
  CM: {
    label: "매니저 (CM)",
    badge: "bg-blue-100 text-blue-700 border-blue-200",
    dot:   "bg-blue-400",
    positions: ["인턴매니저", "매니저", "주임매니저", "선임매니저", "부원장", "수석부원장"],
  },
  TM: {
    label: "교실장 (TM)",
    badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
    dot:   "bg-emerald-400",
    positions: ["인턴교실장", "교실장", "주임교실장", "선임교실장", "부원장", "수석부원장"],
  },
  코디: {
    label: "코디",
    badge: "bg-orange-100 text-orange-700 border-orange-200",
    dot:   "bg-orange-400",
    positions: ["코디"],
  },
};

const JOB_GROUP_ORDER: JobGroupKey[] = ["원장", "CM", "TM", "코디"];

// 직군 없음 fallback 스타일
const UNKNOWN_BADGE = "bg-gray-100 text-gray-500 border-gray-200";

// 시스템 역할 (ADMIN/MANAGER/EMPLOYEE)
const ROLE_CFG: Record<string, { label: string; cls: string }> = {
  ADMIN:    { label: "관리자", cls: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  MANAGER:  { label: "원장/매니저", cls: "bg-violet-100 text-violet-700 border-violet-200" },
  EMPLOYEE: { label: "직원", cls: "bg-gray-100 text-gray-500 border-gray-200" },
};

/* ── 타입 ── */
type Employee = {
  id: string; name: string; email: string; role: string;
  department: string | null; jobGroup: string | null; position: string | null;
  branch: string | null; phone: string | null; hireDate: string | null;
  leaveBalance: { remaining: number; used: number; total: number } | null;
};

const EMPTY_FORM = {
  name: "", email: "", password: "", role: "EMPLOYEE",
  department: "", jobGroup: "", position: "", branch: "", phone: "", hireDate: "",
};

/* ── 직급 선택 컴포넌트 ── */
function PositionSelector({
  jobGroup, position,
  onGroupChange, onPositionChange,
  disabled,
}: {
  jobGroup: string; position: string;
  onGroupChange: (g: string) => void;
  onPositionChange: (p: string) => void;
  disabled?: boolean;
}) {
  const groupCfg = JOB_GROUPS[jobGroup as JobGroupKey];
  const positions = groupCfg?.positions ?? [];

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1.5">
        <Label>직군</Label>
        <Select
          value={jobGroup || ""}
          onValueChange={g => g && (onGroupChange(g), onPositionChange(""))}
          disabled={disabled}
        >
          <SelectTrigger><SelectValue placeholder="직군 선택" /></SelectTrigger>
          <SelectContent>
            {JOB_GROUP_ORDER.map(k => (
              <SelectItem key={k} value={k}>
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${JOB_GROUPS[k].dot}`} />
                  {JOB_GROUPS[k].label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>직급</Label>
        <Select
          value={position || ""}
          onValueChange={(p) => p && onPositionChange(p)}
          disabled={disabled || !jobGroup}
        >
          <SelectTrigger><SelectValue placeholder="직급 선택" /></SelectTrigger>
          <SelectContent>
            {positions.map(p => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/* ── 직급 뱃지 ── */
function PositionBadge({ jobGroup, position }: { jobGroup: string | null; position: string | null }) {
  const cfg = JOB_GROUPS[jobGroup as JobGroupKey];
  if (!cfg && !position) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${cfg?.badge ?? UNKNOWN_BADGE}`}>
      {cfg && <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />}
      {cfg ? `${cfg.label} · ${position || "-"}` : position}
    </span>
  );
}

export default function EmployeesPage() {
  const [employees, setEmployees]   = useState<Employee[]>([]);
  const [myRole, setMyRole]         = useState("EMPLOYEE");
  const [myBranch, setMyBranch]     = useState<string | null>(null);
  const [branchesFromDB, setBranchesFromDB] = useState<Array<{ id: string; name: string }>>([]);

  const [addOpen, setAddOpen]       = useState(false);
  const [form, setForm]             = useState({ ...EMPTY_FORM });

  const [editOpen, setEditOpen]     = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [editForm, setEditForm]     = useState({ ...EMPTY_FORM });

  const [resignOpen, setResignOpen]       = useState(false);
  const [resignTarget, setResignTarget]   = useState<Employee | null>(null);
  const [resignForm, setResignForm]       = useState({ resignDate: "", resignReason: "" });

  const [excelUploadOpen, setExcelUploadOpen] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);

  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [search, setSearch]                 = useState("");
  const [filterJobGroup, setFilterJobGroup] = useState("all");

  const isAdmin   = myRole === "ADMIN";
  const isManager = myRole === "MANAGER";

  const fetchEmployees = useCallback(async () => {
    const data = await fetch("/api/employees").then(r => r.json());
    setEmployees(data.employees || []);
  }, []);

  useEffect(() => {
    fetchEmployees();
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      setMyRole(d.user?.role || "EMPLOYEE");
      setMyBranch(d.user?.branch ?? null);
    });
    // 데이터베이스에서 실제 지점 목록 로드
    (async () => {
      const branches = await getAllBranches();
      setBranchesFromDB(branches);
    })();
  }, [fetchEmployees]);

  const branches = useMemo(
    () => Array.from(new Set(employees.map(e => e.branch).filter(Boolean) as string[])).sort(),
    [employees]
  );

  // 지점 카드 요약 (지점명 → { total, byJobGroup })
  const branchSummary = useMemo(() => {
    const map: Record<string, { total: number; byJobGroup: Record<string, number> }> = {};
    for (const emp of employees) {
      const b = emp.branch || "미지정";
      if (!map[b]) map[b] = { total: 0, byJobGroup: {} };
      map[b].total++;
      const jg = emp.jobGroup || "기타";
      map[b].byJobGroup[jg] = (map[b].byJobGroup[jg] ?? 0) + 1;
    }
    return map;
  }, [employees]);

  const branchOrder = useMemo(
    () => Object.keys(branchSummary).sort((a, b) =>
      a === "미지정" ? 1 : b === "미지정" ? -1 : a.localeCompare(b)
    ),
    [branchSummary]
  );

  // 상세 뷰: 선택된 지점의 직원만 + 검색/직군 필터
  const detailEmployees = useMemo(() => {
    if (selectedBranch === null) return [];
    return employees.filter(e => {
      const matchBranch   = (e.branch || "미지정") === selectedBranch;
      const matchSearch   = !search || [e.name, e.department, e.position, e.jobGroup].some(v => v?.includes(search));
      const matchJobGroup = filterJobGroup === "all" || e.jobGroup === filterJobGroup;
      return matchBranch && matchSearch && matchJobGroup;
    });
  }, [employees, selectedBranch, search, filterJobGroup]);

  // 상세 뷰: 직군별 그룹핑
  const detailGrouped = useMemo(() => {
    const map: Record<string, Employee[]> = {};
    for (const emp of detailEmployees) {
      const jg = emp.jobGroup || "기타";
      if (!map[jg]) map[jg] = [];
      map[jg].push(emp);
    }
    return map;
  }, [detailEmployees]);

  /* ── 추가 ── */
  async function handleAdd(ev: React.FormEvent) {
    ev.preventDefault();
    const res  = await fetch("/api/employees", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("직원이 등록되었습니다.");
    setAddOpen(false); setForm({ ...EMPTY_FORM }); fetchEmployees();
  }

  /* ── 엑셀 업로드 ── */
  async function handleExcelUpload(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;

    try {
      setExcelLoading(true);
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet);

      if (data.length === 0) {
        toast.error("엑셀 파일에 데이터가 없습니다.");
        setExcelLoading(false);
        return;
      }

      // API로 전송
      const res = await fetch("/api/employees/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employees: data }),
      });

      const result = await res.json();
      if (!res.ok) {
        toast.error(result.error || "업로드 실패");
        return;
      }

      toast.success(`${result.created}명이 등록되었습니다. (${result.failed}명 실패)`);
      setExcelUploadOpen(false);
      fetchEmployees();
    } catch (error) {
      console.error("엑셀 파일 처리 오류:", error);
      toast.error("파일 처리 중 오류가 발생했습니다.");
    } finally {
      setExcelLoading(false);
      ev.target.value = "";
    }
  }

  /* ── 수정 열기 ── */
  function openEdit(emp: Employee) {
    setEditTarget(emp);
    setEditForm({
      name:       emp.name,
      email:      emp.email,
      password:   "",
      role:       emp.role,
      department: emp.department ?? "",
      jobGroup:   emp.jobGroup   ?? "",
      position:   emp.position   ?? "",
      branch:     emp.branch     ?? "",
      phone:      emp.phone      ?? "",
      hireDate:   emp.hireDate ? format(new Date(emp.hireDate), "yyyy-MM-dd") : "",
    });
    setEditOpen(true);
  }

  /* ── 퇴사 처리 열기 ── */
  function openResign(emp: Employee) {
    setResignTarget(emp);
    setResignForm({ resignDate: "", resignReason: "" });
    setResignOpen(true);
  }

  /* ── 수정 저장 ── */
  async function handleEdit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!editTarget) return;
    const res  = await fetch(`/api/employees/${editTarget.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:       editForm.name,
        role:       isAdmin ? editForm.role : undefined,
        department: editForm.department,
        jobGroup:   editForm.jobGroup  || null,
        position:   editForm.position  || null,
        branch:     editForm.branch || null,
        phone:      editForm.phone,
        hireDate:   editForm.hireDate || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("정보가 수정되었습니다.");
    setEditOpen(false); fetchEmployees();
  }

  /* ── 퇴사 처리 저장 ── */
  async function handleResign(ev: React.FormEvent) {
    ev.preventDefault();
    if (!resignTarget || !resignForm.resignDate) return;
    const res = await fetch(`/api/employees/${resignTarget.id}/resign`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resignDate: resignForm.resignDate,
        resignReason: resignForm.resignReason || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success(`${resignTarget.name} 직원이 퇴사 처리되었습니다.`);
    setResignOpen(false); fetchEmployees();
  }

  /* ── 직원 카드 (공통) ── */
  function EmployeeCard({ emp }: { emp: Employee }) {
    const cfg = JOB_GROUPS[emp.jobGroup as JobGroupKey];
    const rc  = ROLE_CFG[emp.role] ?? ROLE_CFG.EMPLOYEE;
    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold
                ${cfg ? cfg.badge : "bg-gray-100 text-gray-600"}`}>
                {emp.name[0]}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">{emp.name}</span>
                  <PositionBadge jobGroup={emp.jobGroup} position={emp.position} />
                  {emp.role !== "EMPLOYEE" && (
                    <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${rc.cls}`}>
                      {rc.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  {[emp.department, emp.email].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right space-y-0.5 hidden sm:block">
                {emp.leaveBalance && (
                  <p className="text-sm">
                    <span className="text-gray-400">연차 </span>
                    <span className="font-semibold text-blue-600">{emp.leaveBalance.remaining}일</span>
                    <span className="text-gray-300"> / {emp.leaveBalance.total}일</span>
                  </p>
                )}
                {emp.hireDate && (
                  <p className="text-xs text-gray-400">입사 {format(new Date(emp.hireDate), "yy.MM.dd")}</p>
                )}
                {emp.phone && <p className="text-xs text-gray-400">{emp.phone}</p>}
              </div>
              {(isAdmin || isManager) && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gray-400 hover:text-gray-700"
                    onClick={() => openEdit(emp)}>
                    <Pencil size={13} />
                  </Button>
                  {isAdmin && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gray-400 hover:text-red-600"
                      onClick={() => openResign(emp)}>
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  /* ── 렌더 ── */
  return (
    <div className="space-y-6">

      {/* ════ 지점 상세 뷰 ════ */}
      {selectedBranch !== null ? (
        <>
          {/* 헤더 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" className="gap-1 text-gray-500"
                onClick={() => { setSelectedBranch(null); setSearch(""); setFilterJobGroup("all"); }}>
                <ArrowLeft size={16} />목록
              </Button>
              <div className="w-px h-5 bg-gray-200" />
              <Building2 size={18} className="text-blue-500" />
              <h1 className="text-xl font-bold text-gray-900">{selectedBranch}</h1>
              <span className="text-sm text-gray-400">{detailEmployees.length}명</span>
            </div>
            {(isAdmin || isManager) && (
              <Button className="gap-2" onClick={() => setAddOpen(true)}>
                <Plus size={16} />직원 추가
              </Button>
            )}
          </div>

          {/* 필터 */}
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input placeholder="이름·부서·직급 검색" value={search}
                onChange={e => setSearch(e.target.value)} className="pl-8 w-44 h-8 text-sm" />
            </div>
            <Select value={filterJobGroup} onValueChange={(v) => v && setFilterJobGroup(v)}>
              <SelectTrigger className="w-36 h-8 text-sm bg-white"><SelectValue placeholder="전체 직군" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 직군</SelectItem>
                {JOB_GROUP_ORDER.map(k => (
                  <SelectItem key={k} value={k}>
                    <span className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${JOB_GROUPS[k].dot}`} />
                      {JOB_GROUPS[k].label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 직군별 그룹 */}
          {[...JOB_GROUP_ORDER, "기타"].map(jg => {
            const emps = detailGrouped[jg];
            if (!emps || emps.length === 0) return null;
            const cfg = JOB_GROUPS[jg as JobGroupKey];
            return (
              <div key={jg}>
                <div className="flex items-center gap-2 mb-2">
                  {cfg && <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />}
                  <span className="text-sm font-semibold text-gray-600">
                    {cfg ? cfg.label : "직군 미지정"}
                  </span>
                  <span className="text-xs text-gray-400">{emps.length}명</span>
                </div>
                <div className="grid gap-2">
                  {emps.map(emp => <EmployeeCard key={emp.id} emp={emp} />)}
                </div>
              </div>
            );
          })}

          {detailEmployees.length === 0 && (
            <div className="text-center text-gray-400 py-16">조건에 맞는 직원이 없습니다.</div>
          )}
        </>

      ) : (
        /* ════ 지점 목록 뷰 ════ */
        <>
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">직원 관리</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                총 {employees.length}명 · {branchOrder.length}개 지점
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="gap-2" onClick={() => setExcelUploadOpen(true)}>
                <Upload size={16} />엑셀 업로드
              </Button>
              <Button className="gap-2" onClick={() => setAddOpen(true)}>
                <Plus size={16} />직원 추가
              </Button>
            </div>
          </div>

          {/* 지점별 직원 표시 */}
          {branchOrder.length > 0 ? (
            <div className="space-y-8">
              {branchOrder.map(b => {
                const summary = branchSummary[b];
                const branchEmps = employees.filter(e => (e.branch || "미지정") === b);
                return (
                  <div key={b}>
                    {/* 지점 헤더 */}
                    <div className="flex items-center gap-3 mb-4 pb-3 border-b">
                      <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                        <Building2 size={16} className="text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <h2 className="font-bold text-lg text-gray-900">{b}</h2>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Users size={14} />
                        <span>{summary.total}명</span>
                      </div>
                    </div>

                    {/* 직원 목록 (직군별) */}
                    {[...JOB_GROUP_ORDER, "기타"].map(jg => {
                      const emps = branchEmps.filter(e => (e.jobGroup || "기타") === jg);
                      if (emps.length === 0) return null;
                      const cfg = JOB_GROUPS[jg as JobGroupKey];
                      return (
                        <div key={jg} className="mb-5">
                          <div className="flex items-center gap-2 mb-2 ml-2">
                            {cfg && <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />}
                            <span className="text-sm font-semibold text-gray-600">
                              {cfg ? cfg.label : "직군 미지정"}
                            </span>
                            <span className="text-xs text-gray-400">{emps.length}명</span>
                          </div>
                          <div className="grid gap-2">
                            {emps.map(emp => <EmployeeCard key={emp.id} emp={emp} />)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-20">등록된 직원이 없습니다.</div>
          )}
        </>
      )}

      {/* ═══ 직원 추가 다이얼로그 ═══ */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>직원 추가</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>이름 *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="space-y-1.5">
                <Label>이메일 *</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>비밀번호 *</Label>
                <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
              </div>
              <div className="space-y-1.5">
                <Label>지점</Label>
                <Select value={form.branch} onValueChange={v => setForm(f => ({ ...f, branch: v }))}>
                  <SelectTrigger><SelectValue placeholder="지점 선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">선택 안 함</SelectItem>
                    {branchesFromDB.map(b => (
                      <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 직군/직급 */}
            <PositionSelector
              jobGroup={form.jobGroup} position={form.position}
              onGroupChange={g => setForm(f => ({ ...f, jobGroup: g, position: "" }))}
              onPositionChange={p => setForm(f => ({ ...f, position: p }))}
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>부서</Label>
                <Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>시스템 권한</Label>
                <Select value={form.role} onValueChange={v => v && setForm(f => ({ ...f, role: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMPLOYEE">직원</SelectItem>
                    <SelectItem value="MANAGER">원장/매니저 (지점장)</SelectItem>
                    {isAdmin && <SelectItem value="ADMIN">관리자</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>연락처</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="010-0000-0000" />
              </div>
              <div className="space-y-1.5">
                <Label>입사일</Label>
                <Input type="date" value={form.hireDate} onChange={e => setForm(f => ({ ...f, hireDate: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>취소</Button>
              <Button type="submit">등록</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ 엑셀 업로드 다이얼로그 ═══ */}
      <Dialog open={excelUploadOpen} onOpenChange={setExcelUploadOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>엑셀로 직원 일괄 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-900 font-medium mb-2">📋 엑셀 파일 형식</p>
              <div className="text-xs text-blue-700 space-y-1">
                <div>필수 열: name (이름), email (이메일), password (비밀번호)</div>
                <div>선택 열: phone, department, branch, jobGroup, position, role, hireDate</div>
                <div>첫 번째 행은 헤더로 인식됩니다.</div>
              </div>
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <Input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleExcelUpload}
                disabled={excelLoading}
                className="hidden"
                id="excel-file"
              />
              <label htmlFor="excel-file" className="cursor-pointer">
                <div className="flex flex-col items-center gap-2">
                  <Upload size={24} className="text-gray-400" />
                  <p className="text-sm font-medium text-gray-700">
                    {excelLoading ? "파일 처리 중..." : "파일을 클릭하거나 드래그"}
                  </p>
                  <p className="text-xs text-gray-500">.xlsx, .xls, .csv</p>
                </div>
              </label>
            </div>

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setExcelUploadOpen(false)} disabled={excelLoading}>
                취소
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══ 직원 수정 다이얼로그 ═══ */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>직원 정보 수정</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>이름</Label>
                <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              {isAdmin && (
                <div className="space-y-1.5">
                  <Label>지점</Label>
                  <Select value={editForm.branch} onValueChange={v => v !== null && setEditForm(f => ({ ...f, branch: v }))}>
                    <SelectTrigger><SelectValue placeholder="지점 선택" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">선택 안 함</SelectItem>
                      {branchesFromDB.map(b => (
                        <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* 직군/직급 */}
            <PositionSelector
              jobGroup={editForm.jobGroup} position={editForm.position}
              onGroupChange={g => setEditForm(f => ({ ...f, jobGroup: g, position: "" }))}
              onPositionChange={p => setEditForm(f => ({ ...f, position: p }))}
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>부서</Label>
                <Input value={editForm.department} onChange={e => setEditForm(f => ({ ...f, department: e.target.value }))} />
              </div>
              {isAdmin && (
                <div className="space-y-1.5">
                  <Label>시스템 권한</Label>
                  <Select value={editForm.role} onValueChange={v => v && setEditForm(f => ({ ...f, role: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EMPLOYEE">직원</SelectItem>
                      <SelectItem value="MANAGER">원장/매니저 (지점장)</SelectItem>
                      <SelectItem value="ADMIN">관리자</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>연락처</Label>
                <Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>입사일</Label>
                <Input type="date" value={editForm.hireDate} onChange={e => setEditForm(f => ({ ...f, hireDate: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
              <Button type="submit">저장</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ 퇴사 처리 다이얼로그 ═══ */}
      <Dialog open={resignOpen} onOpenChange={setResignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>퇴사 처리</DialogTitle>
          </DialogHeader>
          {resignTarget && (
            <form onSubmit={handleResign} className="space-y-4">
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <p className="text-sm font-medium text-blue-900">
                  {resignTarget.name} ({resignTarget.position})을(를) 퇴사 처리합니다.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>퇴사일 *</Label>
                <Input
                  type="date"
                  value={resignForm.resignDate}
                  onChange={e => setResignForm(f => ({ ...f, resignDate: e.target.value }))}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label>퇴사사유 (선택사항)</Label>
                <Input
                  type="text"
                  placeholder="예: 개인사유, 이직 등"
                  value={resignForm.resignReason}
                  onChange={e => setResignForm(f => ({ ...f, resignReason: e.target.value }))}
                />
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="outline" onClick={() => setResignOpen(false)}>취소</Button>
                <Button type="submit" variant="destructive">퇴사 처리</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
