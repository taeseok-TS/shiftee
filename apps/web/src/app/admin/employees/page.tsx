"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, Trash2, PenLine, Users, UserCheck, UserX, Building2, Upload, Download } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import * as XLSX from "xlsx";

type Employee = {
  id: string;
  empNo: number | null;
  name: string;
  email: string;
  role: string;
  department: string | null;
  jobGroup: string | null;
  position: string | null;
  branch: string | null;
  hireDate: string | null;
  birthDate: string | null;
  resignDate: string | null; // 있으면 그날까지 재직, 지나면 자동으로 퇴직자 처리
  resignReason: string | null;
  phone: string | null;
  leaveBalance?: {
    remaining: number;
    used: number;
    total: number;
  };
  device?: { deviceName: string | null; platform: string | null; createdAt: string } | null;
  managerBranches?: string[]; // 원장 겸직 지점 (대표 지점 외 추가 담당)
};

// 직책/직급 옵션 — 본부 소속은 별도 체계, 그 외 지점은 기존 학원 체계
const HQ_BRANCH = "본부";
const JOBGROUP_DEFAULT = ["원장", "CM", "TM", "코디", "학습실장", "튜터"];
const JOBGROUP_HQ = ["본부", "대표이사", "본부장", "팀장"];
const POSITION_DEFAULT = ["매니저", "주임매니저", "선임매니저", "부원장", "수석부원장", "교실장", "주임교실장", "선임교실장"];
const POSITION_HQ = ["사원", "주임", "대리", "과장", "차장", "부장", "팀장", "본부장", "대표이사", "본부"];
const jobGroupOptions = (branch: string | null | undefined) => (branch === HQ_BRANCH ? JOBGROUP_HQ : JOBGROUP_DEFAULT);
const positionOptions = (branch: string | null | undefined) => (branch === HQ_BRANCH ? POSITION_HQ : POSITION_DEFAULT);

const roleLabel: Record<string, string> = {
  ADMIN: "관리자",
  MANAGER: "원장",
  EMPLOYEE: "직원",
};

const roleColor: Record<string, string> = {
  ADMIN: "bg-red-100 text-red-800",
  MANAGER: "bg-blue-100 text-blue-800",
  EMPLOYEE: "bg-gray-100 text-gray-800",
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [filterRole, setFilterRole] = useState<string>("ALL");
  const [filterBranch, setFilterBranch] = useState<string>("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // 선택 삭제 — 잘못 업로드한 직원을 골라서 한 번에 삭제 (활동 기록 있으면 서버가 거부)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(
      `선택한 ${selectedIds.size}명을 완전히 삭제합니다.\n` +
      `삭제된 직원은 복구할 수 없으며, 같은 이메일·사원번호로 다시 업로드할 수 있게 됩니다.\n` +
      `(출퇴근·휴가·메시지 등 활동 기록이 있는 직원은 삭제되지 않고 안내됩니다)\n진행할까요?`
    )) return;
    setBulkDeleting(true);
    try {
      const res = await fetch("/api/employees/bulk-delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedIds] }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || "삭제 실패"); return; }
      toast.success(`${d.deleted}명 삭제 완료${d.failed ? ` · ${d.failed}명 실패` : ""}`);
      (d.errors || []).forEach((msg: string) => toast.error(msg));
      setSelectedIds(new Set());
      fetchEmployees();
    } finally {
      setBulkDeleting(false);
    }
  };
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [bulkUploadData, setBulkUploadData] = useState<any[]>([]);
  const [bulkUploadLoading, setBulkUploadLoading] = useState(false);

  // 폼 상태
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "EMPLOYEE",
    jobGroup: "",
    position: "",
    branch: "",
    phone: "",
    hireDate: "",
    birthDate: "",
    empNo: "",
  });

  // 지점 목록 상태
  const [branches, setBranches] = useState<Array<{ id: string; name: string; countInStats?: boolean }>>([]);

  // 메인(최고) 관리자 여부 — 관리자(ADMIN) 계정 생성 옵션 노출 제어
  const [isSuper, setIsSuper] = useState(false);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.user) setIsSuper(!!d.user.isSuperAdmin); })
      .catch(() => {});
  }, []);

  // 지점 목록 불러오기
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const res = await fetch("/api/branches");
        if (res.ok) {
          const data = await res.json();
          setBranches(data.branches || []);
        }
      } catch (error) {
        console.error("지점 목록 불러오기 실패:", error);
      }
    };
    fetchBranches();
  }, []);

  // 직원 데이터 불러오기
  const fetchEmployees = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
      } else {
        toast.error("직원 목록을 불러올 수 없습니다");
      }
    } catch (error) {
      toast.error("직원 목록을 불러오는 중 오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // 필터링된 직원 목록
  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      const matchSearch = emp.name.includes(searchText) || emp.email.includes(searchText);
      const matchRole = filterRole === "ALL" || emp.role === filterRole;
      const matchBranch = filterBranch === "ALL" || emp.branch === filterBranch;
      return matchSearch && matchRole && matchBranch;
    });
  }, [employees, searchText, filterRole, filterBranch]);

  // 통계 — "통계 포함" 꺼진 지점(테스트지점·본부 등) 소속은 카운트에서 제외 (지점 관리에서 토글)
  const stats = useMemo(() => {
    const excluded = new Set(branches.filter(b => b.countInStats === false).map(b => b.name));
    const counted = employees.filter(emp => !emp.branch || !excluded.has(emp.branch));
    const total = counted.length;
    const active = counted.filter(emp => emp.role !== "ADMIN").length;
    const managers = counted.filter(emp => emp.role === "MANAGER").length;
    const uniqueBranches = branches.filter(b => b.countInStats !== false).length;

    return { total, active, managers, uniqueBranches };
  }, [employees, branches]);

  // 사원번호 5자리 표시 (저장은 숫자, 표시는 앞자리 0 패딩 — 예: 1013 → 01013)
  const fmtEmpNo = (n: number | null | undefined) => (n == null ? "-" : String(n).padStart(5, "0"));

  // 직원 추가
  const handleCreate = async () => {
    if (!formData.name || !formData.email || !formData.password) {
      toast.error("필수 항목을 입력하세요");
      return;
    }

    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        toast.success("직원이 추가되었습니다");
        setCreateOpen(false);
        resetForm();
        fetchEmployees();
      } else {
        const data = await res.json();
        toast.error(data.error || "직원 추가에 실패했습니다");
      }
    } catch (error) {
      toast.error("직원 추가 중 오류가 발생했습니다");
    }
  };

  // 직원 수정
  const handleUpdate = async () => {
    if (!editEmployee) return;

    try {
      const res = await fetch(`/api/employees/${editEmployee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editEmployee.name,
          email: editEmployee.email,
          empNo: editEmployee.empNo, // 사원번호 변경 (타 시스템 사번 맞추기)
          role: editEmployee.role,
          jobGroup: editEmployee.jobGroup,
          position: editEmployee.position,
          branch: editEmployee.branch,
          phone: editEmployee.phone,
          hireDate: editEmployee.hireDate,
          birthDate: editEmployee.birthDate,
          resignDate: editEmployee.resignDate,
          resignReason: editEmployee.resignReason,
          // 겸직 지점: 원장만 유지, 역할이 바뀌면 비움
          managerBranches: editEmployee.role === "MANAGER" ? (editEmployee.managerBranches || []) : [],
        }),
      });

      if (res.ok) {
        toast.success("직원 정보가 수정되었습니다");
        setEditOpen(false);
        setEditEmployee(null);
        fetchEmployees();
      } else {
        const data = await res.json();
        toast.error(data.error || "수정에 실패했습니다");
      }
    } catch (error) {
      toast.error("수정 중 오류가 발생했습니다");
    }
  };

  // 직원 삭제
  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/employees/${id}/delete`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("직원이 삭제되었습니다");
        setDeleteConfirmId(null);
        fetchEmployees();
      } else {
        const data = await res.json();
        toast.error(data.error || "삭제에 실패했습니다");
      }
    } catch (error) {
      toast.error("삭제 중 오류가 발생했습니다");
    }
  };

  // 엑셀 파일 처리
  const handleBulkUploadFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet);

        // 데이터 검증 — 엑셀 셀이 숫자로 읽히는 경우(비밀번호 12345678, 연락처 등) 문자열로 변환
        const cell = (v: any) => (v === undefined || v === null ? undefined : String(v).trim());
        const validData = json.filter((row: any) => {
          return row.이름 || row.이메일 || row.비밀번호;
        }).map((row: any) => ({
          name: cell(row.이름),
          email: cell(row.이메일),
          password: cell(row.비밀번호),
          role: cell(row.역할) || "EMPLOYEE",
          branch: cell(row.지점),
          jobGroup: cell(row.직책),
          position: cell(row.직급),
          phone: cell(row.연락처),
          hireDate: row.입사일, // 날짜 시리얼(숫자)일 수 있어 서버에서 처리
          birthDate: row.생년월일, // 봇 생일 축하용 (서버에서 파싱)
          empNo: cell(row.사원번호), // 지정 시 그 번호, 비우면 자동 발급
        }));

        if (validData.length === 0) {
          toast.error("유효한 직원 데이터가 없습니다");
          return;
        }

        setBulkUploadData(validData);
        toast.success(`${validData.length}명의 직원 데이터를 읽었습니다`);
      } catch (error) {
        console.error("파일 처리 오류:", error);
        toast.error("엑셀 파일을 읽을 수 없습니다");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // 템플릿 다운로드
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        사원번호: 2001,
        이름: "홍길동",
        이메일: "hong@test.com",
        비밀번호: "password123",
        역할: "EMPLOYEE",
        지점: "분당수내",
        직책: "TM",
        직급: "교실장",
        연락처: "010-1234-5678",
        입사일: "2024-01-01",
        생년월일: "1990-05-15",
      },
      {
        사원번호: "",
        이름: "김영희",
        이메일: "kim@test.com",
        비밀번호: "password123",
        역할: "MANAGER",
        지점: "목동",
        직책: "CM",
        직급: "매니저",
        연락처: "010-9876-5432",
        입사일: "2024-02-01",
        생년월일: "",
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    worksheet["A1"].alignment = { horizontal: "center" };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "직원");
    XLSX.writeFile(workbook, "직원_업로드_템플릿.xlsx");
    toast.success("템플릿 파일이 다운로드되었습니다");
  };

  // 대량 업로드 전송 — updateExisting이면 기존 직원(이메일 기준)은 적힌 컬럼만 갱신
  const [updateExisting, setUpdateExisting] = useState(false);
  const handleBulkUploadSubmit = async () => {
    if (bulkUploadData.length === 0) {
      toast.error("업로드할 직원 데이터가 없습니다");
      return;
    }

    setBulkUploadLoading(true);
    try {
      const res = await fetch("/api/employees/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employees: bulkUploadData, updateExisting }),
      });

      const result = await res.json();

      if (res.ok) {
        toast.success(`신규 ${result.created}명${result.updated ? ` · 정보 수정 ${result.updated}명` : ""} 처리되었습니다`);
        if (result.errors.length > 0) {
          toast.error(`${result.failed}명 실패: ${result.errors[0]}`);
        }
        setBulkUploadOpen(false);
        setBulkUploadData([]);
        fetchEmployees();
      } else {
        toast.error(result.error || "업로드에 실패했습니다");
      }
    } catch (error) {
      toast.error("업로드 중 오류가 발생했습니다");
    } finally {
      setBulkUploadLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      email: "",
      password: "",
      role: "EMPLOYEE",
      jobGroup: "",
      position: "",
      branch: "",
      phone: "",
      hireDate: "",
      birthDate: "",
      empNo: "",
    });
  };

  return (
    <div className="space-y-6">
      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Users size={16} /> 전체 직원
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-gray-600 mt-1">명</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <UserCheck size={16} /> 활동 중
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.active}</div>
            <p className="text-xs text-gray-600 mt-1">직원</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <UserX size={16} /> 원장
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.managers}</div>
            <p className="text-xs text-gray-600 mt-1">명</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Building2 size={16} /> 지점
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.uniqueBranches}</div>
            <p className="text-xs text-gray-600 mt-1">개</p>
          </CardContent>
        </Card>
      </div>

      {/* 검색 및 필터 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>직원 관리</CardTitle>
            <div className="flex gap-2">
              {selectedIds.size > 0 && (
                <Button variant="outline" onClick={handleBulkDelete} disabled={bulkDeleting}
                  className="gap-2 text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700">
                  <Trash2 size={16} /> {bulkDeleting ? "삭제 중…" : `선택 삭제 (${selectedIds.size}명)`}
                </Button>
              )}
              <a href="/api/employees/export" className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                <Download size={16} /> 엑셀 다운로드
              </a>
              <Dialog open={bulkUploadOpen} onOpenChange={setBulkUploadOpen}>
                <DialogTrigger className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                  <Upload size={16} /> 엑셀 업로드
                </DialogTrigger>
                {/* overflow-hidden + min-w-0: 그리드 자식이 내용 폭만큼 창 밖으로 삐져나가는 것 방지 (표는 내부 스크롤) */}
                <DialogContent className="max-w-4xl overflow-hidden">
                  <DialogHeader>
                    <DialogTitle>엑셀로 직원 일괄 업로드</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 min-w-0">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-sm font-medium text-blue-900 mb-2">📋 필수 컬럼 (반드시 포함):</p>
                      <p className="text-sm text-blue-800">이름, 이메일, 비밀번호, 역할, 지점</p>
                      <p className="text-sm font-medium text-blue-900 mt-3 mb-2">📝 선택 컬럼 (선택사항):</p>
                      <p className="text-sm text-blue-800">사원번호(비우면 자동 발급), 직책, 직급, 연락처, 입사일, 생년월일</p>
                    </div>

                    {/* 기존 직원 일괄 수정 모드 */}
                    <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
                      <span className="text-sm text-amber-900">
                        <b>기존 직원 정보 업데이트 모드</b> — 이메일이 이미 등록된 직원이면 오류 대신, 파일에 <b>적혀 있는 컬럼만</b> 새 값으로 수정합니다
                        (빈 칸은 기존 값 유지). 사번·생년월일 일괄 반영에 사용하세요. 비밀번호는 이 모드에서 변경되지 않습니다.
                      </span>
                    </label>

                    <div>
                      <Label htmlFor="bulk-upload">엑셀 파일 선택</Label>
                      <div className="flex items-center gap-2 mt-2">
                        <Input
                          id="bulk-upload"
                          type="file"
                          accept=".xlsx,.xls"
                          onChange={handleBulkUploadFile}
                          className="cursor-pointer"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleDownloadTemplate}
                          className="whitespace-nowrap"
                        >
                          📥 템플릿 다운로드
                        </Button>
                      </div>
                    </div>

                    {bulkUploadData.length > 0 && (
                      <div>
                        <Label>미리보기 ({bulkUploadData.length}명)</Label>
                        {/* 셀 줄바꿈 금지 + 가로 스크롤 — 좁은 모달에서 표가 세로로 찌그러지는 것 방지 */}
                        <div className="border rounded-lg overflow-auto max-h-64 mt-2">
                          <table className="w-full text-sm min-w-[600px]">
                            <thead className="bg-gray-100 sticky top-0">
                              <tr>
                                <th className="px-4 py-2 text-left whitespace-nowrap">이름</th>
                                <th className="px-4 py-2 text-left whitespace-nowrap">이메일</th>
                                <th className="px-4 py-2 text-left whitespace-nowrap">역할</th>
                                <th className="px-4 py-2 text-left whitespace-nowrap">지점</th>
                                <th className="px-4 py-2 text-left whitespace-nowrap">직책</th>
                                <th className="px-4 py-2 text-left whitespace-nowrap">직급</th>
                              </tr>
                            </thead>
                            <tbody>
                              {bulkUploadData.map((row, idx) => (
                                <tr key={idx} className="border-t hover:bg-gray-50">
                                  <td className="px-4 py-2 whitespace-nowrap">{row.name || "-"}</td>
                                  <td className="px-4 py-2 whitespace-nowrap">{row.email || "-"}</td>
                                  <td className="px-4 py-2 whitespace-nowrap">{row.role || "-"}</td>
                                  <td className="px-4 py-2 whitespace-nowrap">{row.branch || "-"}</td>
                                  <td className="px-4 py-2 whitespace-nowrap">{row.jobGroup || "-"}</td>
                                  <td className="px-4 py-2 whitespace-nowrap">{row.position || "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" onClick={() => {
                        setBulkUploadOpen(false);
                        setBulkUploadData([]);
                      }}>
                        취소
                      </Button>
                      <Button
                        onClick={handleBulkUploadSubmit}
                        disabled={bulkUploadData.length === 0 || bulkUploadLoading}
                      >
                        {bulkUploadLoading ? "업로드 중..." : `${bulkUploadData.length}명 업로드`}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  <Plus size={16} /> 직원 추가
                </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>새 직원 추가</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>이름</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="이름"
                    />
                  </div>
                  <div>
                    <Label>이메일</Label>
                    <Input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="이메일"
                    />
                  </div>
                  <div>
                    <Label>비밀번호</Label>
                    <Input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="비밀번호"
                    />
                  </div>
                  <div>
                    <Label>역할</Label>
                    <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EMPLOYEE">직원</SelectItem>
                        <SelectItem value="MANAGER">원장</SelectItem>
                        {isSuper && <SelectItem value="ADMIN">관리자(서브)</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>지점</Label>
                    <Select value={formData.branch} onValueChange={(value) => setFormData({ ...formData, branch: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="지점 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map(branch => (
                          <SelectItem key={branch.id} value={branch.name}>
                            {branch.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>직책</Label>
                    {/* 본부 선택 시 본부 체계(본부/대표이사/본부장/팀장)로 전환 */}
                    <Select value={formData.jobGroup} onValueChange={(value) => setFormData({ ...formData, jobGroup: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="직책 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {jobGroupOptions(formData.branch).map((o) => (
                          <SelectItem key={o} value={o}>{o}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>직급</Label>
                    <Select value={formData.position} onValueChange={(value) => setFormData({ ...formData, position: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="직급 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {positionOptions(formData.branch).map((o) => (
                          <SelectItem key={o} value={o}>{o}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>전화번호</Label>
                    <Input
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="전화번호"
                    />
                  </div>
                  <div>
                    <Label>입사일</Label>
                    <Input
                      type="date"
                      value={formData.hireDate}
                      onChange={(e) => setFormData({ ...formData, hireDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>생년월일 (봇 생일 축하용)</Label>
                    <Input
                      type="date"
                      value={formData.birthDate}
                      onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>사원번호</Label>
                    <Input
                      type="number"
                      value={formData.empNo}
                      onChange={(e) => setFormData({ ...formData, empNo: e.target.value })}
                      placeholder="비우면 자동 발급"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end mt-4">
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>
                    취소
                  </Button>
                  <Button onClick={handleCreate}>추가</Button>
                </div>
              </DialogContent>
            </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 text-gray-400" size={16} />
              <Input
                placeholder="이름 또는 이메일 검색"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterRole} onValueChange={setFilterRole}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">모든 역할</SelectItem>
                <SelectItem value="EMPLOYEE">직원</SelectItem>
                <SelectItem value="MANAGER">원장</SelectItem>
              </SelectContent>
            </Select>
            {branches.length > 0 && (
              <Select value={filterBranch} onValueChange={setFilterBranch}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">모든 지점</SelectItem>
                  {branches.map(branch => (
                    <SelectItem key={branch.id} value={branch.name}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 직원 목록 테이블 */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500">
              직원 목록을 불러오는 중...
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              직원이 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-center w-10">
                      {/* 전체 선택 (현재 필터된 목록 기준) */}
                      <input type="checkbox" className="w-4 h-4 cursor-pointer"
                        checked={filteredEmployees.length > 0 && filteredEmployees.every(e => selectedIds.has(e.id))}
                        onChange={(e) => {
                          setSelectedIds(e.target.checked ? new Set(filteredEmployees.map(x => x.id)) : new Set());
                        }} />
                    </th>
                    <th className="px-6 py-3 text-left font-medium text-gray-700">사원번호</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-700">이름</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-700">이메일</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-700">역할</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-700">직책</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-700">직급</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-700">지점</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-700">입사일</th>
                    <th className="px-6 py-3 text-center font-medium text-gray-700">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map(emp => (
                    <tr key={emp.id} className={`border-b hover:bg-gray-50 ${selectedIds.has(emp.id) ? "bg-red-50/50" : ""}`}>
                      <td className="px-3 py-4 text-center">
                        <input type="checkbox" className="w-4 h-4 cursor-pointer"
                          checked={selectedIds.has(emp.id)}
                          onChange={(e) => {
                            setSelectedIds(prev => {
                              const n = new Set(prev);
                              if (e.target.checked) n.add(emp.id); else n.delete(emp.id);
                              return n;
                            });
                          }} />
                      </td>
                      <td className="px-6 py-4 font-mono text-gray-500">{fmtEmpNo(emp.empNo)}</td>
                      <td className="px-6 py-4 font-medium">{emp.name}</td>
                      <td className="px-6 py-4 text-gray-600">{emp.email}</td>
                      <td className="px-6 py-4">
                        <Badge variant="secondary" className={roleColor[emp.role] || ""}>
                          {roleLabel[emp.role] || emp.role}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-gray-600">{emp.jobGroup || "-"}</td>
                      <td className="px-6 py-4 text-gray-600">{emp.position || "-"}</td>
                      <td className="px-6 py-4 text-gray-600">{emp.branch || "-"}</td>
                      <td className="px-6 py-4 text-gray-600">
                        {emp.hireDate ? format(new Date(emp.hireDate), "yyyy-MM-dd") : "-"}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex gap-2 justify-center">
                          <Dialog open={editOpen && editEmployee?.id === emp.id} onOpenChange={setEditOpen}>
                            <DialogTrigger className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                              onClick={() => {
                                setEditEmployee(emp);
                                setEditOpen(true);
                              }}
                            >
                              <PenLine size={16} />
                            </DialogTrigger>
                            {editEmployee?.id === emp.id && (
                              // 화면이 낮으면 저장 버튼이 창 밖으로 밀려 안 보였다 → 내부 스크롤
                              <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                                <DialogHeader>
                                  <DialogTitle>직원 정보 수정</DialogTitle>
                                </DialogHeader>
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <Label>이름</Label>
                                    <Input
                                      value={editEmployee.name}
                                      onChange={(e) =>
                                        setEditEmployee({ ...editEmployee, name: e.target.value })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label>이메일</Label>
                                    <Input value={editEmployee.email} disabled />
                                  </div>
                                  <div>
                                    <Label>사원번호</Label>
                                    <Input
                                      type="number"
                                      value={editEmployee.empNo ?? ""}
                                      onChange={(e) =>
                                        setEditEmployee({ ...editEmployee, empNo: e.target.value ? parseInt(e.target.value) : null })
                                      }
                                      placeholder="예: 2001"
                                    />
                                  </div>
                                  <div className="flex items-end">
                                    <p className="text-xs text-gray-400 pb-2">기존 시스템 사번으로 변경 가능 (중복 불가)</p>
                                  </div>
                                  <div>
                                    <Label>역할</Label>
                                    <Select
                                      value={editEmployee.role}
                                      onValueChange={(value) =>
                                        setEditEmployee({ ...editEmployee, role: value })
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="EMPLOYEE">직원</SelectItem>
                                        <SelectItem value="MANAGER">원장</SelectItem>
                                        {isSuper && <SelectItem value="ADMIN">관리자(서브)</SelectItem>}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div>
                                    <Label>지점</Label>
                                    <Select
                                      value={editEmployee.branch || ""}
                                      onValueChange={(value) =>
                                        setEditEmployee({ ...editEmployee, branch: value })
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="지점 선택" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {branches.map(branch => (
                                          <SelectItem key={branch.id} value={branch.name}>
                                            {branch.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  {/* 원장 겸직 지점 — 대표 지점 외 추가 담당 (여러 개 선택) */}
                                  {editEmployee.role === "MANAGER" && (
                                    <div className="col-span-2">
                                      <Label>겸직 지점 (대표 지점 외 추가 담당)</Label>
                                      <div className="flex flex-wrap gap-1.5 mt-2">
                                        {branches.filter(b => b.name !== editEmployee.branch).map(b => {
                                          const checked = (editEmployee.managerBranches || []).includes(b.name);
                                          return (
                                            <label key={b.id}
                                              className={`text-xs rounded-full px-3 py-1.5 border cursor-pointer select-none ${checked ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                                              <input type="checkbox" className="hidden" checked={checked}
                                                onChange={(e) => {
                                                  const cur = new Set(editEmployee.managerBranches || []);
                                                  if (e.target.checked) cur.add(b.name); else cur.delete(b.name);
                                                  setEditEmployee({ ...editEmployee, managerBranches: [...cur] });
                                                }} />
                                              {b.name}
                                            </label>
                                          );
                                        })}
                                      </div>
                                      <p className="text-xs text-gray-400 mt-1.5">선택한 지점의 직원·휴가·출퇴근·결재가 이 원장에게도 보입니다.</p>
                                    </div>
                                  )}
                                  <div>
                                    <Label>직책</Label>
                                    <Select
                                      value={editEmployee.jobGroup || ""}
                                      onValueChange={(value) =>
                                        setEditEmployee({ ...editEmployee, jobGroup: value })
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="직책 선택" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {/* 본부 선택 시 본부 체계로 전환 */}
                                        {jobGroupOptions(editEmployee.branch).map((o) => (
                                          <SelectItem key={o} value={o}>{o}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div>
                                    <Label>직급</Label>
                                    <Select
                                      value={editEmployee.position || ""}
                                      onValueChange={(value) =>
                                        setEditEmployee({ ...editEmployee, position: value })
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="직급 선택" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {positionOptions(editEmployee.branch).map((o) => (
                                          <SelectItem key={o} value={o}>{o}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div>
                                    <Label>전화번호</Label>
                                    <Input
                                      value={editEmployee.phone || ""}
                                      onChange={(e) =>
                                        setEditEmployee({ ...editEmployee, phone: e.target.value })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label>입사일</Label>
                                    <Input
                                      type="date"
                                      value={editEmployee.hireDate ? editEmployee.hireDate.split("T")[0] : ""}
                                      onChange={(e) =>
                                        setEditEmployee({
                                          ...editEmployee,
                                          hireDate: e.target.value,
                                        })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label>생일 (봇 생일 축하용)</Label>
                                    <Input
                                      type="date"
                                      value={editEmployee.birthDate ? editEmployee.birthDate.split("T")[0] : ""}
                                      onChange={(e) =>
                                        setEditEmployee({
                                          ...editEmployee,
                                          birthDate: e.target.value || null,
                                        })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label>퇴사일</Label>
                                    <Input
                                      type="date"
                                      value={editEmployee.resignDate ? editEmployee.resignDate.split("T")[0] : ""}
                                      onChange={(e) =>
                                        setEditEmployee({ ...editEmployee, resignDate: e.target.value || null })
                                      }
                                    />
                                    <p className="text-[11px] text-gray-500 mt-1">
                                      {(() => {
                                        if (!editEmployee.resignDate) return "비워두면 재직 상태입니다.";
                                        const d = editEmployee.resignDate.split("T")[0];
                                        const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
                                        return d < today
                                          ? "지난 날짜 — 직원 목록에서 빠지고 퇴직자 현황에 표시됩니다."
                                          : "퇴사일까지 목록에 계속 표시되고, 이후 자동으로 퇴직자로 넘어갑니다.";
                                      })()}
                                    </p>
                                  </div>
                                  <div>
                                    <Label>퇴사 사유 (선택)</Label>
                                    <Input
                                      value={editEmployee.resignReason ?? ""}
                                      onChange={(e) =>
                                        setEditEmployee({ ...editEmployee, resignReason: e.target.value || null })
                                      }
                                      placeholder="예: 개인 사정"
                                      disabled={!editEmployee.resignDate}
                                    />
                                  </div>
                                </div>
                                {/* 등록 기기 (출퇴근 기기 잠금) */}
                                <div className="mt-4 p-3 bg-gray-50 rounded-lg flex items-center justify-between gap-2">
                                  <div className="text-sm">
                                    <div className="font-medium text-gray-700">등록 기기</div>
                                    <div className="text-gray-500 text-xs mt-0.5">
                                      {editEmployee.device
                                        ? `${editEmployee.device.deviceName || editEmployee.device.platform || "기기"} · ${new Date(editEmployee.device.createdAt).toLocaleDateString("ko-KR")} 등록`
                                        : "등록된 기기 없음 (첫 앱 로그인 시 자동 등록)"}
                                    </div>
                                  </div>
                                  {editEmployee.device && (
                                    <Button variant="outline" size="sm" className="text-red-500 border-red-200 hover:bg-red-50 shrink-0"
                                      onClick={async () => {
                                        const res = await fetch(`/api/employees/${editEmployee.id}/device`, { method: "DELETE" });
                                        if (res.ok) {
                                          toast.success("기기를 초기화했습니다. 직원이 새 기기에서 로그인하면 재등록됩니다.");
                                          setEditEmployee({ ...editEmployee, device: null });
                                          fetchEmployees();
                                        } else {
                                          toast.error("기기 초기화에 실패했습니다.");
                                        }
                                      }}>
                                      기기 초기화
                                    </Button>
                                  )}
                                </div>
                                {/* 비밀번호 초기화 (직원이 비번을 잊었을 때 — 임시 비번 12345678) */}
                                <div className="mt-2 p-3 bg-gray-50 rounded-lg flex items-center justify-between gap-2">
                                  <div className="text-sm">
                                    <div className="font-medium text-gray-700">비밀번호</div>
                                    <div className="text-gray-500 text-xs mt-0.5">
                                      초기화하면 임시 비번 <b>12345678</b>로 바뀝니다. 24시간 내 미변경 시 봇이 변경을 요청합니다.
                                    </div>
                                  </div>
                                  <Button variant="outline" size="sm" className="text-amber-600 border-amber-300 hover:bg-amber-50 shrink-0"
                                    onClick={async () => {
                                      if (!window.confirm(`${editEmployee.name}님의 비밀번호를 임시 비번(12345678)으로 초기화합니다.\n직원에게 12345678로 로그인 후 비밀번호를 변경하도록 안내해주세요.\n진행할까요?`)) return;
                                      const res = await fetch(`/api/employees/${editEmployee.id}/reset-password`, { method: "PATCH" });
                                      const d = await res.json().catch(() => ({}));
                                      if (res.ok) toast.success(d.message || "비밀번호를 12345678로 초기화했습니다.");
                                      else toast.error(d.error || "초기화에 실패했습니다.");
                                    }}>
                                    비밀번호 초기화
                                  </Button>
                                </div>
                                <div className="flex gap-2 justify-end mt-4">
                                  <Button variant="outline" onClick={() => setEditOpen(false)}>
                                    취소
                                  </Button>
                                  <Button onClick={handleUpdate}>저장</Button>
                                </div>
                              </DialogContent>
                            )}
                          </Dialog>

                          <Dialog open={deleteConfirmId === emp.id} onOpenChange={(open) => {
                            if (!open) setDeleteConfirmId(null);
                          }}>
                            <DialogTrigger className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                              onClick={() => setDeleteConfirmId(emp.id)}
                            >
                              <Trash2 size={16} />
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>직원 삭제</DialogTitle>
                              </DialogHeader>
                              <p className="text-gray-600">
                                {emp.name}님을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
                              </p>
                              <div className="flex gap-2 justify-end">
                                <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
                                  취소
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={() => handleDelete(emp.id)}
                                >
                                  삭제
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 결과 요약 */}
      <div className="text-sm text-gray-500">
        총 {filteredEmployees.length}명 중 {filteredEmployees.length}명 표시
      </div>
    </div>
  );
}
