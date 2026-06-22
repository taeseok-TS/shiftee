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
  phone: string | null;
  leaveBalance?: {
    remaining: number;
    used: number;
    total: number;
  };
};

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
  });

  // 지점 목록 상태
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);

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

  // 통계
  const stats = useMemo(() => {
    const total = employees.length;
    const active = employees.filter(emp => emp.role !== "ADMIN").length;
    const managers = employees.filter(emp => emp.role === "MANAGER").length;
    const uniqueBranches = new Set(employees.map(emp => emp.branch)).size;

    return { total, active, managers, uniqueBranches };
  }, [employees]);

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
          role: editEmployee.role,
          jobGroup: editEmployee.jobGroup,
          position: editEmployee.position,
          branch: editEmployee.branch,
          phone: editEmployee.phone,
          hireDate: editEmployee.hireDate,
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

        // 데이터 검증
        const validData = json.filter((row: any) => {
          return row.이름 || row.이메일 || row.비밀번호;
        }).map((row: any) => ({
          name: row.이름,
          email: row.이메일,
          password: row.비밀번호,
          role: row.역할 || "EMPLOYEE",
          branch: row.지점,
          jobGroup: row.직책,
          position: row.직급,
          phone: row.연락처,
          hireDate: row.입사일,
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
        이름: "홍길동",
        이메일: "hong@test.com",
        비밀번호: "password123",
        역할: "EMPLOYEE",
        지점: "A지점",
        직책: "TM",
        직급: "교실장",
        연락처: "010-1234-5678",
        입사일: "2024-01-01",
      },
      {
        이름: "김영희",
        이메일: "kim@test.com",
        비밀번호: "password123",
        역할: "MANAGER",
        지점: "B지점",
        직책: "CM",
        직급: "매니저",
        연락처: "010-9876-5432",
        입사일: "2024-02-01",
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    worksheet["A1"].alignment = { horizontal: "center" };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "직원");
    XLSX.writeFile(workbook, "직원_업로드_템플릿.xlsx");
    toast.success("템플릿 파일이 다운로드되었습니다");
  };

  // 대량 업로드 전송
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
        body: JSON.stringify({ employees: bulkUploadData }),
      });

      const result = await res.json();

      if (res.ok) {
        toast.success(`${result.created}명의 직원이 추가되었습니다`);
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
              <a href="/api/employees/export" className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                <Download size={16} /> 엑셀 다운로드
              </a>
              <Dialog open={bulkUploadOpen} onOpenChange={setBulkUploadOpen}>
                <DialogTrigger className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                  <Upload size={16} /> 엑셀 업로드
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>엑셀로 직원 일괄 업로드</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-sm font-medium text-blue-900 mb-2">📋 필수 컬럼 (반드시 포함):</p>
                      <p className="text-sm text-blue-800">이름, 이메일, 비밀번호, 역할, 지점</p>
                      <p className="text-sm font-medium text-blue-900 mt-3 mb-2">📝 선택 컬럼 (선택사항):</p>
                      <p className="text-sm text-blue-800">직책, 직급, 연락처, 입사일</p>
                    </div>

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
                        <div className="border rounded-lg overflow-x-auto max-h-64 mt-2">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-100 sticky top-0">
                              <tr>
                                <th className="px-4 py-2 text-left">이름</th>
                                <th className="px-4 py-2 text-left">이메일</th>
                                <th className="px-4 py-2 text-left">역할</th>
                                <th className="px-4 py-2 text-left">지점</th>
                                <th className="px-4 py-2 text-left">직책</th>
                                <th className="px-4 py-2 text-left">직급</th>
                              </tr>
                            </thead>
                            <tbody>
                              {bulkUploadData.map((row, idx) => (
                                <tr key={idx} className="border-t hover:bg-gray-50">
                                  <td className="px-4 py-2">{row.name || "-"}</td>
                                  <td className="px-4 py-2">{row.email || "-"}</td>
                                  <td className="px-4 py-2">{row.role || "-"}</td>
                                  <td className="px-4 py-2">{row.branch || "-"}</td>
                                  <td className="px-4 py-2">{row.jobGroup || "-"}</td>
                                  <td className="px-4 py-2">{row.position || "-"}</td>
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
                    <Select value={formData.jobGroup} onValueChange={(value) => setFormData({ ...formData, jobGroup: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="직책 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="원장">원장</SelectItem>
                        <SelectItem value="CM">CM</SelectItem>
                        <SelectItem value="TM">TM</SelectItem>
                        <SelectItem value="코디">코디</SelectItem>
                        <SelectItem value="학습실장">학습실장</SelectItem>
                        <SelectItem value="튜터">튜터</SelectItem>
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
                        <SelectItem value="매니저">매니저</SelectItem>
                        <SelectItem value="주임매니저">주임매니저</SelectItem>
                        <SelectItem value="선임매니저">선임매니저</SelectItem>
                        <SelectItem value="부원장">부원장</SelectItem>
                        <SelectItem value="수석부원장">수석부원장</SelectItem>
                        <SelectItem value="교실장">교실장</SelectItem>
                        <SelectItem value="주임교실장">주임교실장</SelectItem>
                        <SelectItem value="선임교실장">선임교실장</SelectItem>
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
                    <tr key={emp.id} className="border-b hover:bg-gray-50">
                      <td className="px-6 py-4 font-mono text-gray-500">{emp.empNo ?? "-"}</td>
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
                              <DialogContent className="max-w-2xl">
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
                                        <SelectItem value="원장">원장</SelectItem>
                                        <SelectItem value="CM">CM</SelectItem>
                                        <SelectItem value="TM">TM</SelectItem>
                                        <SelectItem value="코디">코디</SelectItem>
                                        <SelectItem value="학습실장">학습실장</SelectItem>
                                        <SelectItem value="튜터">튜터</SelectItem>
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
                                        <SelectItem value="매니저">매니저</SelectItem>
                                        <SelectItem value="주임매니저">주임매니저</SelectItem>
                                        <SelectItem value="선임매니저">선임매니저</SelectItem>
                                        <SelectItem value="부원장">부원장</SelectItem>
                                        <SelectItem value="수석부원장">수석부원장</SelectItem>
                                        <SelectItem value="교실장">교실장</SelectItem>
                                        <SelectItem value="주임교실장">주임교실장</SelectItem>
                                        <SelectItem value="선임교실장">선임교실장</SelectItem>
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
