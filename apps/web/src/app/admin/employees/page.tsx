"use client";
import PortalSyncNote from "@/components/admin/PortalSyncNote";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, Trash2, Users, Upload, Download, List } from "lucide-react";
import EmployeeTabs, { useHireCheckCount, refreshHireCount } from "@/components/hr/EmployeeTabs";
import { Box, Tiles, Tile, FilterRow, inputClass, tableClass, Cell2, StatusPill, MoreMenu, btnClass, type PillTone } from "@/components/kit";
import { format } from "date-fns";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { useIsDirectHost } from "@/lib/direct-host";

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
  employmentStatus?: string | null; // ACTIVE | ON_LEAVE | TEMPORARY | RESIGNED — 휴직은 포털 연동·이 화면에서만 바뀐다
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
  isTest?: boolean; // 테스트 계정 — 인원 숫자에서 빠진다(lib/employee-scope testAccountWhere, 2026-10-23 ■0-9)
};

// 직책/직급 옵션 — 본부 소속은 별도 체계, 그 외 지점은 기존 학원 체계
const HQ_BRANCH = "본부";
const JOBGROUP_DEFAULT = ["원장", "CM", "TM", "코디", "학습실장", "튜터"];
const JOBGROUP_HQ = ["본부", "대표이사", "본부장", "팀장"];
const POSITION_DEFAULT = ["매니저", "주임매니저", "선임매니저", "부원장", "수석부원장", "교실장", "주임교실장", "선임교실장", "코디"]; // 코디 — #223(10/20 이예지: 신규 코디 직급 설정 불가)
const POSITION_HQ = ["사원", "주임", "대리", "과장", "차장", "부장", "팀장", "본부장", "대표이사", "본부"];
const jobGroupOptions = (branch: string | null | undefined) => (branch === HQ_BRANCH ? JOBGROUP_HQ : JOBGROUP_DEFAULT);
const positionOptions = (branch: string | null | undefined) => (branch === HQ_BRANCH ? POSITION_HQ : POSITION_DEFAULT);

const roleLabel: Record<string, string> = {
  ADMIN: "관리자",
  MANAGER: "원장",
  EMPLOYEE: "직원",
};

// 역할 알약(R14) — 직원 회색 · 원장 연인디고 · 관리자 분홍
const roleTone: Record<string, PillTone> = { ADMIN: "rej", MANAGER: "ind", EMPLOYEE: "gray" };

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const directHost = useIsDirectHost(); // 잘못된 주소가 처음 들어오는 지점 — 직영에서만 EMS 예시를 보여 준다
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [filterRole, setFilterRole] = useState<string>("ALL");
  const [filterBranch, setFilterBranch] = useState<string>("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  // 방금 초기화한 임시 비밀번호 — 이 창에서 한 번만 보여 준다(서버는 다시 알려 주지 않는다, 2026-09-30)
  const [tempPwShown, setTempPwShown] = useState<{ userId: string; password: string; emailed: boolean; email: string } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // 선택 삭제 — 잘못 업로드한 직원을 골라서 한 번에 삭제 (활동 기록 있으면 서버가 거부)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    // 퇴사를 삭제로 처리하는 사고가 있었다(2026-09-18) — 무엇을 위한 버튼인지부터 말한다
    if (!window.confirm(
      `[주의] 퇴사 처리가 아닙니다.\n` +
      `퇴사는 직원 줄 끝 ⋮ › 수정에서 [퇴사일]을 넣어 주세요 — 그래야 퇴직자 현황에 남습니다.\n\n` +
      `이 버튼은 잘못 올린 직원을 지우는 용도입니다. 선택한 ${selectedIds.size}명을 완전히 삭제하며 복구할 수 없습니다.\n` +
      `(등록한 지 7일이 지났거나, 앱에 등록된 기기가 있거나, 본인의 출퇴근·휴가 신청·메시지가 있는 직원은 삭제되지 않습니다)\n진행할까요?`
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
      fetchEmployees(); refreshHireCount(true);
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

  // 숫자 칸 「입사일 확인 필요」(R14) — 입사일 대조 「확인 필요한 직원만」과 같은 기준·같은 값(components/hr/EmployeeTabs hireNeedsCheck).
  // 포털을 읽으므로 화면을 그린 뒤 따로 받고, 못 읽으면 「—」
  const hireCheck = useHireCheckCount();

  // 필터링된 직원 목록
  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      const q = searchText.trim();
      const matchSearch = !q || emp.name.includes(q) || emp.email.toLowerCase().includes(q.toLowerCase()) || (emp.empNo != null && (String(emp.empNo).includes(q) || String(emp.empNo).padStart(5, "0").includes(q)));
      const matchRole = filterRole === "ALL" || emp.role === filterRole;
      const matchBranch = filterBranch === "ALL" || emp.branch === filterBranch;
      return matchSearch && matchRole && matchBranch;
    });
  }, [employees, searchText, filterRole, filterBranch]);

  // 인원 숫자(2026-10-23 ■0-9 · ■3) — 대시보드 · 현황과 같은 공용 기준(lib/employee-scope, /api/employees/headcount).
  // 전체 직원 = 지점 재직 + 휴직, 원장 = 지점 원장. 본부 · 퇴사자 · 테스트 계정 · 테스트지점은 세지 않는다.
  // 목록을 다시 불러올 때(추가 · 수정 · 삭제 뒤) 같이 다시 받는다
  const [headcount, setHeadcount] = useState<{ total: number; staff: number; onLeave: number; managers: number; branchCount: number } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/employees/headcount").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d) setHeadcount(d); }).catch(() => {});
    return () => { alive = false; };
  }, [employees]);

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
        fetchEmployees(); refreshHireCount(true);
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
          // 화면 표시와 같은 값으로 — 퇴직(RESIGNED)은 퇴사일로만 정해지므로 여기선 재직으로 넘긴다(퇴사일이 지났으면 서버가 다시 퇴직으로 둔다)
          employmentStatus: editEmployee.employmentStatus === "ON_LEAVE" || editEmployee.employmentStatus === "TEMPORARY" ? editEmployee.employmentStatus : "ACTIVE",
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
        fetchEmployees(); refreshHireCount(true);
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
        fetchEmployees(); refreshHireCount(true);
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
        fetchEmployees(); refreshHireCount(true);
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
    <div>
      {/* 머리 + 알약 탭(R14) — 흰 「엑셀 받기」 · 흰 「엑셀 올리기」 · 인디고 「＋ 직원 추가」(초록 「엑셀 업로드」 · 파랑 「직원 추가」 대신) */}
      <EmployeeTabs active="list">

              <a href="/api/employees/export" className={btnClass("secondary")}>
                <Download size={15} /> 엑셀 받기
              </a>
              <Dialog open={bulkUploadOpen} onOpenChange={setBulkUploadOpen}>
                <DialogTrigger className={btnClass("secondary")}>
                  <Upload size={15} /> 엑셀 올리기
                </DialogTrigger>
                {/* overflow-hidden + min-w-0: 그리드 자식이 내용 폭만큼 창 밖으로 삐져나가는 것 방지 (표는 내부 스크롤) */}
                <DialogContent className="max-w-4xl overflow-hidden">
                  <DialogHeader>
                    <DialogTitle>엑셀로 직원 일괄 업로드</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 min-w-0">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-sm font-medium text-blue-900 mb-2">필수 컬럼 (반드시 포함):</p>
                      <p className="text-sm text-blue-800">이름, 이메일, 비밀번호, 역할, 지점</p>
                      <p className="text-sm font-medium text-blue-900 mt-3 mb-2">선택 컬럼 (선택사항):</p>
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
                          템플릿 다운로드
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
                      <Button className="bg-[#4f46e5] text-white hover:bg-[#4338ca]"
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
                <DialogTrigger className={btnClass("primary")}>
                  <Plus size={15} /> 직원 추가
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
                    <Label>이메일{directHost ? " (EMS 계정 — 로그인 아이디)" : " (로그인 아이디)"}</Label>
                    <Input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder={directHost ? "EMS 이메일 (예: gildong_hong@eduplex.net)" : "이메일"}
                    />
                  </div>
                  <div>
                    <Label>비밀번호</Label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="비밀번호"
                    />
                  </div>
                  <div>
                    <Label>역할</Label>
                    <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                      <SelectTrigger>
                        <SelectValue>{formData.role === "ADMIN" ? "관리자(서브)" : roleLabel[formData.role] ?? formData.role}</SelectValue>
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
                      type="date" max="9999-12-31"
                      value={formData.hireDate}
                      onChange={(e) => setFormData({ ...formData, hireDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>생년월일 (봇 생일 축하용)</Label>
                    <Input
                      type="date" max="9999-12-31"
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
                  <Button className="bg-[#4f46e5] text-white hover:bg-[#4338ca]" onClick={handleCreate}>추가</Button>
                </div>
              </DialogContent>
            </Dialog>
      </EmployeeTabs>

      {/* 직원 현황(본부 10/22 — 「직원 한눈에」 대신) — 대시보드와 같은 숫자 칸. 「활동 중」은 전체와 같아 빼고 「입사일 확인 필요」 */}
      <Box icon={<Users />} tone="vio" title="직원 현황" sub="포털 인사카드 기준 · 본부 · 퇴사자 · 테스트 계정 · 테스트지점은 세지 않음">
        <Tiles cols={isSuper ? 4 : 3}>
          <Tile label="전체 직원" value={headcount?.total} unit="명" note={headcount ? `지점 재직 ${headcount.staff} + 휴직 ${headcount.onLeave}` : "지점 재직 + 휴직"} />
          <Tile label="원장" value={headcount?.managers} unit="명" note="지점 원장" />
          <Tile label="지점" value={headcount?.branchCount} unit="개" note="운영 중" />
          {isSuper && <Tile label="입사일 확인 필요" value={hireCheck} unit="명" note="포털 명부와 다름(확정 전) · 입사일 없음" hl onClick={() => { window.location.href = "/admin/hire-dates"; }} />}
        </Tiles>
      </Box>

      {/* 직원 목록 */}
      <Box icon={<List />} tone="sky" title="직원 목록" sub={`${filteredEmployees.length}명 · 본부 소속 · 테스트 계정 포함(직원 현황 숫자는 지점 재직 · 휴직만)`}
        right={selectedIds.size > 0 ? (
          <button type="button" onClick={handleBulkDelete} disabled={bulkDeleting} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#dc2626] hover:underline disabled:opacity-50">
            <Trash2 size={15} /> {bulkDeleting ? "삭제 중…" : `선택 삭제 (${selectedIds.size}명)`}
          </button>
        ) : undefined}>
        <FilterRow>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="이름 · 사번 · 메일로 찾기" aria-label="직원 찾기" className={`${inputClass} w-60 pl-8`} />
          </div>
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} aria-label="역할" className={inputClass}>
            <option value="ALL">역할: 전체</option>
            <option value="EMPLOYEE">직원</option>
            <option value="MANAGER">원장</option>
          </select>
          {branches.length > 0 && (
            <select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} aria-label="지점" className={inputClass}>
              <option value="ALL">지점: 전체</option>
              {/* 숨긴 지점(테스트지점 — 지점 관리 「숨긴 지점」)은 고르기에서 뺀다(2026-10-23 ■0-8). 본부는 남긴다. 수정 창의 지점 칸은 그대로 모든 지점 */}
              {branches.filter(b => b.countInStats !== false || b.name === HQ_BRANCH).map(branch => <option key={branch.id} value={branch.name}>{branch.name}</option>)}
            </select>
          )}
        </FilterRow>
          {loading ? (
            <div className="p-8 text-center text-[14px] text-[#596578]">
              직원 목록을 불러오는 중...
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              직원이 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className="!px-3 text-center w-10">
                      {/* 전체 선택 (현재 필터된 목록 기준) */}
                      <input type="checkbox" className="w-4 h-4 cursor-pointer"
                        checked={filteredEmployees.length > 0 && filteredEmployees.every(e => selectedIds.has(e.id))}
                        onChange={(e) => {
                          setSelectedIds(e.target.checked ? new Set(filteredEmployees.map(x => x.id)) : new Set());
                        }} />
                    </th>
                    <th>사번</th>
                    <th>이름</th>
                    <th>역할</th>
                    <th>직책 · 직급</th>
                    <th>지점</th>
                    <th>입사일</th>
                    <th className="w-12"><span className="sr-only">더 보기</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map(emp => (
                    <tr key={emp.id} className={selectedIds.has(emp.id) ? "bg-[#fff1f2]/60" : "hover:bg-[#fafbfd]"}>
                      <td className="!px-3 text-center">
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
                      <td className="font-mono text-[13px] text-[#596578]">{fmtEmpNo(emp.empNo)}</td>
                      <td><Cell2 main={<>{emp.name}{emp.isTest && <span className="ml-1.5 align-middle"><StatusPill tone="gray">테스트 계정</StatusPill></span>}</>} sub={emp.email} /></td>
                      <td><StatusPill tone={roleTone[emp.role] ?? "gray"}>{roleLabel[emp.role] || emp.role}</StatusPill></td>
                      <td className="text-[#475569]">{[emp.jobGroup, emp.position].filter(Boolean).join(" · ") || "-"}</td>
                      <td className="text-[#475569]">{emp.branch || "-"}</td>
                      <td className="whitespace-nowrap tabular-nums text-[#475569]">
                        {emp.hireDate ? format(new Date(emp.hireDate), "yyyy-MM-dd") : "-"}
                      </td>
                      <td className="text-right">
                        {/* 연필 · 빨간 휴지통 → ⋮(R14) — 수정 · 삭제(맨 아래 빨간 글씨, 한 번 더 확인 창) */}
                        <MoreMenu items={[
                          { label: "수정", onClick: () => { setEditEmployee(emp); setEditOpen(true); setTempPwShown(null); } },
                          { label: "삭제", danger: true, onClick: () => setDeleteConfirmId(emp.id) },
                        ]} />
                        <div className="contents">
                          <Dialog open={editOpen && editEmployee?.id === emp.id} onOpenChange={setEditOpen}>
                            {/* 창을 다시 열면 지난번 임시 비밀번호는 보이지 않는다(⋮ 「수정」이 setTempPwShown(null)) */}
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
                                        <SelectValue>{editEmployee.role === "ADMIN" ? "관리자(서브)" : roleLabel[editEmployee.role] ?? editEmployee.role}</SelectValue>
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
                                  <PortalSyncNote />
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
                                      type="date" max="9999-12-31"
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
                                      type="date" max="9999-12-31"
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
                                    <Label>재직상태</Label>
                                    <Select
                                      value={editEmployee.employmentStatus === "ON_LEAVE" || editEmployee.employmentStatus === "TEMPORARY" ? editEmployee.employmentStatus : "ACTIVE"}
                                      onValueChange={(value) => setEditEmployee({ ...editEmployee, employmentStatus: value })}
                                    >
                                      <SelectTrigger><SelectValue>{editEmployee.employmentStatus === "ON_LEAVE" ? "휴직" : editEmployee.employmentStatus === "TEMPORARY" ? "임시휴무" : "재직"}</SelectValue></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="ACTIVE">재직</SelectItem>
                                        <SelectItem value="ON_LEAVE">휴직</SelectItem>
                                        <SelectItem value="TEMPORARY">임시휴무</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <p className="text-[11px] text-gray-500 mt-1">휴직·임시휴무는 「전체 직원」 숫자에는 들어가고, 지점 직원 · 근무일정에서는 빠집니다. 퇴직은 아래 퇴사일로 처리합니다.</p>
                                  </div>
                                  <div>
                                    <Label>퇴사일</Label>
                                    <Input
                                      type="date" max="9999-12-31"
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
                                {/* 비밀번호 초기화 (직원이 비번을 잊었을 때) — 무작위 임시 비밀번호를 등록 이메일로 보내고 여기에도 한 번 보여 준다 */}
                                <div className="mt-2 p-3 bg-gray-50 rounded-lg space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-sm min-w-0">
                                      <div className="font-medium text-gray-700">비밀번호</div>
                                      <div className="text-gray-500 text-xs mt-0.5">
                                        초기화하면 무작위 임시 비밀번호로 바뀌고 등록 이메일로 보내집니다. 24시간 내 미변경 시 봇이 변경을 요청합니다.
                                        <br />본인이 직접 재설정할 수 있으면 로그인 화면 「비밀번호를 잊으셨나요?」를 먼저 안내해주세요.
                                      </div>
                                    </div>
                                    <Button variant="outline" size="sm" className="text-amber-600 border-amber-300 hover:bg-amber-50 shrink-0"
                                      onClick={async () => {
                                        if (!window.confirm(`${editEmployee.name}님의 비밀번호를 초기화합니다.\n무작위 임시 비밀번호가 ${editEmployee.email} 로 발송됩니다.\n본인 요청이 맞는지 확인하셨나요? 진행할까요?`)) return;
                                        const res = await fetch(`/api/employees/${editEmployee.id}/reset-password`, { method: "PATCH" });
                                        const d = await res.json().catch(() => ({}));
                                        if (res.ok) {
                                          if (d.tempPassword) setTempPwShown({ userId: editEmployee.id, password: d.tempPassword, emailed: !!d.emailed, email: editEmployee.email });
                                          if (d.emailed) toast.success(d.message || "비밀번호를 초기화하고 메일로 보냈습니다.");
                                          else toast.warning(d.message || "초기화했지만 메일을 보내지 못했습니다. 임시 비밀번호를 직접 전달해주세요.");
                                        } else toast.error(d.error || "초기화에 실패했습니다.");
                                      }}>
                                      비밀번호 초기화
                                    </Button>
                                  </div>
                                  {tempPwShown && tempPwShown.userId === editEmployee.id && (
                                    <div className={`rounded-md border p-2.5 text-xs ${tempPwShown.emailed ? "border-indigo-200 bg-indigo-50" : "border-amber-300 bg-amber-50"}`}>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-gray-600">임시 비밀번호</span>
                                        <b className="font-mono text-base tracking-wider select-all">{tempPwShown.password}</b>
                                        <Button type="button" variant="outline" size="sm" className="h-6 text-[11px] px-2"
                                          onClick={() => { navigator.clipboard?.writeText(tempPwShown.password).then(() => toast.success("복사했습니다."), () => {}); }}>복사</Button>
                                      </div>
                                      <p className="mt-1 text-gray-600">
                                        {tempPwShown.emailed ? `${tempPwShown.email} 로 보냈습니다. ` : "메일 발송에 실패했습니다 — 직원에게 직접 전달해주세요. "}
                                        이 창을 닫으면 다시 볼 수 없습니다.
                                      </p>
                                    </div>
                                  )}
                                </div>
                                <div className="flex gap-2 justify-end mt-4">
                                  <Button variant="outline" onClick={() => setEditOpen(false)}>
                                    취소
                                  </Button>
                                  <Button className="bg-[#4f46e5] text-white hover:bg-[#4338ca]" onClick={handleUpdate}>저장</Button>
                                </div>
                              </DialogContent>
                            )}
                          </Dialog>

                          <Dialog open={deleteConfirmId === emp.id} onOpenChange={(open) => {
                            if (!open) setDeleteConfirmId(null);
                          }}>
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
      </Box>
    </div>
  );
}
