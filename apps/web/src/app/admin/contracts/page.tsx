"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileSignature, Plus, PenLine, Download, Send, CheckCircle2, Clock, ArrowRight, History, Trash2, ChevronDown, X, Eye } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Contract = {
  id: string;
  userId: string;
  templateId?: string | null;
  title: string;
  type: string;
  fileUrl: string;
  status: string;
  extraFields?: Record<string, string> | null; // 작성 시 입력값 요약 (연봉·수습 기간 등)
  signedUrl?: string | null; // 완료 시 저장되는 서명본(서명+직인) 파일
  bundleId?: string | null; // 신규입사 패키지 묶음
  employeeOnly?: boolean; // 직원 서명만·직원전용 문서
  externalName?: string | null; // 외부(미가입) 계약자 이름 — 있으면 외부 계약
  externalPhone?: string | null;
  employeeSignedAt?: string | null;
  signedAt: string | null;
  createdAt: string;
  user: { name: string; department: string | null; branch?: string | null };
  approvalLine?: {
    steps: Array<{
      id: string;
      order: number;
      approverId: string;
      approver: { name: string };
      status: string;
      decidedAt?: string | null;
    }>;
  };
};

type Employee = { id: string; name: string; department: string | null; branch?: string | null; role?: string; birthDate?: string | null; managerBranches?: string[]; hireDate?: string | null; position?: string | null; empNo?: number | null; phone?: string | null };

type ContractTemplate = {
  id: string;
  name: string;
  description?: string;
  type: string;
  fileUrl: string;
  createdByUser: { id: string; name: string };
};

type ContractVersion = {
  id: string;
  version: number;
  fileUrl: string;
  title: string;
  type: string;
  status: string;
  createdAt: string;
  createdByUser: { id: string; name: string };
};

const typeLabel: Record<string, string> = {
  EMPLOYMENT: "근로계약서",
  PART_TIME: "단시간근로계약서",
  CONFIDENTIAL: "비밀유지서약서",
  OTHER: "기타",
};

const statusConfig: Record<string, { label: string; variant: any }> = {
  DRAFT: { label: "초안", variant: "outline" },
  SENT: { label: "결재 진행 중", variant: "secondary" },
  APPROVED: { label: "결재 중", variant: "secondary" },
  SIGNED: { label: "완료", variant: "default" },
  EXPIRED: { label: "만료", variant: "destructive" },
};

// 상태 필터 트리거에 코드값 대신 표시할 라벨 (#141)
const FILTER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "초안", SENT: "직원 서명 대기", APPROVED: "결재 중", SIGNED: "완료", EXPIRED: "만료",
};

// 발송 승인자 3칸 고정 슬롯 (#158·#159) — 단계와 역할이 화면에 고정으로 보이게
type ApproverSlots = [string | null, string | null, string | null];
const SLOT_ROLES = ["본부", "원장", "근로자"] as const;

// 문서 종류 필터 그룹 (#168) — 템플릿 이름으로 4그룹 분류. "퇴직시 비밀유지"는 퇴사 쪽
const DOC_GROUPS = ["근로계약서", "신규입사 서류", "퇴사 서류", "신청 서류"] as const;
type DocGroup = (typeof DOC_GROUPS)[number];
function docGroupOf(name: string): DocGroup {
  if (name.includes("퇴직시")) return "퇴사 서류";
  if (name.includes("근로계약서") || name.includes("코디") || name.includes("기타직무")) return "근로계약서";
  if (name.includes("비밀유지") || name.includes("개인정보")) return "신규입사 서류";
  if (name.includes("사직원") || name.includes("금품청산") || name.includes("퇴직금") || name.includes("연차수당")) return "퇴사 서류";
  return "신청 서류";
}

// fileUrl이 JSON 배열일 경우 파싱, 첫 번째 파일 URL 반환
function getFileUrl(fileUrl: string): string {
  if (!fileUrl) return "";
  try {
    const urls = JSON.parse(fileUrl);
    return Array.isArray(urls) ? urls[0] : fileUrl;
  } catch {
    return fileUrl;
  }
}

function ApprovalChain({ steps, userId, onClick }: { steps?: any[]; userId?: string; onClick?: () => void }) {
  if (!steps || !Array.isArray(steps) || steps.length === 0) return null;

  const stepElements = [];

  // 실제 배치 순서대로 각 단계를 표시
  (steps || []).forEach((step, idx) => {
    // 화살표 추가 (첫 번째 단계 제외)
    if (idx > 0) {
      stepElements.push(
        <ArrowRight key={`arrow-${idx}`} size={14} className="text-gray-400" />
      );
    }

    // 각 단계 표시
    stepElements.push(
      <div key={`step-${step.order}`} className="flex items-center gap-1">
        {step.status === "APPROVED" ? (
          <CheckCircle2 size={16} className="text-green-600" />
        ) : step.status === "PENDING" ? (
          <Clock size={16} className="text-orange-600" />
        ) : (
          <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
        )}
        {/* 해당 단계가 직원이면 "직원"으로, 아니면 승인자 이름으로 표시 */}
        <span className="text-xs font-medium">
          {step.approverId === userId ? "직원" : step.approver?.name || (step as { externalName?: string }).externalName || "외부 서명자"}
        </span>
      </div>
    );
  });

  return (
    <div
      className="flex items-center gap-2 flex-wrap text-xs cursor-pointer hover:opacity-70 transition-opacity"
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      {stepElements}
    </div>
  );
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [myApprovals, setMyApprovals] = useState<Contract[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [role, setRole] = useState("EMPLOYEE");
  const [myId, setMyId] = useState("");
  const [myName, setMyName] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [useTemplate, setUseTemplate] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [bundleMode, setBundleMode] = useState(false); // 신규입사 패키지(3종 묶음) 발송
  const [resignBundleMode, setResignBundleMode] = useState(false); // 퇴사 패키지(5종 묶음) 발송
  const [codiBundleMode, setCodiBundleMode] = useState(false); // 코디 채용 패키지(계약서 선택 + 3종 묶음) 발송
  const [externalMode, setExternalMode] = useState(false); // 외부(미가입) 계약자 — 게스트 서명 링크 발송
  const [extBundleMode, setExtBundleMode] = useState(false); // 외부 채용 패키지 — 계약서 + 비밀유지 + 개인정보동의서
  const [externalForm, setExternalForm] = useState({ name: "", phone: "" });
  // 발송 직후 서명 링크 안내 다이얼로그 — 링크를 찾아 헤매지 않게 그 자리에서 복사·문자 전송
  const [extLinkOpen, setExtLinkOpen] = useState(false);
  const [extLink, setExtLink] = useState<{ url: string; name: string; phone: string | null }>({ url: "", name: "", phone: null });
  const [employeeSearchText, setEmployeeSearchText] = useState("");
  // 일괄 발송 (개선 제안 #80, 김가산·디렉터 확정 2026-08-26): 같은 조건의 신입 여러 명에게 동시 작성
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkUserIds, setBulkUserIds] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false); // 발송 전 미리보기 생성 중 (개선 제안 #76)
  const [createForm, setCreateForm] = useState({
    userId: "",
    title: "",
    type: "EMPLOYMENT",
    startDate: "",
    endDate: "",
    salary: "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const [sendOpen, setSendOpen] = useState(false);
  const [sendTarget, setSendTarget] = useState<Contract | null>(null);
  // 승인자는 3칸 고정 슬롯 — 1단계 본부 / 2단계 원장 / 3단계 근로자 (#158·#159).
  // 서버 계약은 그대로라 발송 시 null 을 뺀 배열(approverIds)로 변환해 보낸다.
  const [approverSlots, setApproverSlots] = useState<ApproverSlots>([null, null, null]);
  const [activeSlot, setActiveSlot] = useState<number | null>(null); // 슬롯을 먼저 눌러 "지금 채울 칸" 지정
  const approverIds = approverSlots.filter((x): x is string => !!x);
  const [approverSearch, setApproverSearch] = useState(""); // 승인자 검색 (발송 다이얼로그)
  const [updateApproverSearch, setUpdateApproverSearch] = useState(""); // 결재자 수정 검색

  const [signOpen, setSignOpen] = useState(false);
  const [signTarget, setSignTarget] = useState<Contract | null>(null);
  const sigRef = useRef<SignaturePadHandle>(null);
  // 저장된 결재 서명 — 있으면 원클릭 승인, 없으면 그린 서명을 저장해두고 다음부터 사용
  const [mySignatureUrl, setMySignatureUrl] = useState<string | null>(null);
  const [drawNewSig, setDrawNewSig] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(true);
  const [signZoom, setSignZoom] = useState(1); // 서명 모달 문서 확대·축소 0.75~2.0 (#160)
  // 문서 크게 보기 — 새 창 대신 그 자리에서 전체화면으로 (2026-09-02 이예지대리 재확인요청).
  // "새창으로 옮기는거 불편합니다" — 서명하다 창을 옮기면 하던 일이 끊긴다.
  const [bigDoc, setBigDoc] = useState<{ src: string; title: string } | null>(null);
  const [bigZoom, setBigZoom] = useState(1);
  // 문서를 그 자리에서 크게 연다. 주소를 받으므로 발송 미리보기.서명 문서.원본 PDF 모두 같은 창을 쓴다.
  const openBigDoc = (src: string, title: string) => { setBigZoom(1); setBigDoc({ src, title }); };
  // ⚠ 큰 화면이 떠 있을 때 ESC 를 누르면 **뒤의 서명 모달**이 닫혔다 — 다이얼로그 라이브러리가
  // document 에 keydown 을 걸어두는데 이 오버레이는 그 바깥이라 자기가 최상위인 줄 모른다.
  // 서명하다 그러면 그리던 서명과 체크 상태가 통째로 날아간다. capture 단계에서 먼저 삼킨다.
  useEffect(() => {
    if (!bigDoc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      setBigDoc(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [bigDoc]);

  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsTarget, setVersionsTarget] = useState<Contract | null>(null);
  const [versions, setVersions] = useState<ContractVersion[]>([]);

  const [approvalDetailsOpen, setApprovalDetailsOpen] = useState(false);
  const [approvalDetailsTarget, setApprovalDetailsTarget] = useState<Contract | null>(null);

  // 결재자 수정
  const [updateApproverOpen, setUpdateApproverOpen] = useState(false);
  const [updateApproverTarget, setUpdateApproverTarget] = useState<{ contractId: string; step: any } | null>(null);
  const [updateApproverSelectedId, setUpdateApproverSelectedId] = useState("");

  // 결재 회수
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ contractId: string; step: any; type?: "approval" | "employee" } | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  // 계약서 삭제
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string; bundleId?: string | null } | null>(null);

  // 계약서 수정 (DRAFT 상태)
  const [editOpen, setEditOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<any>(null);
  const [editForm, setEditForm] = useState({ title: "", type: "", startDate: "", endDate: "", salary: "" });
  const [editExtraFields, setEditExtraFields] = useState<Record<string, string>>({}); // 템플릿 동적 필드 수정값
  // "2026년 8월 1일" → "2026-08-01" (수정 폼 date input용)
  const koreanToIso = (v: string) => {
    const m = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(v);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : v;
  };
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editUploading, setEditUploading] = useState(false);

  // 템플릿 업로드
  // 템플릿 등록·수정은 전용 메뉴(/admin/contract-templates)로 일원화됨

  // 템플릿 리스트 보기
  const [showTemplatesList, setShowTemplatesList] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<ContractTemplate | null>(null);

  // 검색/필터
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());
  const [filterMonth, setFilterMonth] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [fieldDocs, setFieldDocs] = useState<Record<string, string>>({}); // 필드 → 출처 문서명 (#113)
  const [filterTemplateId, setFilterTemplateId] = useState(""); // 문서 종류 (#135)
  const [filterPkg, setFilterPkg] = useState(""); // 패키지/단건 (#135)
  const [filterBranch, setFilterBranch] = useState("");
  const [filterSearchText, setFilterSearchText] = useState("");
  const [showHiddenRevoked, setShowHiddenRevoked] = useState(false);

  const fetchContracts = useCallback(async (filters?: any) => {
    const params = new URLSearchParams();
    const useFilters = filters || {
      year: filterYear,
      month: filterMonth,
      status: filterStatus,
      userId: filterUserId,
      branch: filterBranch,
      searchText: filterSearchText,
      showHiddenRevoked: showHiddenRevoked,
      templateId: filterTemplateId,
      pkg: filterPkg,
    };

    if (useFilters.year) params.append("year", useFilters.year);
    if (useFilters.month) params.append("month", useFilters.month);
    if (useFilters.status) params.append("status", useFilters.status);
    if (useFilters.userId) params.append("userId", useFilters.userId);
    if (useFilters.branch) params.append("branch", useFilters.branch);
    if (useFilters.searchText) params.append("searchText", useFilters.searchText);
    if (useFilters.showHiddenRevoked) params.append("showHiddenRevoked", "true");
    if (useFilters.templateId) params.append("templateId", useFilters.templateId);
    if (useFilters.pkg) params.append("pkg", useFilters.pkg);

    const res = await fetch(`/api/contracts?${params.toString()}`);
    const data = await res.json();
    setContracts(data.contracts || []);

    if (role !== "EMPLOYEE") {
      const approvalRes = await fetch("/api/contracts/my-approvals");
      const approvalData = await approvalRes.json();
      setMyApprovals(approvalData.contracts || []);
    }
  }, [role, filterYear, filterMonth, filterStatus, filterUserId, filterBranch, filterSearchText, showHiddenRevoked, filterTemplateId, filterPkg]);

  const fetchTemplates = useCallback(async () => {
    if (role === "EMPLOYEE") return;
    try {
      const res = await fetch("/api/contract-templates");
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (error) {
      console.error("템플릿 로드 실패:", error);
    }
  }, [role]);

  const fetchVersions = useCallback(async (contractId: string) => {
    try {
      const res = await fetch(`/api/contracts/${contractId}/versions`);
      const data = await res.json();
      setVersions(data.versions || []);
    } catch (error) {
      console.error("버전 로드 실패:", error);
      setVersions([]);
    }
  }, []);

  // 결재자 수정 API 호출
  const handleUpdateApprover = async () => {
    if (!updateApproverTarget || !updateApproverSelectedId) {
      toast.error("승인자를 선택해주세요.");
      return;
    }

    try {
      const res = await fetch(
        `/api/contracts/${updateApproverTarget.contractId}/approval-steps/${updateApproverTarget.step.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approverId: updateApproverSelectedId }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "결재자 수정에 실패했습니다.");
        return;
      }

      toast.success(data.message || "결재자가 수정되었습니다.");
      setUpdateApproverOpen(false);
      setUpdateApproverTarget(null);
      setUpdateApproverSelectedId("");

      // 결재 히스토리 새로고침
      if (approvalDetailsTarget) {
        setApprovalDetailsTarget(data.contract);
      }
      fetchContracts();
    } catch (error) {
      console.error("결재자 수정 실패:", error);
      toast.error("결재자 수정에 실패했습니다.");
    }
  };

  // 결재 회수 API 호출
  const handleRevokeApproval = async () => {
    if (!revokeTarget || !revokeReason.trim()) {
      toast.error("회수 사유를 입력해주세요.");
      return;
    }

    try {
      const res = await fetch(
        `/api/contracts/${revokeTarget.contractId}/approval-steps/${revokeTarget.step.id}/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: revokeReason }),
        }
      );

      if (!res.ok) {
        let errorMsg = "결재 회수에 실패했습니다.";
        try {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
        } catch {
          // JSON 파싱 실패 시 상태 메시지 사용
          errorMsg = `오류: ${res.statusText}`;
        }
        toast.error(errorMsg);
        return;
      }

      const data = await res.json();
      toast.success(data.message || "결재가 회수되었습니다.");
      setRevokeConfirmOpen(false);
      setRevokeTarget(null);
      setRevokeReason("");

      // 결재 히스토리 새로고침
      if (approvalDetailsTarget) {
        setApprovalDetailsTarget(data.contract);
      }
      fetchContracts();
    } catch (error) {
      console.error("결재 회수 실패:", error);
      toast.error("결재 회수에 실패했습니다.");
    }
  };

  // 직원 서명 회수 API 호출
  const handleRevokeEmployeeSignature = async (contractId: string) => {
    if (!revokeReason.trim()) {
      toast.error("회수 사유를 입력해주세요.");
      return;
    }

    try {
      const res = await fetch(`/api/contracts/${contractId}/revoke-employee-signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: revokeReason }),
      });

      if (!res.ok) {
        let errorMsg = "직원 서명 회수에 실패했습니다.";
        try {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
        } catch {
          // JSON 파싱 실패 시 상태 메시지 사용
          errorMsg = `오류: ${res.statusText}`;
        }
        toast.error(errorMsg);
        return;
      }

      const data = await res.json();
      toast.success(data.message || "직원 서명이 회수되었습니다.");
      setRevokeConfirmOpen(false);
      setRevokeTarget(null);
      setRevokeReason("");

      // 결재 히스토리 새로고침
      if (approvalDetailsTarget) {
        setApprovalDetailsTarget(data.contract);
      }
      fetchContracts();
    } catch (error) {
      console.error("직원 서명 회수 실패:", error);
      toast.error("직원 서명 회수에 실패했습니다.");
    }
  };

  // 계약서 삭제
  const handleDeleteContract = async () => {
    if (!deleteTarget) return;

    try {
      const res = await fetch(`/api/contracts/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "계약서 삭제에 실패했습니다.");
        return;
      }

      const data = await res.json();
      toast.success(data.message || "계약서가 삭제되었습니다.");
      setDeleteConfirmOpen(false);
      setDeleteTarget(null);
      setApprovalDetailsOpen(false);
      fetchContracts();
    } catch (error) {
      console.error("계약서 삭제 실패:", error);
      toast.error("계약서 삭제에 실패했습니다.");
    }
  };

  // 계약서 수정 (DRAFT 상태)
  const handleEditContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContract) return;

    setEditUploading(true);
    try {
      // 새 파일이 선택되었으면 FormData 사용
      if (editFile) {
        const formData = new FormData();
        formData.append("title", editForm.title || editingContract.title);
        formData.append("type", editForm.type || editingContract.type);
        formData.append("startDate", editForm.startDate || "");
        formData.append("endDate", editForm.endDate || "");
        if (editForm.salary) formData.append("salary", editForm.salary);
        if (Object.keys(editExtraFields).length > 0) formData.append("extraFields", JSON.stringify(editExtraFields));
        formData.append("files", editFile);

        const res = await fetch(`/api/contracts/${editingContract.id}`, {
          method: "PATCH",
          body: formData,
        });

        if (!res.ok) {
          try {
            const data = await res.json();
            toast.error(data.error || "계약서 수정에 실패했습니다.");
          } catch {
            toast.error(`계약서 수정 실패 (${res.status})`);
          }
          setEditUploading(false);
          return;
        }

        try {
          const data = await res.json();
          toast.success("계약서가 수정되었습니다.");
          setEditOpen(false);
          setEditingContract(null);
          setEditForm({ title: "", type: "", startDate: "", endDate: "", salary: "" }); setEditExtraFields({});
          setEditFile(null);
          setEditUploading(false);
          fetchContracts();
        } catch {
          toast.error("응답 처리 중 오류가 발생했습니다.");
          setEditUploading(false);
        }
      } else {
        // 파일이 변경되지 않은 경우 JSON으로 처리
        const res = await fetch(`/api/contracts/${editingContract.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: editForm.title || editingContract.title,
            type: editForm.type || editingContract.type,
            startDate: editForm.startDate || null,
            endDate: editForm.endDate || null,
            ...(editForm.salary ? { salary: editForm.salary } : {}),
            ...(Object.keys(editExtraFields).length > 0 ? { extraFields: editExtraFields } : {}),
          }),
        });

        if (!res.ok) {
          try {
            const data = await res.json();
            toast.error(data.error || "계약서 수정에 실패했습니다.");
          } catch {
            toast.error(`계약서 수정 실패 (${res.status})`);
          }
          setEditUploading(false);
          return;
        }

        try {
          const data = await res.json();
          toast.success("계약서가 수정되었습니다.");
          setEditOpen(false);
          setEditingContract(null);
          setEditForm({ title: "", type: "", startDate: "", endDate: "", salary: "" }); setEditExtraFields({});
          setEditFile(null);
          setEditUploading(false);
          fetchContracts();
        } catch {
          toast.error("응답 처리 중 오류가 발생했습니다.");
          setEditUploading(false);
        }
      }
    } catch (error) {
      console.error("계약서 수정 실패:", error);
      toast.error("계약서 수정에 실패했습니다.");
      setEditUploading(false);
    }
  };

  // 자동 채움/기본 폼이 담당하는 필드 — 이 밖의 필드는 템플릿별 동적 입력란으로 노출
  const AUTO_FIELDS = ["직원명", "이름", "이메일", "연락처", "지점", "직책", "직급", "입사일", "사원번호", "작성일", "근로자서명", "대표서명",
    "원장서명", "본부서명", // 결재란 서명 마커 — 서명본에서 자동 삽입
    "주소", "생년월일", // 프로필 자동 채움(비면 직원이 서명 시 입력)
    "연봉한글", "기본급", "월급여합계", "연봉총액", "식대", "연봉숫자", // 연봉에서 자동 계산되는 필드
    "동의고유식별", "동의채용정보", // 개인정보 선택 동의 — 직원이 서명 시 토글(관리자 입력란 미표시)
    "지점명", "지급기타표기", "동의필수표기", // 서버가 다른 값에서 만들어내는 파생 표기 필드 (#144·#145)
    "신규입사", "재계약"]; // 계약 구분 라디오가 담당 — 입력란으로 노출하지 않는다
  const FORM_FIELDS = ["제목", "계약시작일", "계약종료일", "연봉"];
  const [templateFields, setTemplateFields] = useState<string[]>([]);
  const [employeeFillFields, setEmployeeFillFields] = useState<string[]>([]); // 직원이 서명 시 직접 입력(퇴사일자 등)
  const [extraFields, setExtraFields] = useState<Record<string, string>>({});
  const [templateConditions, setTemplateConditions] = useState<string[]>([]); // 템플릿의 {#조건} 이름들
  const [fieldConditions, setFieldConditions] = useState<Record<string, string>>({}); // 필드 → 소속 조건
  const [contractKind, setContractKind] = useState("신규입사"); // 계약 구분
  // 외부 계약: 직원 정보가 없어 개인정보류 자동 필드도 관리자가 직접 입력
  const EXTERNAL_INPUT_FIELDS = ["지점", "직책", "직급", "연락처", "이메일", "생년월일", "주소", "입사일", "사원번호"];
  // 계약 구분에 해당하지 않는 조건 구간의 필드 + 직원 직접입력 필드는 관리자 입력란에서 숨김
  const dynamicFields = templateFields
    .filter(f => (!AUTO_FIELDS.includes(f) || (externalMode && EXTERNAL_INPUT_FIELDS.includes(f))) && !FORM_FIELDS.includes(f) && f !== "계약구분")
    .filter(f => !employeeFillFields.includes(f) || externalMode) // 외부인은 서명 화면 입력이 없어 전부 관리자 입력
    .filter(f => !fieldConditions[f] || fieldConditions[f] === contractKind);
  // "근무종료시각"처럼 시각/시간으로 끝나는 필드는 날짜가 아니라 시간이다 — 시각류를 먼저 가려낸다
  // 요일별 근무시간(계약직 주근무시간 합산 보조) — 계산 보조일 뿐 문서에는 합계만 들어간다
  const [dayHours, setDayHours] = useState<string[]>(Array(7).fill(""));
  // 종료일 자동값 추적 — 사용자가 직접 고친 종료일은 보존하고, 자동값이면 시작일 변경 시 재계산
  const lastAutoEnd = useRef<string>("");

  const isTimeField = (f: string) => /시각$/.test(f);
  const isDateField = (f: string) => !isTimeField(f) && !/시간$/.test(f) && /시작|종료|날짜|일자|기간|일$/.test(f);
  // 금액류 필드 — 입력 시 천 단위 쉼표 자동 포맷 (문서에는 서버가 "1,210,000원"으로 변환)
  const isMoneyField = (f: string) => /금액|급여액|월급|수당액|비용/.test(f);

  // 오피스 문서를 브라우저에서 바로 미리보기 (MS 온라인 뷰어)
  const officeViewHref = (fileUrl: string) => {
    if (!fileUrl) return "#";
    // 워드는 자체 인앱 뷰어(즉시 렌더). 엑셀·PPT만 MS 온라인 뷰어 유지
    if (/\.docx?$/i.test(fileUrl)) return `/docs/viewer?src=${encodeURIComponent(fileUrl)}`;
    if (/\.(pptx?|xlsx?)$/i.test(fileUrl))
      return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(window.location.origin + fileUrl)}`;
    return fileUrl;
  };

  // 신규입사 패키지에 함께 발송할 문서(비밀유지·개인정보동의서) 자동 탐색
  const ndaTemplate = templates.find(t => t.name.includes("비밀유지") && !t.name.includes("퇴직"));
  const privacyTemplate = templates.find(t => t.name.includes("개인정보"));
  // 신규입사 패키지의 근로계약서 — 에듀플렉스 명시 우선.
  // 코디·기타직무(외부용) 근로계약서는 제외 — 이름 부분매치로 새 템플릿이 끼어들면
  // "신규입사 체크 시 에듀플렉스 강제 전환"이 엉뚱한 계약서로 가는 사고 재발(코디 사고와 동일 패턴)
  const empTemplate = templates.find(t => t.name.includes("에듀플렉스") && t.name.includes("근로계약"))
    || templates.find(t => t.name.includes("근로계약") && !t.name.includes("코디") && !t.name.includes("기타직무"))
    || templates.find(t => t.type === "EMPLOYMENT" && !t.name.includes("코디") && !t.name.includes("기타직무"));
  const canBundle = !!ndaTemplate && !!privacyTemplate && !!empTemplate;

  // 퇴사 패키지 5종 — 전부 결재라인(비밀유지서약서(퇴직시)도 결재표 신설로 결재라인, 2026-08-25)
  // 코디 채용 패키지 — 코디 계약서 4종(정규직 주40/주35·계약직 일반/단기) 중 선택 + 비밀유지·개인정보동의서
  const codiTemplates = templates.filter(t => t.name.includes("코디") && t.name.includes("근로계약서"));
  const canCodiBundle = codiTemplates.length > 0 && !!ndaTemplate && !!privacyTemplate;

  // 외부 채용 패키지 — 기타직무 계약서(학습실장 등) + 비밀유지·개인정보동의서, 게스트 링크 하나로 함께 서명
  const extTemplate = templates.find(t => t.name.includes("기타직무"));
  const canExtBundle = !!extTemplate && !!ndaTemplate && !!privacyTemplate;

  const resignTemplates = [
    templates.find(t => t.name.includes("사직원")),
    templates.find(t => t.name.includes("금품청산")),
    templates.find(t => t.name.includes("퇴직금 정산")),
    templates.find(t => t.name.includes("연차수당")),
    templates.find(t => t.name.includes("비밀유지") && t.name.includes("퇴직")),
  ];
  const canResignBundle = resignTemplates.every(Boolean);

  // 선택 템플릿 + (패키지면) 묶음 문서들 필드까지 스캔해 입력란 합집합 구성
  const scanFields = async (templateId: string, includeBundle: boolean, resignScan = false) => {
    setDayHours(Array(7).fill("")); // 템플릿·모드가 바뀌면 요일별 계산 보조칸도 초기화 (잔존값 합산 사고 방지)
    lastAutoEnd.current = ""; // 종료일 자동값 추적도 리셋
    setTemplateFields([]); setExtraFields({}); setTemplateConditions([]); setFieldConditions({}); setContractKind("신규입사"); setEmployeeFillFields([]);
    const ids = [templateId];
    if (includeBundle) {
      if (ndaTemplate) ids.push(ndaTemplate.id);
      if (privacyTemplate) ids.push(privacyTemplate.id);
    }
    if (resignScan) {
      for (const t of resignTemplates) if (t && !ids.includes(t.id)) ids.push(t.id);
    }
    const results = await Promise.all(
      ids.map(id => fetch(`/api/contract-templates/${id}/fields${externalMode ? "?external=1" : ""}`).then(r => r.json()).catch(() => ({})))
    );
    const fields: string[] = [];
    const conditions: string[] = [];
    const empFill: string[] = [];
    const fieldConds: Record<string, string> = {};
    const docsMap: Record<string, string> = {}; // 필드 → 출처 문서명 (#113)
    results.forEach((d, i) => {
      const docName = templates.find(t => t.id === ids[i])?.name || "";
      for (const f of d.fields || []) {
        if (!fields.includes(f)) fields.push(f);
        if (docName) docsMap[f] = docsMap[f] && docsMap[f] !== docName ? "여러 문서 공통" : (docsMap[f] || docName);
      }
      for (const c of d.conditions || []) if (!conditions.includes(c)) conditions.push(c);
      for (const f of d.employeeFields || []) if (!empFill.includes(f)) empFill.push(f);
      Object.assign(fieldConds, d.fieldConditions || {});
    });
    setTemplateFields(fields); setTemplateConditions(conditions); setFieldConditions(fieldConds); setEmployeeFillFields(empFill); setFieldDocs(docsMap);

    // 시각 필드 기본값 — 직영 표준 근무가 13~20시라 미리 채워 둔다(수정 가능).
    // 개시·출근·시작류 = 13:00, 종료·퇴근류 = 20:00
    setExtraFields(prev => {
      const next = { ...prev };
      for (const f of fields) {
        if (!/시각$/.test(f) || next[f]) continue;
        if (/개시|출근|시작/.test(f)) next[f] = "13:00";
        else if (/종료|퇴근/.test(f)) next[f] = "20:00";
      }
      return next;
    });
  };

  // 제목 자동 생성 — "올해연도 + 직원명 + 근로계약서(또는 템플릿명)"
  // 패키지/근로계약서(EMPLOYMENT)/템플릿 미선택 → "근로계약서", 그 외 단일 템플릿 → 템플릿명
  // 문서 제목 접두사 "연도 지점 이름" — 모든 문서가 같은 규칙을 쓰게 (#161, 2026-08-28)
  const titlePrefix = (userId: string) => {
    const emp = employees.find(e => e.id === userId);
    const year = new Date().getFullYear();
    return `${year}${emp?.branch ? ` ${emp.branch}` : ""} ${emp?.name || ""}`.trim();
  };

  const autoContractTitle = (userId: string, templateId?: string, bundle?: boolean, resign?: boolean) => {
    const year = new Date().getFullYear();
    const emp = employees.find(e => e.id === userId);
    const empName = emp?.name || "";
    if (!empName) return "";
    // 지점 포함 — 동명이인 구분 (김가산 제안, 디렉터 확정 2026-08-25)
    const branchPart = emp?.branch ? ` ${emp.branch}` : "";
    if (resign) return `${year}${branchPart} ${empName} 사직원`; // 퇴사 패키지 대표 문서
    const t = templateId ? templates.find(x => x.id === templateId) : undefined;
    // 코디 계약서는 구분(정규직/계약직 등)이 이름에 있어 템플릿명을 그대로 사용
    const docName = bundle || !t ? "근로계약서" : t.name.includes("코디") ? t.name : t.type === "EMPLOYMENT" ? "근로계약서" : t.name;
    return `${year}${branchPart} ${empName} ${docName}`;
  };

  const handleTemplateSelect = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      setCreateForm(f => ({ ...f, title: autoContractTitle(f.userId, templateId, bundleMode, resignBundleMode), type: template.type }));
      scanFields(templateId, bundleMode || extBundleMode, resignBundleMode);
    }
  };

  // 직원·패키지 선택만으로도 제목 자동 채움 (템플릿 미선택이어도 "근로계약서" 기준)
  useEffect(() => {
    if (!useTemplate) return;
    if (externalMode) {
      // 외부 계약: "올해 + 외부인 이름 + 템플릿명"
      if (!externalForm.name.trim()) return;
      const t = selectedTemplate ? templates.find(x => x.id === selectedTemplate) : undefined;
      setCreateForm(f => ({ ...f, title: `${new Date().getFullYear()} ${externalForm.name.trim()} ${t?.name || "계약서"}` }));
      return;
    }
    if (!createForm.userId) return;
    setCreateForm(f => ({ ...f, title: autoContractTitle(f.userId, selectedTemplate || undefined, bundleMode, resignBundleMode) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createForm.userId, selectedTemplate, useTemplate, bundleMode, resignBundleMode, externalMode, externalForm.name]);

  // 직원 선택 시 생년월일(프로필 있으면)·원장명(지점 원장) 자동 채움
  useEffect(() => {
    if (!createForm.userId || templateFields.length === 0) return;
    const emp = employees.find(e => e.id === createForm.userId);
    if (!emp) return;
    const updates: Record<string, string> = {};
    if (templateFields.includes("생년월일") && emp.birthDate) updates["생년월일"] = String(emp.birthDate).slice(0, 10);
    // 퇴사 패키지: 근무시작일·연차시작일은 입사일과 동일하게 자동 기입
    if (emp.hireDate) {
      const hire = String(emp.hireDate).slice(0, 10);
      if (templateFields.includes("근무시작일")) updates["근무시작일"] = hire;
      if (templateFields.includes("연차시작일")) updates["연차시작일"] = hire;
    }
    if (templateFields.includes("원장명") && emp.branch) {
      const mgr = employees.find(e => e.role === "MANAGER" && (e.branch === emp.branch || (e.managerBranches || []).includes(emp.branch!)));
      if (mgr) updates["원장명"] = mgr.name;
    }
    if (Object.keys(updates).length) setExtraFields(prev => ({ ...prev, ...updates }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createForm.userId, templateFields]);

  // 계약직 근로시간 자동 계산 (개선 제안 2026-08-24, 공식은 이예지대리 확정)
  //  일근무시간 = (퇴근-출근) - 휴게   /   월근로시간 = (주 + min(주/40×8, 8)) × 4.345 반올림
  // 소스 값(시각·휴게·주근무시간)이 바뀔 때마다 재계산해 덮는다 — 수기 실수 방지가 목적.
  useEffect(() => {
    if (!templateFields.includes("월근로시간")) return; // 계약직 계약서에만 있는 필드
    const inT = extraFields["출근시각"] || "", outT = extraFields["퇴근시각"] || "", rest = extraFields["휴게시간"] || "";
    const week = parseFloat(extraFields["주근무시간"] || "");
    setExtraFields(prev => {
      const u = { ...prev };
      const fmtH = (h: number) => (Number.isInteger(h) ? String(h) : String(Math.round(h * 100) / 100));
      if (/^\d{2}:\d{2}$/.test(inT) && /^\d{2}:\d{2}$/.test(outT) && rest.trim()) {
        const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
        let mins = toMin(outT) - toMin(inT);
        if (mins < 0) mins += 1440; // 자정 넘김
        // 휴게: "30분"/"1시간"/"1시간 30분"/"1.5시간"/"1:30"/"30"(분 간주) 모두 허용
        // 소수 표기("1.5시간")까지 받도록 [\d.] — 정수만 잡으면 "1.5시간"이 "5시간"으로 오파싱된다(검증관 지적)
        const colon = /^(\d+):(\d{1,2})$/.exec(rest.trim());
        const hm = /([\d.]+)\s*시간/.exec(rest);
        const mm = /([\d.]+)\s*분/.exec(rest);
        const restMin = colon
          ? Number(colon[1]) * 60 + Number(colon[2])
          : hm || mm
          ? (hm ? parseFloat(hm[1]) * 60 : 0) + (mm ? parseFloat(mm[1]) : 0)
          : parseFloat(rest.replace(/[^\d.]/g, "")) || 0;
        const work = (mins - restMin) / 60;
        // 휴게가 근무시간보다 크면 잘못된 입력 — 옛 계산값이 남지 않게 비운다
        u["일근무시간"] = work > 0 ? fmtH(work) : "";
      }
      if (week > 0) {
        const weeklyRest = Math.min((week / 40) * 8, 8); // 주휴시간 (비례, 최대 8h)
        u["월근로시간"] = String(Math.round((week + weeklyRest) * 4.345));
      } else if (!(extraFields["주근무시간"] || "").trim()) {
        // 주근무시간을 지우면 파생된 월근로시간도 비운다 — 옛 값이 계약서에 남는 것 방지
        u["월근로시간"] = "";
      }
      // 변화 없으면 그대로 반환해 불필요한 리렌더 방지
      return u["일근무시간"] === prev["일근무시간"] && u["월근로시간"] === prev["월근로시간"] ? prev : u;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraFields["출근시각"], extraFields["퇴근시각"], extraFields["휴게시간"], extraFields["주근무시간"], templateFields]);

  // 근로계약서 교육·실무 평가 단계 자동 계산 (개선 제안 2026-08-25 → 공식 수정 2026-08-26 #22)
  //  실무평가 시작 = 입사일부터 15번째 영업일, 교육평가 종료 = 그 전날(캘린더). 영업일 = 주말·공휴일 제외.
  //  (7/6 입사→실무 7/27, 8/31 입사→실무 9/18 두 확정례 모두 이 공식으로 성립 — 기존 "+2일"은 8/31 케이스에서 이틀 밀렸음)
  //  실무평가 종료 = 입사일 + 3개월 - 1일
  const [holidaySet, setHolidaySet] = useState<Set<string>>(new Set());
  // 기준일 — 담당자가 문서의 {근로시작일}을 직접 넣었으면 그 값이 우선, 없으면 계약 시작일.
  // 재계약의 근로시작일은 "최초 입사일"이라 평가 단계 기준으로 쓰면 안 된다 (#175, 2026-08-31)
  const evalBaseDate =
    (contractKind === "신규입사" && (extraFields["근로시작일"] || "").trim()) || createForm.startDate;
  useEffect(() => {
    if (!templateFields.includes("교육평가시작") || !evalBaseDate) return;
    const y = Number(evalBaseDate.slice(0, 4));
    if (!y || y < 2000) return;
    // 3개월 범위가 다음 해로 넘어갈 수 있어 두 해 로드
    Promise.all([y, y + 1].map(yy => fetch(`/api/holidays?year=${yy}`).then(r => r.json()).catch(() => ({ holidays: [] }))))
      .then(res => setHolidaySet(new Set(res.flatMap(d => (d.holidays || []).map((h: { date: string }) => h.date)))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateFields, evalBaseDate?.slice(0, 4)]);

  useEffect(() => {
    if (!templateFields.includes("교육평가시작")) return;
    const start = evalBaseDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "") || holidaySet.size === 0) return;
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const isBiz = (d: Date) => {
      const dow = d.getUTCDay();
      return dow !== 0 && dow !== 6 && !holidaySet.has(fmt(d));
    };
    // 영업일 15일째 되는 날 = 실무평가 시작 (입사일이 영업일이면 1일째)
    const d = new Date(start + "T00:00:00Z");
    let count = 0;
    let guard = 0;
    while (count < 15 && guard++ < 60) {
      if (isBiz(d)) count++;
      if (count < 15) d.setUTCDate(d.getUTCDate() + 1);
    }
    const pracStart = new Date(d);
    d.setUTCDate(d.getUTCDate() - 1); // 교육평가 종료 = 실무 시작 전날
    const eduEnd = fmt(d);
    const p3 = new Date(start + "T00:00:00Z");
    p3.setUTCMonth(p3.getUTCMonth() + 3); p3.setUTCDate(p3.getUTCDate() - 1); // +3개월 - 1일
    setExtraFields(prev => {
      const u = {
        ...prev,
        교육평가시작: start,
        교육평가종료: eduEnd,
        실무평가시작: fmt(pracStart),
        실무평가종료: fmt(p3),
      };
      return u.교육평가종료 === prev.교육평가종료 && u.실무평가종료 === prev.실무평가종료 && u.교육평가시작 === prev.교육평가시작 && u.실무평가시작 === prev.실무평가시작 ? prev : u;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateFields, evalBaseDate, holidaySet]);

  // 퇴사일자 입력 시 근무종료일·연차종료일 + 지급희망일 자동 기입 (이후 수동 수정 가능)
  // 지급희망일 규칙 (#115, 이예지대리 확정 2026-08-27): 임금은 항상 해당 월 말일,
  // 퇴직금은 말일 이전 퇴사 → 해당 월 말일 / 말일 퇴사 → 익월 10일.
  // 두 지급희망일 필드는 퇴직금 기준(익월 조건 포함)으로 채운다 — 필요 시 수동 수정.
  useEffect(() => {
    const d = extraFields["퇴사일자"];
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const [y, m, day] = d.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 해당 월 말일
    const fmt = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    const severanceDay = day >= lastDay
      ? (m === 12 ? fmt(y + 1, 1, 10) : fmt(y, m + 1, 10)) // 말일 퇴사 → 익월 10일
      : fmt(y, m, lastDay); // 그 외 → 해당 월 말일
    setExtraFields(prev => {
      const u = { ...prev };
      if (templateFields.includes("근무종료일")) u["근무종료일"] = d;
      if (templateFields.includes("연차종료일")) u["연차종료일"] = d;
      if (templateFields.includes("지급희망일")) u["지급희망일"] = severanceDay;
      if (templateFields.includes("금품청산 지급희망일")) u["금품청산 지급희망일"] = severanceDay;
      return u;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraFields["퇴사일자"], templateFields]);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      setRole(d.user?.role || "EMPLOYEE");
      setMyId(d.user?.id || "");
      setMyName(d.user?.name || "");
      setMySignatureUrl(d.user?.signatureUrl || null);
    });
    // includeAdmins: 승인자 선택에 관리자도 나오도록 (계약 대상 목록에서는 클라이언트에서 제외)
    fetch("/api/employees?includeAdmins=true").then(r => r.json()).then(d => setEmployees(d.employees || [])).catch(() => {});
  }, []);

  useEffect(() => {
    fetchContracts();
    fetchTemplates();
  }, [fetchContracts, fetchTemplates]);

  async function handleDeleteTemplate(templateId: string) {
    setDeletingTemplateId(templateId);
    try {
      const res = await fetch(`/api/contract-templates/${templateId}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "템플릿 삭제에 실패했습니다.");
        setDeletingTemplateId(null);
        return;
      }

      toast.success("템플릿이 삭제되었습니다.");
      setDeletingTemplateId(null);
      fetchTemplates();
    } catch (error) {
      console.error("템플릿 삭제 실패:", error);
      toast.error("템플릿 삭제에 실패했습니다.");
      setDeletingTemplateId(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();

    // 템플릿 사용 시에는 파일이 서버에서 처리됨
    if (!useTemplate && files.length === 0) { toast.error("파일을 선택해주세요."); return; }
    if (externalMode) {
      if (!externalForm.name.trim()) { toast.error("외부 계약자 이름을 입력해주세요."); return; }
    } else if (!createForm.userId) { toast.error("직원을 선택해주세요."); return; }
    if (!createForm.title) { toast.error("제목을 입력해주세요."); return; }

    setUploading(true);

    // 일괄 작성 (개선 제안 #80): 같은 날짜·조건으로 여러 직원에게 각각 작성.
    // 개인별 필드(생년월일·근무시작일·연차시작일·원장명)는 공통 입력값 대신 각자 것으로 덮어쓴다.
    if (bulkMode && !externalMode) {
      if (bulkUserIds.length === 0) { toast.error("일괄 발송할 직원을 선택해주세요."); setUploading(false); return; }
      if (!(useTemplate && selectedTemplate)) { toast.error("일괄 발송은 템플릿 선택 시에만 가능합니다."); setUploading(false); return; }
      // 퇴사·코디 패키지는 일괄과 병용 불가 — 상태 꼬임으로 단일 문서만 생성되는 사고 방지 (검증관 2026-08-26)
      if (resignBundleMode || codiBundleMode) {
        toast.error("퇴사·코디 패키지는 일괄 발송을 지원하지 않습니다. 일괄 체크를 해제해주세요."); setUploading(false); return;
      }
      if (bundleMode && empTemplate && selectedTemplate !== empTemplate.id) {
        toast.error("신규입사 패키지는 에듀플렉스 근로계약서로만 발송할 수 있습니다."); setUploading(false); return;
      }
      // 계약시작일과 입사일이 다른 직원이 섞이면 평가 단계(공통 계산)와 어긋난다 — 확인 후 진행
      if (createForm.startDate) {
        const mismatch = bulkUserIds
          .map(uid => employees.find(x => x.id === uid))
          .filter(x => x?.hireDate && String(x.hireDate).slice(0, 10) !== createForm.startDate)
          .map(x => x!.name);
        if (mismatch.length && !confirm(`입사일이 계약시작일(${createForm.startDate})과 다른 직원이 있습니다: ${mismatch.join(", ")}\n교육·실무평가 기간은 계약시작일 기준으로 전원 동일하게 들어갑니다. 계속할까요?`)) {
          setUploading(false); return;
        }
      }
      const common: Record<string, string> = {};
      for (const [k, v] of Object.entries(extraFields)) {
        if (fieldConditions[k] && fieldConditions[k] !== contractKind) continue;
        common[k] = v;
      }
      for (const f of templateFields) if (f.startsWith("체크_") && !(f in common)) common[f] = f.includes("기타") ? "□" : "☑";
      for (const f of templateFields) if (f.startsWith("선택_") && !(f in common)) common[f] = "□";
      if (templateConditions.includes("신규입사")) common["계약구분"] = contractKind;
      let ok = 0; const failed: string[] = [];
      for (const uid of bulkUserIds) {
        const emp = employees.find(x => x.id === uid);
        if (!emp) continue;
        const per = { ...common };
        if (templateFields.includes("생년월일")) per["생년월일"] = emp.birthDate ? String(emp.birthDate).slice(0, 10) : "";
        {
          // hireDate 없는 직원에게 공통값(첫 직원 것)이 새어 들어가지 않게 항상 덮어쓴다 (검증관 2026-08-26)
          const hire = emp.hireDate ? String(emp.hireDate).slice(0, 10) : "";
          if (templateFields.includes("근무시작일")) per["근무시작일"] = hire;
          if (templateFields.includes("연차시작일")) per["연차시작일"] = hire;
        }
        if (templateFields.includes("원장명")) {
          const mgr = employees.find(x => x.role === "MANAGER" && (x.branch === emp.branch || (x.managerBranches || []).includes(emp.branch!)));
          per["원장명"] = mgr?.name || "";
        }
        const title = autoContractTitle(uid, selectedTemplate, bundleMode, false) || createForm.title;
        try {
          let res: Response;
          if (bundleMode && ndaTemplate && privacyTemplate) {
            const items = [
              { templateId: selectedTemplate, title, type: "EMPLOYMENT",
                startDate: createForm.startDate, endDate: createForm.endDate, salary: createForm.salary,
                extraFields: per, employeeOnly: false },
              { templateId: ndaTemplate.id, title: `${titlePrefix(emp.id)} 비밀유지서약서(입사)`, type: "CONFIDENTIAL",
                extraFields: per, employeeOnly: true },
              { templateId: privacyTemplate.id, title: `${titlePrefix(emp.id)} 개인정보수집이용동의서`, type: "OTHER",
                extraFields: { ...per, 동의고유식별: "미선택", 동의채용정보: "미선택" }, employeeOnly: true },
            ];
            res = await fetch("/api/contracts/bundle", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: uid, items }),
            });
          } else {
            const fd = new FormData();
            fd.append("templateId", selectedTemplate);
            fd.append("userId", uid);
            fd.append("title", title);
            fd.append("type", createForm.type);
            fd.append("startDate", createForm.startDate);
            fd.append("endDate", createForm.endDate);
            fd.append("salary", createForm.salary);
            fd.append("extraFields", JSON.stringify(per));
            res = await fetch("/api/contracts", { method: "POST", body: fd });
          }
          if (res.ok) ok++; else failed.push(emp.name);
        } catch { failed.push(emp.name); }
      }
      setUploading(false);
      if (failed.length) toast.error(`${ok}명 작성 완료, 실패: ${failed.join(", ")}`);
      else toast.success(`${ok}명에게 ${bundleMode ? "신규입사 패키지 3종이" : "계약서가"} 작성되었습니다. 목록에서 각각 발송해주세요.`);
      setCreateOpen(false);
      setBulkMode(false); setBulkUserIds([]);
      setUseTemplate(false); setSelectedTemplate(""); setBundleMode(false); setEmployeeSearchText("");
      setCreateForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "", salary: "" });
      setTemplateFields([]); setExtraFields({}); setTemplateConditions([]); setFieldConditions({}); setContractKind("신규입사");
      fetchContracts();
      return;
    }

    // 외부 채용 패키지: 기타직무 계약서 + 비밀유지 + 개인정보동의서 3종 묶음 (게스트 링크 하나로 함께 서명)
    if (externalMode && extBundleMode && useTemplate && selectedTemplate && ndaTemplate && privacyTemplate) {
      // 대표 문서는 반드시 기타직무 계약서 (다른 계약서가 섞이지 않도록 서버 전송 직전 재확인)
      if (extTemplate && selectedTemplate !== extTemplate.id) {
        toast.error("외부 채용 패키지는 기타직무 근로계약서로만 발송할 수 있습니다.");
        setUploading(false);
        return;
      }
      // 비밀유지서약서·동의서에 들어가는 필수 정보 — 비우면 문서가 빈칸으로 나가므로 차단
      const missingNda = ["생년월일", "주소", "원장명"].filter(f => templateFields.includes(f) && !(extraFields[f] || "").trim());
      if (missingNda.length) {
        toast.error(`비밀유지서약서·동의서 정보를 입력해주세요: ${missingNda.join(", ")}`);
        setUploading(false);
        return;
      }
      const allExtra: Record<string, string> = {};
      for (const [k, v] of Object.entries(extraFields)) {
        if (fieldConditions[k] && fieldConditions[k] !== contractKind) continue;
        allExtra[k] = v;
      }
      const extName = externalForm.name.trim();
      const items = [
        { templateId: selectedTemplate, title: createForm.title, type: "EMPLOYMENT",
          startDate: createForm.startDate, endDate: createForm.endDate, salary: createForm.salary,
          extraFields: allExtra, employeeOnly: false },
        { templateId: ndaTemplate.id, title: `${new Date().getFullYear()} ${extName} 비밀유지서약서(입사)`, type: "CONFIDENTIAL",
          extraFields: allExtra, employeeOnly: true },
        { templateId: privacyTemplate.id, title: `${new Date().getFullYear()} ${extName} 개인정보수집이용동의서`, type: "OTHER",
          // 선택 항목은 기본 동의 — 외부 계약자가 서명 페이지에서 미동의로 바꿀 수 있음
          extraFields: { ...allExtra, 동의고유식별: "미선택", 동의채용정보: "미선택" }, employeeOnly: true },
      ];
      const res = await fetch("/api/contracts/bundle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalName: extName, externalPhone: externalForm.phone.trim(), items }),
      });
      const data = await res.json();
      setUploading(false);
      if (!res.ok) { toast.error(data.error || "외부 패키지 생성 실패"); return; }
      toast.success("외부 채용 패키지 3종이 작성되었습니다. 계약서에서 발송하면 3종이 함께 발송됩니다.");
      setCreateOpen(false);
      setUseTemplate(false); setSelectedTemplate(""); setExtBundleMode(false); setExternalMode(false);
      setExternalForm({ name: "", phone: "" }); setEmployeeSearchText("");
      setCreateForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "", salary: "" });
      setTemplateFields([]); setExtraFields({}); setTemplateConditions([]); setFieldConditions({}); setContractKind("신규입사");
      fetchContracts();
      return;
    }

    // 코디 채용 패키지: 선택한 코디 계약서 + 비밀유지 + 개인정보동의서 3종 묶음
    if (codiBundleMode && useTemplate && selectedTemplate && ndaTemplate && privacyTemplate) {
      const allExtra: Record<string, string> = {};
      for (const [k, v] of Object.entries(extraFields)) {
        if (fieldConditions[k] && fieldConditions[k] !== contractKind) continue;
        allExtra[k] = v;
      }
      const empName = employees.find(e => e.id === createForm.userId)?.name || "";
      const items = [
        { templateId: selectedTemplate, title: createForm.title, type: "EMPLOYMENT",
          startDate: createForm.startDate, endDate: createForm.endDate, salary: createForm.salary,
          extraFields: allExtra, employeeOnly: false },
        { templateId: ndaTemplate.id, title: `${titlePrefix(createForm.userId)} 비밀유지서약서(입사)`, type: "CONFIDENTIAL",
          extraFields: allExtra, employeeOnly: true },
        { templateId: privacyTemplate.id, title: `${titlePrefix(createForm.userId)} 개인정보수집이용동의서`, type: "OTHER",
          extraFields: { ...allExtra, 동의고유식별: "미선택", 동의채용정보: "미선택" }, employeeOnly: true },
      ];
      const res = await fetch("/api/contracts/bundle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: createForm.userId, items }),
      });
      const data = await res.json();
      setUploading(false);
      if (!res.ok) { toast.error(data.error || "코디 패키지 생성 실패"); return; }
      toast.success("코디 채용 패키지 3종이 작성되었습니다. 코디 계약서에서 발송하면 3종이 함께 발송됩니다.");
      setCreateOpen(false);
      setUseTemplate(false); setSelectedTemplate(""); setCodiBundleMode(false); setEmployeeSearchText("");
      setCreateForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "", salary: "" });
      setTemplateFields([]); setExtraFields({}); setTemplateConditions([]); setFieldConditions({}); setContractKind("신규입사");
      fetchContracts();
      return;
    }

    // 퇴사 패키지: 사직원 + 금품청산·퇴직금·연차수당 정산 + 비밀유지서약서(퇴직시) 5종 묶음
    if (resignBundleMode && useTemplate && canResignBundle) {
      const allExtra: Record<string, string> = {};
      for (const [k, v] of Object.entries(extraFields)) {
        if (fieldConditions[k] && fieldConditions[k] !== contractKind) continue;
        allExtra[k] = v;
      }
      // 손대지 않은 체크박스 필드(지급금품 등)는 기본 체크(☑)
      // "기타"류는 실수 방지를 위해 기본 해제 (개선 제안 2026-08-24)
      for (const f of templateFields) if (f.startsWith("체크_") && !(f in allExtra)) allExtra[f] = f.includes("기타") ? "□" : "☑";
      // 선택_ 는 고르지 않은 항목이 빈칸으로 남지 않게 □ 로 채운다(기본은 전부 해제)
      for (const f of templateFields) if (f.startsWith("선택_") && !(f in allExtra)) allExtra[f] = "□";
      const year = new Date().getFullYear();
      const resignEmp = employees.find(e => e.id === createForm.userId);
      const empName = resignEmp?.name || "";
      const prefix = `${year}${resignEmp?.branch ? ` ${resignEmp.branch}` : ""} ${empName}`; // 지점 포함 (동명이인 대비)
      const [rSajik, rGeum, rToejikgeum, rYeoncha, rNda] = resignTemplates as NonNullable<typeof resignTemplates[number]>[];
      const items = [
        { templateId: rSajik.id, title: `${prefix} 사직원`, type: "OTHER", extraFields: allExtra, employeeOnly: false },
        { templateId: rGeum.id, title: `${prefix} 금품청산 지급기일연장 동의서`, type: "OTHER", extraFields: allExtra, employeeOnly: false },
        { templateId: rToejikgeum.id, title: `${prefix} 퇴직금 정산 신청서`, type: "OTHER", extraFields: allExtra, employeeOnly: false },
        { templateId: rYeoncha.id, title: `${prefix} 연차수당 정산 신청서`, type: "OTHER", extraFields: allExtra, employeeOnly: false },
        // 비밀유지서약서(퇴직시) — 결재표(원장·본부)가 서식에 추가되어 결재라인을 태운다 (QA 2026-08-25)
        { templateId: rNda.id, title: `${prefix} 비밀유지서약서(퇴직)`, type: "CONFIDENTIAL", extraFields: allExtra, employeeOnly: false },
      ];
      const res = await fetch("/api/contracts/bundle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: createForm.userId, items }),
      });
      const data = await res.json();
      setUploading(false);
      if (!res.ok) { toast.error(data.error || "퇴사 패키지 생성 실패"); return; }
      toast.success("퇴사 패키지 5종이 작성되었습니다. 사직원에서 발송하면 5종이 함께 발송됩니다.");
      setCreateOpen(false);
      setUseTemplate(false); setSelectedTemplate(""); setResignBundleMode(false); setEmployeeSearchText("");
      setCreateForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "", salary: "" });
      setTemplateFields([]); setExtraFields({}); setTemplateConditions([]); setFieldConditions({}); setContractKind("신규입사");
      fetchContracts();
      return;
    }

    // 신규입사 패키지: 근로계약서 + 비밀유지 + 개인정보동의서를 한 묶음으로 생성
    // 대표 문서는 반드시 에듀플렉스 근로계약서 (코디 계약서가 섞이지 않도록 서버 전송 직전 재확인)
    if (bundleMode && useTemplate && selectedTemplate && ndaTemplate && privacyTemplate) {
      if (empTemplate && selectedTemplate !== empTemplate.id) {
        toast.error("신규입사 패키지는 에듀플렉스 근로계약서로만 발송할 수 있습니다.");
        setUploading(false);
        return;
      }
      const allExtra: Record<string, string> = {};
      for (const [k, v] of Object.entries(extraFields)) {
        if (fieldConditions[k] && fieldConditions[k] !== contractKind) continue;
        allExtra[k] = v;
      }
      allExtra["계약구분"] = contractKind;
      const empName = employees.find(e => e.id === createForm.userId)?.name || "";
      const items = [
        { templateId: selectedTemplate, title: createForm.title, type: "EMPLOYMENT",
          startDate: createForm.startDate, endDate: createForm.endDate, salary: createForm.salary,
          extraFields: allExtra, employeeOnly: false },
        { templateId: ndaTemplate.id, title: `${titlePrefix(createForm.userId)} 비밀유지서약서(입사)`, type: "CONFIDENTIAL",
          extraFields: allExtra, employeeOnly: true },
        { templateId: privacyTemplate.id, title: `${titlePrefix(createForm.userId)} 개인정보수집이용동의서`, type: "OTHER",
          // 선택 항목은 기본 동의 — 직원이 서명 시 미동의로 바꿀 수 있음
          extraFields: { ...allExtra, 동의고유식별: "미선택", 동의채용정보: "미선택" }, employeeOnly: true },
      ];
      const res = await fetch("/api/contracts/bundle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: createForm.userId, items }),
      });
      const data = await res.json();
      setUploading(false);
      if (!res.ok) { toast.error(data.error || "패키지 생성 실패"); return; }
      toast.success("신규입사 패키지 3종이 작성되었습니다. 근로계약서에서 발송하면 3종이 함께 발송됩니다.");
      setCreateOpen(false);
      setUseTemplate(false); setSelectedTemplate(""); setBundleMode(false); setEmployeeSearchText("");
      setCreateForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "", salary: "" });
      setTemplateFields([]); setExtraFields({}); setTemplateConditions([]); setFieldConditions({}); setContractKind("신규입사");
      fetchContracts();
      return;
    }

    const formData = new FormData();

    if (useTemplate && selectedTemplate) {
      formData.append("templateId", selectedTemplate);
    } else {
      // 모든 파일 추가
      files.forEach((file, index) => {
        formData.append(`files`, file);
      });
    }

    formData.append("userId", createForm.userId);
    if (externalMode) {
      formData.append("externalName", externalForm.name.trim());
      formData.append("externalPhone", externalForm.phone.trim());
    }
    formData.append("title", createForm.title);
    formData.append("type", createForm.type);
    formData.append("startDate", createForm.startDate);
    formData.append("endDate", createForm.endDate);
    formData.append("salary", createForm.salary);
    {
      // 계약 구분에 해당하지 않는(숨겨진) 필드 값은 제외하고 전송
      const allExtra: Record<string, string> = {};
      for (const [k, v] of Object.entries(extraFields)) {
        if (fieldConditions[k] && fieldConditions[k] !== contractKind) continue;
        allExtra[k] = v;
      }
      // 손대지 않은 체크박스 필드는 기본 체크(☑)로 전송
      // "기타"류는 실수 방지를 위해 기본 해제 (개선 제안 2026-08-24)
      for (const f of templateFields) if (f.startsWith("체크_") && !(f in allExtra)) allExtra[f] = f.includes("기타") ? "□" : "☑";
      // 선택_ 는 고르지 않은 항목이 빈칸으로 남지 않게 □ 로 채운다(기본은 전부 해제)
      for (const f of templateFields) if (f.startsWith("선택_") && !(f in allExtra)) allExtra[f] = "□";
      if (templateConditions.includes("신규입사")) allExtra["계약구분"] = contractKind;
      // 개인정보동의서 "단독" 발송에도 동의 단계가 뜨도록 키를 심는다 — 키가 없으면 서명 화면이
      // 동의 확인을 건너뛰어 빈 체크로 완료되는 회귀 (검증관 2026-08-27)
      if (privacyTemplate && selectedTemplate === privacyTemplate.id) {
        if (!allExtra["동의고유식별"]) allExtra["동의고유식별"] = "미선택";
        if (!allExtra["동의채용정보"]) allExtra["동의채용정보"] = "미선택";
      }
      if (Object.keys(allExtra).length > 0) formData.append("extraFields", JSON.stringify(allExtra));
    }

    const res = await fetch("/api/contracts", { method: "POST", body: formData });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("계약서 작성됨");
    setCreateOpen(false);
    setFiles([]);
    setUseTemplate(false);
    setSelectedTemplate("");
    setEmployeeSearchText("");
    setCreateForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "", salary: "" }); setTemplateFields([]); setExtraFields({}); setTemplateConditions([]); setFieldConditions({}); setContractKind("신규입사");
    fetchContracts();
  }

  // 폰의 기본 문자 앱을 수신번호·본문이 채워진 채로 연다(법인폰 요금제로 발송 — 서버 발송 아님).
  // iOS 는 sms:번호&body=, 그 외는 sms:번호?body= 형식을 쓴다.
  function openSmsApp(phone: string, text: string) {
    const num = phone.replace(/[^0-9+]/g, "");
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    window.location.href = `sms:${num}${isIos ? "&" : "?"}body=${encodeURIComponent(text)}`;
  }

  function smsBody(name: string, url: string) {
    return `[큐브티 전자계약]
${name}님, 계약서가 도착했습니다.
아래 링크에서 내용 확인 후 서명해 주세요.
${url}`;
  }

  async function handleSend(id: string) {
    if (approverIds.length === 0) { toast.error("승인자를 선택해주세요."); return; }

    // 패키지(묶음)면 3종을 함께 발송 — 근로계약서는 결재라인 전체, 나머지는 직원 서명만
    const bundleId = sendTarget?.bundleId;
    if (bundleId) {
      const res = await fetch(`/api/contracts/bundle/${bundleId}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approverIds }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "패키지 발송 실패"); return; }
      if (sendTarget?.externalName) {
        toast.success(`패키지 ${data.sent}종 발송됨 — 링크 하나로 전 문서를 함께 서명합니다.`);
        if (data.externalSignToken) {
          setExtLink({
            url: `${window.location.origin}/sign/${data.externalSignToken}`,
            name: sendTarget.externalName,
            phone: sendTarget.externalPhone || null,
          });
          setExtLinkOpen(true);
        }
      } else {
        toast.success(`패키지 ${data.sent}종 발송됨`);
      }
      setSendOpen(false);
      resetApproverSlots();
      fetchContracts();
      return;
    }

    const res = await fetch(`/api/contracts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "SENT", approverIds }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    // 재발송 시 결재라인이 새로 만들어져 외부 서명 링크도 재생성됨 — 기존 링크는 무효
    if (sendTarget?.externalName) {
      toast.success("계약서 발송됨 — 서명 링크가 새로 생성되었습니다(기존 링크는 무효).");
      const extStep = (data.contract?.approvalLine?.steps || []).find(
        (st: { approverId?: string | null; signToken?: string | null }) => !st.approverId && st.signToken
      );
      if (extStep?.signToken) {
        setExtLink({
          url: `${window.location.origin}/sign/${extStep.signToken}`,
          name: sendTarget.externalName,
          phone: sendTarget.externalPhone || null,
        });
        setExtLinkOpen(true);
      }
    } else {
      toast.success("계약서 발송됨");
    }
    setSendOpen(false);
    resetApproverSlots();
    fetchContracts();
  }

  // ── 승인자 슬롯 조작 (#158·#159) ──────────────────────────────
  function resetApproverSlots() {
    setApproverSlots([null, null, null]);
    setActiveSlot(null);
  }

  // 후보 클릭 → 지정한 슬롯(없으면 비어 있는 가장 앞 슬롯)에 배정. 같은 사람 중복 배치는 방지
  function assignApprover(id: string) {
    setApproverSlots(prev => {
      const idx = activeSlot !== null ? activeSlot : prev.findIndex(x => !x);
      if (idx < 0) return prev;
      const next = [...prev] as ApproverSlots;
      for (let i = 0; i < next.length; i++) if (next[i] === id) next[i] = null;
      next[idx] = id;
      return next;
    });
    setActiveSlot(null);
  }

  function clearApproverSlot(i: number) {
    setApproverSlots(prev => {
      const next = [...prev] as ApproverSlots;
      next[i] = null;
      return next;
    });
    setActiveSlot(null);
  }

  // 슬롯에 표시할 이름 — 외부 계약의 userId 는 "작성한 관리자"라 당사자 표기에서 제외
  function approverName(id: string): string {
    if (!sendTarget) return "?";
    if (id === "EXTERNAL") return sendTarget.externalName || "외부 서명자";
    if (id === sendTarget.userId && !sendTarget.externalName) return sendTarget.user?.name || "직원";
    return employees.find(x => x.id === id)?.name || "?";
  }
  function approverLabel(id: string): string {
    if (!sendTarget) return "?";
    if (id === "EXTERNAL") return `${sendTarget.externalName || "외부 서명자"} (외부 · 링크 서명)`;
    if (id === sendTarget.userId && !sendTarget.externalName) return `${sendTarget.user?.name || "직원"} (당사자)`;
    const e = employees.find(x => x.id === id);
    return e ? `${e.branch ? `[${e.branch}] ` : ""}${e.name}` : "?";
  }

  const [signBusy, setSignBusy] = useState(false); // 더블클릭 중복 요청 방지 (#102, 2026-08-27)
  async function handleSign(id: string, isApprover = false) {
    if (signBusy) return;
    const useSaved = !!mySignatureUrl && !drawNewSig;
    let body: Record<string, unknown>;
    if (useSaved) {
      body = { useSaved: true, isApprover };
    } else {
      if (!sigRef.current || sigRef.current.isEmpty()) { toast.error("서명을 입력해주세요."); return; }
      body = { signatureData: sigRef.current.toDataURL(), isApprover, saveAsDefault };
    }
    setSignBusy(true);
    try {
    const res = await fetch(`/api/contracts/${id}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success(isApprover ? "계약 승인됨" : "서명 완료");
    setSignOpen(false);
    // 새로 그린 서명을 기본으로 저장했으면 최신 저장 서명 반영
    if (!useSaved && saveAsDefault) {
      fetch("/api/auth/me").then(r => r.json()).then(d => setMySignatureUrl(d.user?.signatureUrl || null)).catch(() => {});
    }
    fetchContracts();
    } finally { setSignBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">전자계약</h1>
        {role !== "EMPLOYEE" && (
          <>
            <Dialog open={createOpen} onOpenChange={(open) => {
              setCreateOpen(open);
              if (!open) {
                setEmployeeSearchText("");
                setCreateForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "", salary: "" }); setTemplateFields([]); setExtraFields({}); setTemplateConditions([]); setFieldConditions({}); setContractKind("신규입사");
                setFiles([]);
                setUseTemplate(false);
                setSelectedTemplate("");
                setBundleMode(false);
                setResignBundleMode(false);
                setCodiBundleMode(false);
                setExternalMode(false);
                setExtBundleMode(false);
                setExternalForm({ name: "", phone: "" });
              }
            }}>
            <div className="flex gap-2">
              <Button className="gap-2" onClick={() => setCreateOpen(true)}><Plus size={16} />계약서 작성</Button>
              {role !== "EMPLOYEE" && (
                <DropdownMenu>
                  <DropdownMenuTrigger className="px-4 py-2 border rounded-lg hover:bg-gray-50 inline-flex items-center gap-2 outline-none">
                    <FileSignature size={16} />
                    템플릿
                    <ChevronDown size={14} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => setShowTemplatesList(true)}>
                      <FileSignature size={16} className="mr-2" />
                      저장된 템플릿 ({templates.length})
                    </DropdownMenuItem>
                    {/* 템플릿 등록·수정은 전용 메뉴(계약 템플릿)로 일원화 */}
                    <DropdownMenuItem onClick={() => (window.location.href = "/admin/contract-templates")}>
                      <Plus size={16} className="mr-2" />
                      템플릿 관리 (등록·수정)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {/* 데스크톱에서 입력 폼이 너무 좁아 라벨이 두 줄로 감기던 문제 (#143) */}
            <DialogContent className="w-[95vw] sm:!max-w-[880px] max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>계약서 작성</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                {/* 외부(미가입) 계약자 — 게스트 서명 링크로 발송 */}
                <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 space-y-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer font-medium text-violet-800">
                    <input type="checkbox" checked={externalMode}
                      onChange={e => {
                        const checked = e.target.checked;
                        setExternalMode(checked);
                        if (checked) {
                          setBundleMode(false); setResignBundleMode(false); setCodiBundleMode(false);
                          setCreateForm(f => ({ ...f, userId: "" }));
                        } else {
                          setExternalForm({ name: "", phone: "" });
                          setExtBundleMode(false);
                          // 패키지 합집합으로 스캔된 필드(NDA·동의서) 잔류 방지
                          if (selectedTemplate) scanFields(selectedTemplate, false);
                        }
                      }} />
                    외부 계약자 (큐브티 미가입 — 링크로 서명)
                  </label>
                  {externalMode && (
                    <div className="pl-6 space-y-2">
                      <div className="space-y-1"><Label className="text-xs">이름 *</Label>
                        <Input placeholder="예: 홍길동" value={externalForm.name}
                          onChange={e => setExternalForm(p => ({ ...p, name: e.target.value }))} /></div>
                      <div className="space-y-1"><Label className="text-xs">연락처 (링크 전달용)</Label>
                        <Input placeholder="예: 010-1234-5678" value={externalForm.phone}
                          onChange={e => setExternalForm(p => ({ ...p, phone: e.target.value }))} /></div>
                      <p className="text-[11px] text-violet-700">
                        발송하면 <b>서명 링크가 바로 표시</b>됩니다 — 복사하거나, 폰에서는 [문자로 보내기]로 전달하세요.
                        <b> 문자가 자동으로 발송되지는 않습니다.</b> 외부 계약자는 가입 없이 링크로 서명합니다.
                        생년월일·주소 등 계약서에 필요한 정보는 아래 입력란에 직접 입력하세요.
                      </p>
                    </div>
                  )}
                </div>

                {!externalMode && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>직원 *</Label>
                    {/* 일괄 발송 — 같은 날짜·조건의 신입 여러 명 (개선 제안 #80). 퇴사·코디 패키지와는 병용 불가 */}
                    {useTemplate && !resignBundleMode && !codiBundleMode && (
                      <label className="flex items-center gap-1.5 text-xs text-indigo-700 cursor-pointer">
                        <input type="checkbox" checked={bulkMode}
                          onChange={ev => { setBulkMode(ev.target.checked); if (!ev.target.checked) setBulkUserIds([]); }} />
                        여러 명에게 동시 발송
                      </label>
                    )}
                  </div>
                  {/* 직원 검색 */}
                  <div className="space-y-2">
                    <Input
                      placeholder="직원명 또는 지점으로 검색..."
                      value={employeeSearchText}
                      onChange={(e) => setEmployeeSearchText(e.target.value)}
                      className="text-sm"
                    />
                    {/* 선택된 직원 표시 */}
                    {bulkMode && bulkUserIds.length > 0 ? (
                      <div className="bg-blue-50 border border-blue-200 rounded p-2 flex flex-wrap gap-1.5">
                        {bulkUserIds.map(uid => {
                          const e = employees.find(x => x.id === uid);
                          return (
                            <span key={uid} className="inline-flex items-center gap-1 text-xs bg-white border border-blue-300 rounded-full px-2 py-0.5 text-blue-700">
                              {e?.name}{e?.branch ? ` [${e.branch}]` : ""}
                              <button type="button" onClick={() => {
                                setBulkUserIds(p => {
                                  const next = p.filter(x => x !== uid);
                                  // 자동 채움 기준 직원이 빠지면 남은 첫 직원으로 갱신 (검증관 2026-08-26)
                                  setCreateForm(f => f.userId === uid ? { ...f, userId: next[0] || "" } : f);
                                  return next;
                                });
                              }} className="text-blue-400 hover:text-blue-700">✕</button>
                            </span>
                          );
                        })}
                        <span className="text-xs text-blue-700 font-medium self-center">총 {bulkUserIds.length}명</span>
                      </div>
                    ) : createForm.userId ? (
                      <div className="bg-blue-50 border border-blue-200 rounded p-2">
                        <p className="text-xs text-blue-700 font-medium">
                          선택됨: {employees.find(e => e.id === createForm.userId)?.name}
                        </p>
                      </div>
                    ) : null}
                    {/* 검색 결과 */}
                    <div className="border rounded bg-white max-h-48 overflow-y-auto">
                      {employees
                        .filter(e => e.role !== "ADMIN") // 계약 대상은 직원만
                        .filter(e =>
                          e.name.toLowerCase().includes(employeeSearchText.toLowerCase()) ||
                          (e.branch && e.branch.toLowerCase().includes(employeeSearchText.toLowerCase())) ||
                          (e.department && e.department.toLowerCase().includes(employeeSearchText.toLowerCase()))
                        )
                        .map(e => (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => {
                              if (bulkMode) {
                                // 일괄: 클릭할 때마다 추가/제거. 첫 선택은 필드 자동 채움용으로 단일 선택에도 반영
                                setBulkUserIds(p => p.includes(e.id) ? p.filter(x => x !== e.id) : [...p, e.id]);
                                setCreateForm(f => ({ ...f, userId: f.userId || e.id }));
                                return;
                              }
                              setCreateForm(f => ({ ...f, userId: e.id }));
                              setEmployeeSearchText("");
                            }}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-b-0 transition ${
                              (bulkMode ? bulkUserIds.includes(e.id) : createForm.userId === e.id) ? "bg-blue-100 font-medium" : ""
                            }`}
                          >
                            <span className="font-medium">{e.name}</span>
                            {e.branch && <span className="text-gray-500"> [{e.branch}]</span>}
                            {e.department && <span className="text-gray-500"> ({e.department})</span>}
                          </button>
                        ))}
                      {employees.filter(e =>
                        e.name.toLowerCase().includes(employeeSearchText.toLowerCase()) ||
                        (e.branch && e.branch.toLowerCase().includes(employeeSearchText.toLowerCase())) ||
                        (e.department && e.department.toLowerCase().includes(employeeSearchText.toLowerCase()))
                      ).length === 0 && employeeSearchText && (
                        <div className="px-3 py-4 text-center text-gray-500 text-sm">
                          검색 결과 없음
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                )}

                {/* 템플릿 사용 여부 */}
                {templates.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="useTemplate"
                      checked={useTemplate}
                      onCheckedChange={(checked) => setUseTemplate(checked as boolean)}
                    />
                    <Label htmlFor="useTemplate" className="font-normal cursor-pointer">템플릿에서 만들기</Label>
                  </div>
                )}

                {/* 템플릿 선택 */}
                {useTemplate && (
                  <div className="space-y-2">
                    <Label>템플릿 선택 *</Label>
                    <Select value={selectedTemplate} onValueChange={(v) => v && handleTemplateSelect(v)}>
                      <SelectTrigger className="w-full">
                        {/* 선택값이 ID로 표시되지 않도록 템플릿 이름을 직접 렌더 */}
                        <SelectValue placeholder="템플릿 선택">
                          {selectedTemplate ? (templates.find(t => t.id === selectedTemplate)?.name ?? "템플릿 선택") : "템플릿 선택"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* 외부 채용 패키지 — 기타직무 계약서 + 비밀유지·개인정보동의서, 링크 하나로 함께 서명 */}
                    {canExtBundle && externalMode && (
                      <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 space-y-1">
                        <label className="flex items-center gap-2 text-sm cursor-pointer font-medium text-violet-800">
                          <input type="checkbox" checked={extBundleMode}
                            onChange={e => {
                              const checked = e.target.checked;
                              setExtBundleMode(checked);
                              if (checked && extTemplate) {
                                // 계약서는 기타직무(학습실장 등) 템플릿으로 자동 선택
                                setSelectedTemplate(extTemplate.id);
                                setCreateForm(f => ({ ...f, type: extTemplate.type }));
                                scanFields(extTemplate.id, true);
                              } else if (selectedTemplate) {
                                scanFields(selectedTemplate, false);
                              }
                            }} />
                          외부 채용 패키지로 함께 발송 (3종)
                        </label>
                        <p className="text-[11px] text-violet-700 pl-6">
                          기타직무 근로계약서(계약직) + 비밀유지서약서 + 개인정보수집이용동의서.
                          외부 계약자는 <b>서명 링크 하나</b>로 3종을 확인하고 한 번에 서명합니다.
                        </p>
                      </div>
                    )}

                    {/* 신규입사 패키지 — 체크하면 근로계약서 자동 선택 + 비밀유지·개인정보동의서 함께 발송
                        (코디 계약서 선택 중에는 숨김 — 코디 채용 패키지 전용) */}
                    {canBundle && !externalMode && !codiBundleMode && !codiTemplates.some(t => t.id === selectedTemplate) && (createForm.type === "EMPLOYMENT" || !selectedTemplate) && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 space-y-1">
                        <label className="flex items-center gap-2 text-sm cursor-pointer font-medium text-emerald-800">
                          <input type="checkbox" checked={bundleMode}
                            onChange={e => {
                              const checked = e.target.checked;
                              setBundleMode(checked);
                              if (checked) { setResignBundleMode(false); setCodiBundleMode(false); }
                              // 패키지 체크 시 대표 문서는 항상 에듀플렉스 근로계약서로 강제 (코디 등 다른 계약서 오염 방지)
                              if (checked && empTemplate) {
                                const et = empTemplate;
                                setSelectedTemplate(et.id);
                                setCreateForm(f => ({ ...f, title: autoContractTitle(f.userId, et.id, true), type: et.type }));
                                scanFields(et.id, true);
                              } else if (!checked && selectedTemplate) {
                                scanFields(selectedTemplate, false);
                              }
                            }} />
                          신규입사 패키지로 함께 발송 (3종)
                        </label>
                        {bundleMode && (
                          <p className="text-[11px] text-emerald-700 pl-6">
                            근로계약서 + <b>{ndaTemplate?.name}</b> + <b>{privacyTemplate?.name}</b>를 한 번에 발송합니다.
                            비밀유지·개인정보동의서는 <b>직원 서명만</b> 받으며 해당 직원에게만 표시됩니다.
                          </p>
                        )}
                      </div>
                    )}

                    {/* 퇴사 패키지 — 체크하면 사직원 자동 선택 + 정산·동의·서약서 5종 함께 발송 */}
                    {canResignBundle && !externalMode && !bundleMode && !codiBundleMode && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3 space-y-1">
                        <label className="flex items-center gap-2 text-sm cursor-pointer font-medium text-rose-800">
                          <input type="checkbox" checked={resignBundleMode}
                            onChange={e => {
                              const checked = e.target.checked;
                              setResignBundleMode(checked);
                              if (checked) { setCodiBundleMode(false); setBulkMode(false); setBulkUserIds([]); } // 일괄과 병용 불가 (검증관 2026-08-26)
                              const sajik = resignTemplates[0];
                              if (checked && sajik) {
                                // 사직원을 대표 문서로 자동 선택 + 5종 필드 합집합 스캔
                                setSelectedTemplate(sajik.id);
                                setCreateForm(f => ({ ...f, title: autoContractTitle(f.userId, sajik.id, false, true), type: sajik.type }));
                                scanFields(sajik.id, false, true);
                              } else if (selectedTemplate) {
                                scanFields(selectedTemplate, false, false);
                              }
                            }} />
                          퇴사 패키지로 함께 발송 (5종)
                        </label>
                        {resignBundleMode && (
                          <p className="text-[11px] text-rose-700 pl-6">
                            사직원 + 금품청산 동의서 + 퇴직금·연차수당 정산 신청서 + 비밀유지서약서(퇴직시)를 한 번에 발송합니다.
                            <b>5종 모두</b> 설정한 결재라인(원장·본부 등)으로 함께 진행됩니다.
                          </p>
                        )}
                      </div>
                    )}

                    {/* 코디 채용 패키지 — 코디 계약서(4종 중 선택) + 비밀유지·개인정보동의서 */}
                    {canCodiBundle && !externalMode && !bundleMode && !resignBundleMode && (
                      <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 space-y-2">
                        <label className="flex items-center gap-2 text-sm cursor-pointer font-medium text-sky-800">
                          <input type="checkbox" checked={codiBundleMode}
                            onChange={e => {
                              const checked = e.target.checked;
                              setCodiBundleMode(checked);
                              if (checked) { setBulkMode(false); setBulkUserIds([]); } // 일괄과 병용 불가 (검증관 2026-08-26)
                              if (checked) {
                                // 코디 계약서가 하나뿐이면 자동 선택
                                if (codiTemplates.length === 1) {
                                  const ct = codiTemplates[0];
                                  setSelectedTemplate(ct.id);
                                  setCreateForm(f => ({ ...f, title: autoContractTitle(f.userId, ct.id), type: ct.type }));
                                  scanFields(ct.id, true);
                                } else if (!codiTemplates.some(t => t.id === selectedTemplate)) {
                                  setSelectedTemplate("");
                                }
                              } else if (selectedTemplate) {
                                scanFields(selectedTemplate, false);
                              }
                            }} />
                          코디 채용 패키지로 함께 발송 (3종)
                        </label>
                        {codiBundleMode && (
                          <div className="pl-6 space-y-2">
                            <p className="text-xs font-medium text-sky-800">근무 구분 (코디 계약서 선택)</p>
                            <div className="space-y-1">
                              {codiTemplates.map(ct => (
                                <label key={ct.id} className="flex items-center gap-2 text-sm cursor-pointer">
                                  <input type="radio" name="codiTemplate" checked={selectedTemplate === ct.id}
                                    onChange={() => {
                                      setSelectedTemplate(ct.id);
                                      setCreateForm(f => ({ ...f, title: autoContractTitle(f.userId, ct.id), type: ct.type }));
                                      scanFields(ct.id, true);
                                    }} />
                                  {ct.name}
                                </label>
                              ))}
                            </div>
                            <p className="text-[11px] text-sky-700">
                              선택한 코디 계약서 + <b>{ndaTemplate?.name}</b> + <b>{privacyTemplate?.name}</b>를 한 번에 발송합니다.
                              비밀유지·개인정보동의서는 <b>직원 서명만</b>, 계약서는 발송 시 결재라인을 직접 선택합니다 (통상 <b>1단계 본부 → 2단계 원장 → 3단계 근로자</b>).
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 직접 파일 업로드 */}
                {!useTemplate && (
                  <div className="space-y-2">
                    <Label>파일 * (최대 5개)</Label>
                    <div className="flex gap-2">
                      <Input
                        type="file"
                        accept=".pdf"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file && files.length < 5) {
                            setFiles([...files, file]);
                            e.target.value = ""; // 같은 파일 다시 선택 가능하게 초기화
                          } else if (file && files.length >= 5) {
                            toast.error("최대 5개까지 첨부할 수 있습니다.");
                          }
                        }}
                        disabled={uploading || files.length >= 5}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          if (files.length < 5) {
                            document.getElementById("file-input")?.click();
                          }
                        }}
                        disabled={uploading || files.length >= 5}
                      >
                        추가 ({files.length}/5)
                      </Button>
                    </div>

                    {/* 파일 목록 */}
                    {files.length > 0 && (
                      <div className="mt-2 space-y-1 border rounded p-2 bg-gray-50">
                        {files.map((f, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm bg-white p-2 rounded border">
                            <span className="text-gray-700">{f.name}</span>
                            <button
                              type="button"
                              onClick={() => setFiles(files.filter((_, i) => i !== idx))}
                              className="text-red-500 hover:text-red-700 font-semibold"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>제목 *</Label>
                  <Input value={createForm.title} onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))} required />
                </div>
                {/* 유형은 문서 분류·목록 필터용 — 템플릿 선택 시 자동 지정되므로 직접 고를 필요 없음 (#112) */}
                {useTemplate && selectedTemplate ? (
                  <p className="text-xs text-gray-400">유형: {typeLabel[createForm.type] || createForm.type} (템플릿에 따라 자동 지정)</p>
                ) : (
                <div className="space-y-2">
                  <Label>유형</Label>
                  <Select value={createForm.type} onValueChange={v => v && setCreateForm(f => ({ ...f, type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(typeLabel).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                )}

                {(!useTemplate || templateFields.includes("계약시작일") || templateFields.includes("계약종료일")) && (
                <div className="space-y-2">
                  <Label>계약 기간 *</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-gray-600">시작일</label>
                      <Input
                        type="date"
                        value={createForm.startDate}
                        onChange={e => {
                          const v = e.target.value;
                          setCreateForm(f => {
                            // 종료일 자동 채움 — 직영 계약 주기(분기)에 맞춘다
                            // QA 확정 규칙(2026-08-24, 이예지대리): 시작일이 언제든
                            // "다음 해"의 해당 분기 말일. 예) 26-07-01 시작 → 27-09-30
                            // Date 객체를 쓰지 않고 문자열 계산 — 시간대에 따른 하루 밀림 방지
                            // 종료일이 비었거나 "직전 자동값 그대로"면 재계산해 덮는다 —
                            // 시작일을 정정했는데 낡은 자동 종료일이 남는 사고 방지(검증관 지적).
                            // 사용자가 직접 고친 종료일은 건드리지 않는다.
                            let end = f.endDate;
                            if (v && (!f.endDate || f.endDate === lastAutoEnd.current)) {
                              const [y, m] = v.split("-").map(Number);
                              // date input 타이핑 중 "0002-.." 같은 중간값이 오면 자동 채움 보류
                              if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
                                const QEND = ["03-31", "06-30", "09-30", "12-31"];
                                end = `${y + 1}-${QEND[Math.floor((m - 1) / 3)]}`;
                                lastAutoEnd.current = end;
                              }
                            }
                            return { ...f, startDate: v, endDate: end };
                          });
                        }}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-600">종료일 <span className="text-gray-400">(자동: 다음 해의 분기 말일)</span></label>
                      <Input
                        type="date"
                        value={createForm.endDate}
                        onChange={e => setCreateForm(f => ({ ...f, endDate: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                  {createForm.startDate && createForm.endDate && (
                    <p className="text-xs text-gray-500 mt-1">
                      {createForm.startDate} ~ {createForm.endDate}
                    </p>
                  )}
                </div>
                )}

                {(!useTemplate || templateFields.some(f => ["연봉", "연봉한글", "연봉총액", "월급여합계", "기본급", "연봉숫자"].includes(f))) && (
                <div className="space-y-2">
                  <Label>연봉 <span className="text-xs text-gray-400 font-normal">(급여표 기본급·월합계·연봉총액이 자동 계산됩니다)</span></Label>
                  <Input
                    type="number"
                    placeholder="예: 36000000"
                    value={createForm.salary}
                    onChange={e => setCreateForm(f => ({ ...f, salary: e.target.value }))}
                  />
                  {createForm.salary && (
                    <p className="text-xs text-gray-500">{Number(createForm.salary).toLocaleString()}원</p>
                  )}
                </div>
                )}

                {/* 계약 구분 — 템플릿에 {#신규입사}/{#재계약} 조건 구간이 있을 때만 표시 */}
                {useTemplate && templateConditions.includes("신규입사") && (
                  <div className="space-y-1">
                    <Label>계약 구분</Label>
                    <div className="flex gap-4 text-sm">
                      {["신규입사", "재계약"].map(k => (
                        <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                          <input type="radio" checked={contractKind === k} onChange={() => setContractKind(k)} />
                          {k === "재계약" ? "재계약 (기존 근로자)" : "신규입사"}
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-400">재계약을 선택하면 수습기간 조항이 &quot;해당없음&quot;으로 처리되고 관련 입력란이 숨겨집니다.</p>
                  </div>
                )}

                {/* 자동 채움(직원 정보) — 선택 직원의 값이 문서에 자동 입력됨 */}
                {useTemplate && createForm.userId && (() => {
                  const emp = employees.find(e => e.id === createForm.userId);
                  if (!emp) return null;
                  const autoRows = [
                    { field: "직원명", label: "성명", val: emp.name || "" },
                    { field: "지점", label: "소속 지점", val: emp.branch || "" },
                    { field: "직급", label: "직급", val: emp.position || "" },
                    { field: "사원번호", label: "사번", val: emp.empNo != null ? String(emp.empNo).padStart(5, "0") : "" },
                    { field: "입사일", label: "입사일자", val: emp.hireDate ? String(emp.hireDate).slice(0, 10) : "" },
                    { field: "연락처", label: "연락처", val: emp.phone || "" },
                    // 프로필 자동 필드(비밀유지서약서 등) — 없으면 직원이 서명 시 입력해 프로필에 저장됨
                    { field: "생년월일", label: "생년월일", val: emp.birthDate ? String(emp.birthDate).slice(0, 10) : "", profileFallback: true },
                  ].filter(r => templateFields.includes(r.field));
                  if (autoRows.length === 0) return null;
                  return (
                    <div className="space-y-2 border rounded-lg p-3 bg-gray-50">
                      <p className="text-xs font-semibold text-gray-600">자동 채움 <span className="font-normal text-gray-400">(직원 정보 · 수정 불가)</span></p>
                      <div className="grid grid-cols-2 gap-2">
                        {autoRows.map(r => (
                          <div key={r.field} className="text-sm">
                            <span className="text-gray-500 text-xs">{r.label}</span>
                            <p className={r.val ? "font-medium" : "text-amber-600 text-xs"}>
                              {r.val || ((r as { profileFallback?: boolean }).profileFallback ? "정보 없음 → 직원이 서명 시 입력" : "직원 정보에 없음")}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* 템플릿별 추가 입력 필드 — 템플릿 워드 파일의 {필드}를 스캔해 자동 구성.
                    외부 채용 패키지는 서약서·동의서용 필드(생년월일·주소·원장명)를 별도 구역으로 분리해
                    폰 화면에서도 놓치지 않게 표시 */}
                {(() => {
                  // 선택_ 필드 = 여럿 중 하나만 고르는 항목(임신기 신청구분 등). 기본은 전부 해제.
                  // 체크_ 는 여러 개를 함께 고르는 항목이라 기본 체크 — 둘은 성격이 달라 나눠 둔다.
                  // (한 템플릿에 선택 그룹이 둘 이상 필요해지면 선택_<그룹>_<옵션> 으로 확장할 것)
                  const pickFields = dynamicFields.filter(f => f.startsWith("선택_"));
                  const pickOne = (chosen: string) =>
                    setExtraFields(prev => {
                      const next = { ...prev };
                      for (const f of pickFields) next[f] = f === chosen ? "☑" : "□";
                      return next;
                    });

                  // 필드가 어느 문서 어느 자리에 들어가는지 표시 (#113, 2026-08-27)
                  const FIELD_DOC_HINT: Record<string, string> = {
                    "지급희망일": "퇴직금·연차수당 정산 신청서",
                    "금품청산 지급희망일": "금품청산 지급기일연장 동의서",
                    "지급기타내용": "금품청산 동의서 — '기타' 체크 시 괄호 안",
                    "퇴사일자": "사직원·금품청산·퇴직금 (공통)",
                    "미소진연차일수": "연차수당 정산 신청서",
                    "근무시작일": "연차수당 정산 신청서", "근무종료일": "연차수당 정산 신청서",
                    "연차시작일": "연차수당 정산 신청서", "연차종료일": "연차수당 정산 신청서",
                    "교육평가시작": "근로계약서 제3조·제8조", "교육평가종료": "근로계약서 제3조·제8조",
                    "실무평가시작": "근로계약서 제3조·제8조", "실무평가종료": "근로계약서 제3조·제8조",
                    "실무지급률": "근로계약서 제8조 ⑤항 — 튜터 출신은 100",
                  };
                  const docHint = (f: string) => {
                    const hint = FIELD_DOC_HINT[f] || fieldDocs[f];
                    // 회색 10px 는 사실상 안 보인다는 지적 (#142) — 진하게.
                    // 라벨(flex)은 flex-wrap 이라 한 줄에 안 들어가면 라벨 아래 줄로 내려간다
                    return hint ? <span className="text-[11px] text-indigo-500 font-normal">→ {hint}</span> : null;
                  };
                  const renderDynField = (f: string, required = false) => (
                    f.startsWith("선택_") ? null : // 선택_ 은 아래에서 그룹으로 한 번에 그린다
                    f === "실무지급률" ? (
                      // 실무평가 단계 급여 지급률 — 85% 기본, 튜터 출신 100% (#92)
                      <div key={f} className="space-y-1">
                        <Label className="text-sm flex-wrap gap-x-1.5 gap-y-0.5 leading-tight">실무평가 급여 지급률{docHint(f)}</Label>
                        <div className="flex gap-3 text-sm">
                          {["85", "100"].map(v => (
                            <label key={v} className="flex items-center gap-1 cursor-pointer">
                              <input type="radio" checked={(extraFields[f] || "85") === v}
                                onChange={() => setExtraFields(prev => ({ ...prev, [f]: v }))} />
                              {v}%
                            </label>
                          ))}
                        </div>
                      </div>
                    ) :
                    f === "지급기타내용" ? (
                      // '기타' 체크 시에만 입력 (#114)
                      <div key={f} className="space-y-1">
                        <Label className="text-sm flex-wrap gap-x-1.5 gap-y-0.5 leading-tight">{f}{docHint(f)}</Label>
                        <Input value={extraFields[f] || ""} disabled={extraFields["체크_기타"] !== "☑"}
                          placeholder={extraFields["체크_기타"] === "☑" ? "기타 금품 내용 입력" : "'기타' 체크 시에만 입력 — 특이사항 없으면 미기재"}
                          onChange={e => setExtraFields(prev => ({ ...prev, [f]: e.target.value }))} />
                      </div>
                    ) :
                    f.startsWith("체크_") ? (
                      // 체크박스 필드(지급금품 임금·퇴직금 등) — 기본 체크. 단 "기타"류는 기본 해제
                      <label key={f} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={extraFields[f] ? extraFields[f] !== "□" : !f.includes("기타")}
                          onChange={e => setExtraFields(prev => ({ ...prev, [f]: e.target.checked ? "☑" : "□" }))} />
                        {f.slice(3)}
                      </label>
                    ) : isMoneyField(f) ? (
                    // 금액 필드 — 숫자만 입력받아 천 단위 쉼표 자동 표시
                    <div key={f} className="space-y-1">
                      <Label className="text-sm flex-wrap gap-x-1.5 gap-y-0.5 leading-tight">{f}{required && " *"}{docHint(f)}</Label>
                      <Input
                        type="text" inputMode="numeric" placeholder="예: 2,100,000"
                        value={extraFields[f] || ""}
                        onChange={e => {
                          const digits = e.target.value.replace(/[^\d]/g, "");
                          setExtraFields(prev => ({ ...prev, [f]: digits ? Number(digits).toLocaleString() : "" }));
                        }}
                      />
                    </div>
                    ) : (
                    /* 요일 7칸이 들어가는 주근무시간은 2열 그리드에서 전체폭 유지 (#143) */
                    <div key={f} className={`space-y-1${f === "주근무시간" ? " md:col-span-2" : ""}`}>
                      <Label className="text-sm flex-wrap gap-x-1.5 gap-y-0.5 leading-tight">{f}{required && " *"}{docHint(f)}</Label>
                      {f === "주근무시간" && (
                        <div className="border rounded-md p-2 bg-gray-50/60 space-y-1">
                          <p className="text-[11px] text-gray-500">요일별 근무시간(숫자)을 넣으면 자동 합산됩니다 — 쉬는 요일은 비워두세요</p>
                          <div className="grid grid-cols-7 gap-1">
                            {["월", "화", "수", "목", "금", "토", "일"].map((d, i) => (
                              <div key={d} className="text-center">
                                <div className="text-[10px] text-gray-500">{d}</div>
                                <Input
                                  className="h-7 px-1 text-center text-xs"
                                  inputMode="decimal"
                                  value={dayHours[i]}
                                  onChange={e => {
                                    const v = e.target.value;
                                    const n = [...dayHours]; n[i] = v;
                                    setDayHours(n);
                                    const sum = n.reduce((a, x) => a + (parseFloat(x) || 0), 0);
                                    const hadAny = dayHours.some(x => (parseFloat(x) || 0) > 0);
                                    if (sum > 0) {
                                      const val = Number.isInteger(sum) ? String(sum) : String(Math.round(sum * 100) / 100);
                                      setExtraFields(p => ({ ...p, 주근무시간: val }));
                                    } else if (hadAny) {
                                      // 요일칸을 전부 지우면 합산했던 주근무시간도 비운다 (옛 값 잔존 방지)
                                      setExtraFields(p => ({ ...p, 주근무시간: "" }));
                                    }
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <Input
                        type={isTimeField(f) ? "time" : isDateField(f) ? "date" : "text"}
                        value={extraFields[f] || ""}
                        onChange={e => setExtraFields(prev => ({ ...prev, [f]: e.target.value }))}
                      />
                    </div>
                    )
                  );
                  // 외부 패키지: 비밀유지서약서·개인정보동의서에 들어가는 필드는 별도 구역
                  const splitNda = externalMode && extBundleMode;
                  const NDA_DOC_FIELDS = ["생년월일", "주소", "원장명"];
                  const mainFields = splitNda ? dynamicFields.filter(f => !NDA_DOC_FIELDS.includes(f)) : dynamicFields;
                  const ndaFields = splitNda ? dynamicFields.filter(f => NDA_DOC_FIELDS.includes(f)) : [];
                  return (
                    <>
                      {mainFields.length > 0 && (
                        <div className="space-y-3 border rounded-lg p-3 bg-indigo-50/40">
                          <p className="text-xs font-semibold text-indigo-700">{splitNda ? "계약서 입력 필드" : "이 템플릿의 추가 입력 필드"}</p>
                          {pickFields.length > 0 && (
                            <div className="space-y-1.5">
                              <Label className="text-sm">
                                {pickFields.some(pf => pf.includes("본인수령") || pf.includes("IRP")) ? "퇴직금 수령 방법" : pickFields[0].split("_")[1] && pickFields.length > 1 ? "해당 항목 선택" : "선택"} *
                              </Label>
                              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                {pickFields.map(f => (
                                  <label key={f} className="flex items-center gap-1.5 text-sm cursor-pointer">
                                    <input
                                      type="radio"
                                      name="dyn-pick"
                                      checked={extraFields[f] === "☑"}
                                      onChange={() => pickOne(f)}
                                    />
                                    {f.slice(3)}
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* 데스크톱 2열 (#143) */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {mainFields.map(f => renderDynField(f))}
                          </div>
                        </div>
                      )}
                      {ndaFields.length > 0 && (
                        <div className="space-y-3 border border-violet-200 rounded-lg p-3 bg-violet-50/40">
                          <p className="text-xs font-semibold text-violet-700">비밀유지서약서 · 개인정보동의서 입력 (필수)</p>
                          <p className="text-[11px] text-violet-600">서약서 본문의 성명 줄(생년월일)과 주소, 수신인(원장명)에 들어갑니다.</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {ndaFields.map(f => renderDynField(f, true))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}

                <div className="flex gap-2 justify-end">
                  {/* 발송 전 입력값이 치환된 실물(PDF) 확인 (개선 제안 #76) */}
                  {useTemplate && selectedTemplate && (
                    <Button type="button" variant="outline" disabled={previewing} className="mr-auto gap-1"
                      onClick={async () => {
                        if (!externalMode && !createForm.userId && !bulkUserIds.length) { toast.error("직원을 먼저 선택해주세요."); return; }
                        setPreviewing(true);
                        try {
                          const allExtra: Record<string, string> = {};
                          for (const [k, v] of Object.entries(extraFields)) {
                            if (fieldConditions[k] && fieldConditions[k] !== contractKind) continue;
                            allExtra[k] = v;
                          }
                          for (const f of templateFields) if (f.startsWith("체크_") && !(f in allExtra)) allExtra[f] = f.includes("기타") ? "□" : "☑";
                          for (const f of templateFields) if (f.startsWith("선택_") && !(f in allExtra)) allExtra[f] = "□";
                          if (templateConditions.includes("신규입사")) allExtra["계약구분"] = contractKind;
                          // 패키지 모드면 포함 문서 전체를 한 PDF 로 이어 미리보기 (#117)
                          const pkgIds =
                            resignBundleMode && resignTemplates.every(Boolean) ? resignTemplates.map(t => t!.id)
                            : (bundleMode || extBundleMode || codiBundleMode) && ndaTemplate && privacyTemplate ? [selectedTemplate, ndaTemplate.id, privacyTemplate.id]
                            : [selectedTemplate];
                          const res = await fetch("/api/contracts/preview", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              items: pkgIds.map(tid => ({ templateId: tid })),
                              userId: externalMode ? undefined : (createForm.userId || bulkUserIds[0]),
                              externalName: externalMode ? externalForm.name.trim() : undefined,
                              externalPhone: externalMode ? externalForm.phone.trim() : undefined,
                              title: createForm.title, startDate: createForm.startDate, endDate: createForm.endDate,
                              salary: createForm.salary, extraFields: allExtra,
                              highlight: true, // 입력값 노랑·미입력 붉은 표시 (#100)
                            }),
                          });
                          if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || "미리보기 실패"); return; }
                          const blob = await res.blob();
                          const w = window.open(URL.createObjectURL(blob), "_blank");
                          if (!w) toast.error("팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도해주세요.");
                        } finally { setPreviewing(false); }
                      }}>
                      <Eye size={14} />{previewing ? "생성 중..." : "미리보기"}
                    </Button>
                  )}
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>취소</Button>
                  <Button type="submit" disabled={uploading}>{uploading ? "업로드" : "작성"}</Button>
                </div>
              </form>
            </DialogContent>
            </Dialog>

            {/* 템플릿 리스트 Dialog */}
            <Dialog open={showTemplatesList} onOpenChange={setShowTemplatesList}>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>저장된 계약서 템플릿 ({templates.length})</DialogTitle>
                </DialogHeader>

                {templates.length === 0 ? (
                  <div className="py-8 text-center text-gray-500">
                    <FileSignature size={32} className="mx-auto mb-2 text-gray-300" />
                    <p>저장된 템플릿이 없습니다.</p>
                    <p className="text-sm mt-1">"새 템플릿 저장"에서 첫 템플릿을 만들어보세요.</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {templates.map(template => (
                      <div
                        key={template.id}
                        className="border rounded-lg p-4 hover:bg-gray-50 transition"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <h3 className="font-semibold text-sm">{template.name}</h3>
                            {template.description && (
                              <p className="text-xs text-gray-600 mt-1">{template.description}</p>
                            )}
                            <div className="flex items-center gap-3 mt-2">
                              <Badge variant="outline" className="text-xs">
                                {typeLabel[template.type as keyof typeof typeLabel] || template.type}
                              </Badge>
                              <span className="text-xs text-gray-500">
                                작성: {template.createdByUser?.name || "알 수 없음"}
                              </span>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPreviewTemplate(template)}
                            >
                              확인
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setCreateForm(f => ({
                                  ...f,
                                  title: template.name,
                                  type: template.type
                                }));
                                setSelectedTemplate(template.id);
                                setUseTemplate(true);
                                setCreateOpen(true);
                                setShowTemplatesList(false);
                              }}
                            >
                              사용
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={deletingTemplateId === template.id}
                              onClick={() => handleDeleteTemplate(template.id)}
                            >
                              {deletingTemplateId === template.id ? "삭제 중..." : "삭제"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 justify-end mt-4">
                  <Button
                    variant="outline"
                    onClick={() => setShowTemplatesList(false)}
                  >
                    닫기
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* PDF 미리보기 Dialog */}
            {previewTemplate && (
              <Dialog open={!!previewTemplate} onOpenChange={(open) => {
                if (!open) setPreviewTemplate(null);
              }}>
                <DialogContent className="max-w-4xl h-screen max-h-[90vh] flex flex-col">
                  <DialogHeader>
                    <DialogTitle className="text-lg">
                      {previewTemplate.name}
                      <span className="text-sm text-gray-500 font-normal block mt-1">
                        {previewTemplate.description && `${previewTemplate.description}`}
                      </span>
                    </DialogTitle>
                  </DialogHeader>

                  <div className="flex-1 overflow-hidden border rounded">
                    {previewTemplate.fileUrl.toLowerCase().endsWith(".docx") ? (
                      <div className="w-full h-full flex flex-col items-center justify-center text-center p-8 text-gray-600">
                        <p className="text-4xl mb-3">📄</p>
                        <p className="font-medium">워드(.docx) 템플릿은 브라우저 미리보기를 지원하지 않습니다.</p>
                        <p className="text-sm text-gray-400 mt-1">아래 다운로드 버튼으로 파일을 확인해주세요.</p>
                      </div>
                    ) : (
                      <iframe
                        src={`${previewTemplate.fileUrl}#toolbar=0&navpanes=0`}
                        className="w-full h-full"
                        title={previewTemplate.name}
                      />
                    )}
                  </div>

                  <div className="flex gap-2 justify-end mt-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        // 새 탭에서 PDF 다운로드
                        window.open(previewTemplate.fileUrl, '_blank');
                      }}
                    >
                      다운로드
                    </Button>
                    <Button
                      onClick={() => {
                        setCreateForm(f => ({
                          ...f,
                          title: previewTemplate.name,
                          type: previewTemplate.type
                        }));
                        setSelectedTemplate(previewTemplate.id);
                        setUseTemplate(true);
                        setCreateOpen(true);
                        setPreviewTemplate(null);
                        setShowTemplatesList(false);
                      }}
                    >
                      이 템플릿 사용
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setPreviewTemplate(null)}
                    >
                      닫기
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </>
        )}
      </div>

      {/* 계약서 수정 (DRAFT 상태) */}
      {editingContract && (
        <Dialog open={editOpen} onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            setEditingContract(null);
            setEditForm({ title: "", type: "", startDate: "", endDate: "", salary: "" }); setEditExtraFields({});
            setEditFile(null);
          }
        }}>
          <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>계약서 수정</DialogTitle></DialogHeader>
            <form onSubmit={handleEditContract} className="space-y-4">
              <div className="space-y-2">
                <Label>파일 (선택사항)</Label>
                <div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-gray-50"
                  onClick={() => document.getElementById("editFileInput")?.click()}>
                  <input
                    id="editFileInput"
                    type="file"
                    onChange={(e) => setEditFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  <p className="text-xs text-gray-500">
                    {editFile ? editFile.name : "클릭하여 파일 선택 또는 드래그"}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    현재 파일: {editingContract.fileUrl ? JSON.parse(editingContract.fileUrl)[0]?.split("/").pop() : "없음"}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>제목 *</Label>
                <Input
                  type="text"
                  value={editForm.title}
                  onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>유형</Label>
                <Select value={editForm.type} onValueChange={v => v && setEditForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(typeLabel).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>계약 기간</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-600">시작일</label>
                    <Input
                      type="date"
                      value={editForm.startDate}
                      onChange={e => setEditForm(f => ({ ...f, startDate: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-600">종료일</label>
                    <Input
                      type="date"
                      value={editForm.endDate}
                      onChange={e => setEditForm(f => ({ ...f, endDate: e.target.value }))}
                    />
                  </div>
                </div>
                {editForm.startDate && editForm.endDate && (
                  <p className="text-xs text-gray-500 mt-1">
                    {editForm.startDate} ~ {editForm.endDate}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>연봉 <span className="text-xs text-gray-400 font-normal">(워드 템플릿의 {"{연봉}"} 필드)</span></Label>
                <Input
                  type="number"
                  placeholder="예: 36000000"
                  value={editForm.salary}
                  onChange={e => setEditForm(f => ({ ...f, salary: e.target.value }))}
                />
                {editForm.salary && (
                  <p className="text-xs text-gray-500">{Number(editForm.salary).toLocaleString()}원</p>
                )}
              </div>

              {/* 작성 시 입력한 템플릿 동적 필드 — 수정하면 계약서 문서도 새 값으로 다시 생성됨 */}
              {Object.keys(editExtraFields).length > 0 && (
                <div className="space-y-3 border rounded-lg p-3 bg-indigo-50/40">
                  <p className="text-xs font-semibold text-indigo-700">이 템플릿의 추가 입력 필드</p>
                  {Object.entries(editExtraFields).map(([k, v]) => (
                    <div key={k} className="space-y-1">
                      <Label className="text-sm">{k}</Label>
                      {k === "계약구분" ? (
                        <div className="flex gap-4 text-sm">
                          {["신규입사", "재계약"].map(kind => (
                            <label key={kind} className="flex items-center gap-1.5 cursor-pointer">
                              <input type="radio" checked={v === kind} onChange={() => setEditExtraFields(prev => ({ ...prev, 계약구분: kind }))} />
                              {kind === "재계약" ? "재계약 (기존 근로자)" : "신규입사"}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <Input
                          type={isDateField(k) ? "date" : "text"}
                          value={v}
                          onChange={e => setEditExtraFields(prev => ({ ...prev, [k]: e.target.value }))}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
                <Button type="submit" disabled={editUploading}>{editUploading ? "저장 중..." : "저장"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* 내 승인 대기 */}
      {role !== "EMPLOYEE" && myApprovals.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-base text-orange-700">내 승인 대기 ({myApprovals.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {myApprovals.map(c => (
              <div key={c.id} className="flex items-center justify-between bg-white rounded-lg p-3 border border-orange-200">
                <div>
                  <p className="font-medium text-sm">{c.title}</p>
                  <p className="text-xs text-gray-500">{c.externalName ? `[외부] ${c.externalName}` : c.user.name} · {typeLabel[c.type]}</p>
                </div>
                <Button size="sm" onClick={() => { setSignTarget(c); sigRef.current?.clear(); setDrawNewSig(false); setSignZoom(1); setSignOpen(true); }} className="gap-1">
                  <PenLine size={14} />승인
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 직원 서명 대기 */}
      {role === "EMPLOYEE" && contracts.filter(c => c.status === "SENT").length > 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-base text-blue-700">내 서명 대기</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {contracts.filter(c => c.status === "SENT").map(c => (
              <div key={c.id} className="flex items-center justify-between bg-white rounded-lg p-3 border border-blue-200">
                <div>
                  <p className="font-medium text-sm">{c.title}</p>
                  <ApprovalChain steps={c.approvalLine?.steps} userId={c.externalName ? undefined : c.userId} />
                </div>
                <div className="flex gap-2">
                  <a href={`/api/docs/pdf?src=${encodeURIComponent(getFileUrl(c.fileUrl))}&title=${encodeURIComponent(c.title)}&download=1`} target="_blank" rel="noreferrer" title="PDF로 내려받기">
                    <Button size="sm" variant="outline"><Download size={14} /></Button>
                  </a>
                  <Button size="sm" onClick={() => { setSignTarget(c); sigRef.current?.clear(); setDrawNewSig(false); setSignZoom(1); setSignOpen(true); }} className="gap-1">
                    <PenLine size={14} />서명
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 전체 목록 */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileSignature size={18} />계약서 목록</CardTitle></CardHeader>
        <CardContent>
          {/* 필터 */}
          {/* 값이 잘리지 않도록 12칸 기준으로 폭 재배분 (#141) — 문서종류·지점·직원은 넓게 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-3 mb-4 pb-4 border-b">
            {/* 연도 */}
            <div className="space-y-1 md:col-span-2 min-w-0">
              <Label className="text-xs font-medium">연도</Label>
              <Select value={filterYear} onValueChange={(v) => { setFilterYear(v); setFilterMonth(""); }}>
                <SelectTrigger className="h-8 text-xs w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {[2026, 2025, 2024, 2023, 2022, 2021, 2020].map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}년</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 월 */}
            <div className="space-y-1 md:col-span-2 min-w-0">
              <Label className="text-xs font-medium">월</Label>
              <Select value={filterMonth} onValueChange={setFilterMonth} disabled={!filterYear}>
                <SelectTrigger className="h-8 text-xs w-full">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  <SelectItem value="">전체</SelectItem>
                  {Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0')).map(month => (
                    <SelectItem key={month} value={month}>{month}월</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 상태 */}
            <div className="space-y-1 md:col-span-3 min-w-0">
              <Label className="text-xs font-medium">상태</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-xs w-full">
                  {/* items 를 Root 에 넘기지 않으면 라벨이 아니라 코드값(DRAFT 등)이 그대로 보인다 */}
                  <SelectValue placeholder="전체">
                    {FILTER_STATUS_LABEL[filterStatus] || "전체"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-80 min-w-[200px]">
                  <SelectItem value="">전체</SelectItem>
                  <SelectItem value="DRAFT">초안</SelectItem>
                  <SelectItem value="SENT">직원 서명 대기</SelectItem>
                  <SelectItem value="APPROVED">결재 중</SelectItem>
                  <SelectItem value="SIGNED">완료</SelectItem>
                  <SelectItem value="EXPIRED">만료</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 지점 (ADMIN/MANAGER만) — 계약 당사자의 소속 지점으로 조회 */}
            {role !== "EMPLOYEE" && (
              <div className="space-y-1 md:col-span-5 min-w-0">
                <Label className="text-xs font-medium">지점</Label>
                <Select value={filterBranch} onValueChange={(v) => { setFilterBranch(v); setFilterUserId(""); }}>
                  <SelectTrigger className="h-8 text-xs w-full min-w-[180px]">
                    <SelectValue placeholder="전체" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80 min-w-[280px]">
                    <SelectItem value="">전체</SelectItem>
                    {[...new Set(employees.map(e => e.branch).filter(Boolean))].sort().map(b => (
                      <SelectItem key={b as string} value={b as string} title={b as string}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 직원 (ADMIN/MANAGER만) */}
            {role !== "EMPLOYEE" && (
              <div className="space-y-1 md:col-span-4 min-w-0">
                <Label className="text-xs font-medium">직원</Label>
                <Select value={filterUserId} onValueChange={setFilterUserId}>
                  <SelectTrigger className="h-8 text-xs w-full min-w-[180px]">
                    {/* 선택값이 ID로 표시되지 않도록 이름을 직접 렌더 */}
                    <SelectValue placeholder="전체">
                      {filterUserId ? (employees.find(e => e.id === filterUserId)?.name ?? "전체") : "전체"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-80 min-w-[280px]">
                    <SelectItem value="">전체</SelectItem>
                    {employees.filter(emp => !filterBranch || emp.branch === filterBranch).map(emp => (
                      <SelectItem key={emp.id} value={emp.id} title={`${emp.branch ? `[${emp.branch}] ` : ''}${emp.name}`}>
                        {emp.branch ? `[${emp.branch}] ` : ''}{emp.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 문서 종류 (#135) */}
            {role !== "EMPLOYEE" && (
              <div className="space-y-1 md:col-span-6 min-w-0">
                <Label className="text-xs font-medium">문서 종류</Label>
                <Select value={filterTemplateId} onValueChange={setFilterTemplateId}>
                  <SelectTrigger className="h-8 text-xs w-full min-w-[180px]">
                    <SelectValue placeholder="전체">
                      {filterTemplateId ? (templates.find(t => t.id === filterTemplateId)?.name ?? "전체") : "전체"}
                    </SelectValue>
                  </SelectTrigger>
                  {/* 성격별 4그룹으로 묶어 표시 (#168) */}
                  <SelectContent className="max-h-80 min-w-[320px]">
                    <SelectItem value="">전체</SelectItem>
                    {DOC_GROUPS.map(g => {
                      const list = templates.filter(t => docGroupOf(t.name) === g);
                      if (list.length === 0) return null;
                      return (
                        <SelectGroup key={g}>
                          <SelectLabel className="mt-1 border-t pt-1.5 text-[11px] font-semibold text-gray-500">{g}</SelectLabel>
                          {list.map(t => (
                            <SelectItem key={t.id} value={t.id} title={t.name}>{t.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}
            {/* 패키지 여부 (#135) */}
            {role !== "EMPLOYEE" && (
              <div className="space-y-1 md:col-span-2 min-w-0">
                <Label className="text-xs font-medium">패키지</Label>
                <Select value={filterPkg} onValueChange={setFilterPkg}>
                  <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="전체" /></SelectTrigger>
                  <SelectContent className="max-h-80 min-w-[160px]">
                    <SelectItem value="">전체</SelectItem>
                    <SelectItem value="bundle">패키지(묶음)만</SelectItem>
                    <SelectItem value="single">단건만</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 검색 */}
            <div className="space-y-1 sm:col-span-2 md:col-span-12 min-w-0">
              <Label className="text-xs font-medium">검색</Label>
              <Input
                type="text"
                placeholder="제목 검색"
                value={filterSearchText}
                onChange={(e) => setFilterSearchText(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* 숨겨진 결재 포함 */}
          <div className="flex items-center gap-2 mb-4 pb-3 border-b">
            <Checkbox
              id="showHiddenRevoked"
              checked={showHiddenRevoked}
              onCheckedChange={(checked) => setShowHiddenRevoked(checked as boolean)}
            />
            <Label htmlFor="showHiddenRevoked" className="text-xs cursor-pointer">
              숨겨진 결재 포함
            </Label>
          </div>

          {/* 버튼 */}
          <div className="flex gap-2 mb-4">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFilterYear(new Date().getFullYear().toString());
                setFilterMonth("");
                setFilterStatus("");
                setFilterUserId("");
                setFilterBranch("");
                setFilterSearchText("");
                setShowHiddenRevoked(false);
                fetchContracts({ year: new Date().getFullYear().toString(), month: "", status: "", userId: "", branch: "", searchText: "", showHiddenRevoked: false });
              }}
            >
              초기화
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  {role !== "EMPLOYEE" && <th className="pb-3">직원</th>}
                  <th className="pb-3">제목</th>
                  <th className="pb-3">상태</th>
                  <th className="pb-3">결재 진행</th>
                  <th className="pb-3">처리</th>
                </tr>
              </thead>
              <tbody>
                {contracts.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-400">없음</td></tr>
                ) : contracts.map(c => {
                  const s = statusConfig[c.status] || { label: "미정", variant: "default" };
                  return (
                    <tr key={c.id} className="border-b hover:bg-gray-50">
                      {role !== "EMPLOYEE" && <td className="py-3"><p className="font-medium">{c.externalName ? `[외부] ${c.externalName}` : `${c.user.branch ? `[${c.user.branch}] ` : ""}${c.user.name}`}</p></td>}
                      <td className="py-3 font-medium">
                        {c.title}
                        {c.bundleId && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 align-middle">패키지</span>}
                        {c.employeeOnly && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 align-middle">직원전용</span>}
                      </td>
                      <td className="py-3"><Badge variant={s.variant}>{s.label}</Badge></td>
                      <td className="py-3">
                        <ApprovalChain
                          steps={c.approvalLine?.steps}
                          userId={c.externalName ? undefined : c.userId}
                          onClick={() => {
                            setApprovalDetailsTarget(c);
                            setApprovalDetailsOpen(true);
                          }}
                        />
                      </td>
                      <td className="py-3 space-x-1">
                        {/* 뷰어(미리보기): 완료본(signedUrl) 우선, 없으면 원본 — MS 오피스 뷰어로 브라우저 열람 */}
                        {/* 완료본은 PDF 로 열람 — 웹 뷰어가 떠 있는 서명 이미지를 못 그려 서명이 안 보였다 (QA 2026-08-25) */}
                        <a href={c.status === "SIGNED" ? `/api/contracts/${c.id}/signed-document?pdf=1&inline=1` : officeViewHref(getFileUrl(c.fileUrl))} target="_blank" rel="noreferrer" title="미리보기"><Button size="sm" variant="ghost" className="h-7"><Eye size={12} /></Button></a>
                        {/* 완료된 계약은 서명·직인이 들어간 완료본을 다운로드 (원본엔 서명 마커가 남아 있음) */}
                        {/* 완료본은 PDF로(수정 방지, 파일명=제목_서명완료.pdf) — 변환 실패 시 서버가 워드로 폴백.
                            미완료 원본은 워드 그대로, 파일명만 제목으로 (개선 제안 2026-08-24) */}
                        {/* 원본도 PDF로 — 워드 파일 그대로 나가면 수정 가능 (개선 제안 #67~#71) */}
                        <a href={c.status === "SIGNED" ? `/api/contracts/${c.id}/signed-document?pdf=1` : `/api/contracts/${c.id}/original-document`} target="_blank" rel="noreferrer" title={c.status === "SIGNED" ? "서명 완료본 다운로드 (PDF)" : "원본 다운로드 (PDF)"}><Button size="sm" variant="ghost" className="h-7"><Download size={12} /></Button></a>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          onClick={() => {
                            setVersionsTarget(c);
                            fetchVersions(c.id);
                            setVersionsOpen(true);
                          }}
                        >
                          <History size={12} />
                        </Button>
                        {/* 패키지의 직원전용 문서(비밀유지·개인정보동의서)는 근로계약서 발송 시 함께 발송 — 개별 발송 버튼 숨김 */}
                        {role !== "EMPLOYEE" && c.employeeOnly && c.bundleId && c.status === "DRAFT" && (
                          <span className="text-[11px] text-gray-400">근로계약서와 함께 발송</span>
                        )}
                        {/* 초안 + 진행 중(회수 후 포함) 계약: 수정·재발송 가능, 삭제는 초안만 (직원전용 패키지 문서 제외) */}
                        {role !== "EMPLOYEE" && !(c.employeeOnly && c.bundleId) && (c.status === "DRAFT" || c.status === "SENT" || c.status === "APPROVED") && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1"
                              onClick={() => {
                                setEditingContract(c);
                                setEditForm({
                                  title: c.title,
                                  type: c.type,
                                  startDate: c.startDate ? c.startDate.split("T")[0] : "",
                                  endDate: c.endDate ? c.endDate.split("T")[0] : "",
                                  salary: (c.extraFields?.["연봉"] || "").replace(/[^0-9]/g, ""),
                                });
                                // 작성 시 입력한 템플릿 동적 필드 복원 (날짜는 date input 형식으로)
                                const extras: Record<string, string> = {};
                                Object.entries(c.extraFields || {}).forEach(([k, v]) => {
                                  if (k !== "연봉") extras[k] = koreanToIso(String(v));
                                });
                                setEditExtraFields(extras);
                                setEditOpen(true);
                              }}
                            >
                              <PenLine size={12} />수정
                            </Button>
                            {c.status === "DRAFT" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => {
                                  setDeleteTarget({ id: c.id, title: c.title, bundleId: c.bundleId });
                                  setDeleteConfirmOpen(true);
                                }}
                              >
                                <Trash2 size={12} />삭제
                              </Button>
                            )}
                            {/* 초안을 최신 템플릿으로 재생성 — 입력값 유지, 문서만 새 양식 (#109) */}
                            {c.status === "DRAFT" && c.templateId && (
                              <Button size="sm" variant="outline" className="h-7 gap-1" title="양식이 수정된 경우 입력값은 그대로 두고 문서만 최신 양식으로 다시 만듭니다"
                                onClick={async () => {
                                  const res = await fetch(`/api/contracts/${c.id}/regenerate`, { method: "POST" });
                                  const d = await res.json().catch(() => ({}));
                                  if (!res.ok) { toast.error(d.error || "재생성 실패"); return; }
                                  toast.success("최신 양식으로 다시 생성했습니다.");
                                  fetchContracts();
                                }}>
                                <History size={12} />최신 양식
                              </Button>
                            )}
                            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => { setSendTarget(c); resetApproverSlots(); setApproverSearch(""); setSendOpen(true); }}>
                              <Send size={12} />{c.status === "DRAFT" ? "발송" : "재발송"}
                            </Button>
                            <Dialog open={sendOpen && sendTarget?.id === c.id} onOpenChange={setSendOpen}>
                              {/* 폭 — 안내 문구가 박스 밖으로 삐져나오던 것 (#178, 2026-08-31 이예지대리) */}
                              <DialogContent className="max-w-lg sm:max-w-lg">
                                <DialogHeader><DialogTitle>발송 전 승인자 설정</DialogTitle></DialogHeader>
                                {sendTarget && (
                                  <div className="space-y-3">
                                    <p className="text-sm text-gray-600">'{sendTarget.title}'의 승인자를 단계별로 지정하세요. (1단계 본부 · 2단계 원장 · 3단계 근로자)</p>
                                    {/* 발송 문서 실물 확인 (#100) + 원장·근로자 자동 채움 (#99·#159) */}
                                    {/* min-w-0 이 없으면 flex 항목이 글자 최소폭 밑으로 줄지 않아 모달 밖으로 밀려난다 (#178) */}
                                    <div className="flex gap-2">
                                      {/* 패키지면 포함 문서 전체를 한 PDF 로 (#124) */}
                                      <Button type="button" variant="outline" size="sm" className="flex-1 basis-0 min-w-0 w-full gap-1 h-8 whitespace-normal leading-tight"
                                        onClick={() => openBigDoc(`/api/contracts/${sendTarget.id}/bundle-preview?hl=1`, "발송 문서 미리보기")}>
                                        <Eye size={13} />발송 문서 미리보기{sendTarget.bundleId ? " (패키지 전체)" : ""}
                                      </Button>
                                      {!sendTarget.externalName && (
                                        <Button type="button" variant="outline" size="sm" className="flex-1 basis-0 min-w-0 gap-1 h-8 whitespace-normal leading-tight"
                                          onClick={() => {
                                            // 원장은 반드시 2번, 근로자는 3번 슬롯 — 1번(본부)은 직접 고른다 (#159)
                                            const emp = employees.find(e => e.id === sendTarget.userId);
                                            const mgr = emp?.branch ? employees.find(e => e.role === "MANAGER" && (e.branch === emp.branch || (e.managerBranches || []).includes(emp.branch!))) : undefined;
                                            setApproverSlots(prev => {
                                              const next = [...prev] as ApproverSlots;
                                              // 근로자(당사자)를 3단계에 먼저 두고, 원장은 당사자와 다른 사람일 때만 2단계에.
                                              // 원장 본인의 계약서면 원장=근로자라 같은 사람이 두 번 결재하게 된다 (검증관 M1)
                                              next[2] = sendTarget.userId;
                                              next[1] = mgr && mgr.id !== sendTarget.userId ? mgr.id : null;
                                              // 1단계에 이미 같은 사람이 들어가 있으면 비운다
                                              if (next[0] && (next[0] === next[1] || next[0] === next[2])) next[0] = null;
                                              return next;
                                            });
                                            setActiveSlot(null);
                                            if (!mgr) toast.error("담당 원장을 찾지 못했습니다 — 2단계는 직접 선택해주세요.");
                                            else if (mgr.id === sendTarget.userId) toast.error("당사자가 해당 지점 원장입니다 — 2단계 결재자는 직접 선택해주세요.");
                                          }}>원장·근로자 자동 채움 (본부는 직접 선택)</Button>
                                      )}
                                    </div>
                                    {sendTarget.status !== "DRAFT" && (
                                      <p className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded p-2">
                                        재발송하면 기존 결재 진행이 초기화되고 1단계부터 다시 진행됩니다.
                                      </p>
                                    )}
                                    {/* 단계 슬롯 3칸 고정 — 빈 칸도 항상 보인다 (#158) */}
                                    <div className="space-y-1.5">
                                      {approverSlots.map((id, i) => (
                                        <div key={i}>
                                          {id ? (
                                            <span className={`inline-flex w-fit max-w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm ${activeSlot === i ? "border-indigo-400 bg-indigo-100 ring-2 ring-indigo-200" : "border-indigo-200 bg-indigo-50"}`}>
                                              <button type="button" onClick={() => setActiveSlot(activeSlot === i ? null : i)}
                                                className="text-[11px] font-semibold text-indigo-500 shrink-0" title="이 칸에 다른 사람을 넣으려면 누르세요">
                                                {i + 1}단계 · {SLOT_ROLES[i]}
                                              </button>
                                              <span className="truncate">{approverLabel(id)}</span>
                                              <button type="button" onClick={() => clearApproverSlot(i)} className="text-gray-400 hover:text-red-500 shrink-0" title="비우기"><X size={14} /></button>
                                            </span>
                                          ) : (
                                            <button type="button" onClick={() => setActiveSlot(activeSlot === i ? null : i)}
                                              className={`flex w-full items-center justify-between rounded-md border border-dashed px-2 py-1.5 text-xs ${activeSlot === i ? "border-indigo-400 bg-indigo-50 text-indigo-600" : "border-gray-300 text-gray-400 hover:border-gray-400"}`}>
                                              <span>{i + 1}단계 · {SLOT_ROLES[i]} — 선택 필요</span>
                                              {activeSlot === i && <span className="font-semibold">아래에서 고르세요</span>}
                                            </button>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                    {/* 승인자 검색 + 후보 리스트 */}
                                    {(approverSlots.some(x => !x) || activeSlot !== null) && (
                                      <>
                                        <Input
                                          placeholder="이름 또는 지점으로 검색..."
                                          value={approverSearch}
                                          onChange={e => setApproverSearch(e.target.value)}
                                          className="h-8 text-sm"
                                        />
                                        <div className="border rounded max-h-44 overflow-y-auto divide-y">
                                          {/* 계약서 당사자 - 상단 고정 (외부 계약은 링크 서명 항목) */}
                                          {sendTarget.externalName ? (
                                            !approverIds.includes("EXTERNAL") && (
                                              <button type="button" onClick={() => assignApprover("EXTERNAL")}
                                                className="w-full text-left px-2.5 py-1.5 text-sm text-emerald-700 font-semibold hover:bg-emerald-50">
                                                🔗 {sendTarget.externalName} (외부 · 링크로 서명)
                                              </button>
                                            )
                                          ) : (
                                          !approverIds.includes(sendTarget.userId) && (
                                            <button type="button" onClick={() => assignApprover(sendTarget.userId)}
                                              className="w-full text-left px-2.5 py-1.5 text-sm text-blue-600 font-semibold hover:bg-blue-50">
                                              👤 {sendTarget.user?.name || "직원"} (당사자)
                                            </button>
                                          ))}
                                          {employees
                                            // 외부 계약의 userId 는 당사자가 아니라 "작성한 관리자" — 본인도 결재자로
                                            // 참여할 수 있어야 하므로 제외하지 않는다 (이예지대리 QA 2026-08-24)
                                            .filter(e => !approverIds.includes(e.id) && (sendTarget.externalName ? true : e.id !== sendTarget.userId))
                                            // 시스템 설정에서 "계약 결재자" 를 끈 관리자는 후보에서 제외
                                            .filter(e => e.role !== "ADMIN" || (e as { isContractApprover?: boolean }).isContractApprover !== false)
                                            .filter(e => !approverSearch
                                              || e.name.toLowerCase().includes(approverSearch.toLowerCase())
                                              || (e.branch || "").toLowerCase().includes(approverSearch.toLowerCase()))
                                            .map(e => (
                                              <button type="button" key={e.id} onClick={() => assignApprover(e.id)}
                                                className="w-full text-left px-2.5 py-1.5 text-sm hover:bg-gray-50">
                                                {e.branch ? `[${e.branch}] ` : ""}{e.name}{e.role === "ADMIN" ? " · 관리자" : ""}
                                              </button>
                                            ))}
                                        </div>
                                      </>
                                    )}
                                    <div className="flex gap-2 justify-end">
                                      <Button variant="outline" onClick={() => setSendOpen(false)}>취소</Button>
                                      {/* 발송 후 수정 불가 — 최종 확인 (#100) */}
                                      <Button disabled={approverIds.length === 0} onClick={() => {
                                        // 어느 단계에 누가 들어갔는지 그대로 보여준다 (#158)
                                        const names = approverSlots
                                          .map((id, i) => (id ? `${i + 1}단계 ${SLOT_ROLES[i]} ${approverName(id)}` : null))
                                          .filter(Boolean)
                                          .join(" → ");
                                        if (!confirm(`${names}\n\n발송 후에는 문서를 수정할 수 없습니다. 발송할까요?`)) return;
                                        handleSend(sendTarget.id);
                                      }}>발송</Button>
                                    </div>
                                  </div>
                                )}
                              </DialogContent>
                            </Dialog>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 서명 모달 */}
      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>서명</DialogTitle></DialogHeader>
          {signTarget && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <p className="text-sm font-medium">{signTarget.title}</p>
                <p className="text-xs text-gray-500">{signTarget.user.branch ? `[${signTarget.user.branch}] ` : ''}{signTarget.user.name}</p>
                <button type="button" className="text-xs text-blue-600 underline text-left"
                  onClick={() => openBigDoc(`/api/docs/pdf?src=${encodeURIComponent(getFileUrl(signTarget.fileUrl))}&title=${encodeURIComponent(signTarget.title)}`, signTarget.title)}>
                  문서 보기 (PDF)
                </button>
                {/* 작성 시 입력값 요약 — 계약서를 열지 않아도 핵심 내용 확인 */}
                {signTarget.extraFields && Object.keys(signTarget.extraFields).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-200 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    {/* 내부 필드명(체크_·선택_) 그대로 노출 금지 — 사람 말로 (#125) */}
                    {Object.entries(signTarget.extraFields)
                      .sort(([a], [b]) => (a.startsWith("체크_") || a.startsWith("선택_") ? 1 : 0) - (b.startsWith("체크_") || b.startsWith("선택_") ? 1 : 0))
                      .map(([k, v]) => {
                        const label = k.startsWith("체크_") ? `지급 금품 · ${k.slice(3)}`
                          : k.startsWith("선택_") ? `수령 방법 · ${k.slice(3)}`
                          : k.startsWith("확인_") ? `확인 · ${k.slice(3)}` : k;
                        return <span key={k} className="contents"><span className="text-gray-400">{label}</span><span>{v}</span></span>;
                      })}
                  </div>
                )}
              </div>
              {/* 실제 서명할 문서 실물 — 패키지는 전 문서가 이어진 PDF (#125) + 확대·축소 (#160) */}
              <div className="space-y-1">
                <div className="flex items-center justify-end gap-1">
                  <Button type="button" variant="outline" size="sm" className="h-7 w-7 p-0" title="축소"
                    onClick={() => setSignZoom(z => Math.max(0.75, Math.round((z - 0.25) * 100) / 100))}>−</Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" title="100%로 되돌리기"
                    onClick={() => setSignZoom(1)}>{Math.round(signZoom * 100)}%</Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 w-7 p-0" title="확대"
                    onClick={() => setSignZoom(z => Math.min(2, Math.round((z + 0.25) * 100) / 100))}>+</Button>
                </div>
                {/* scale 로 키우면 잘리므로 iframe 크기를 1/zoom 으로 역보정 */}
                {/* 크게 보기 단추는 **모서리에만** 둔다.
                    ⚠ 처음에는 iframe 전체를 투명 레이어로 덮어 클릭을 받았는데, 그러면 문서 위에서
                    스크롤.텍스트 선택이 통째로 막힌다(2026-09-03 검증에서 실측). 서명하며 문서를
                    내려 읽는 게 이 화면의 본래 일이므로, 클릭 편의보다 그쪽이 우선이다. */}
                <div className="relative w-full overflow-auto border rounded" style={{ height: "36vh" }}>
                  <button
                    type="button"
                    title="문서 크게 보기"
                    aria-label="문서 크게 보기"
                    className="absolute top-2 right-3 z-10 flex items-center gap-1 rounded-md border bg-white/95 px-2 py-1 text-xs shadow-sm hover:bg-white"
                    onClick={() => openBigDoc(`/api/contracts/${signTarget.id}/bundle-preview?hl=1`, "서명할 문서")}
                  >
                    <Eye size={12} />크게 보기
                  </button>
                  <iframe
                    src={`/api/contracts/${signTarget.id}/bundle-preview?hl=1`}
                    title="문서 미리보기"
                    style={{
                      width: `${100 / signZoom}%`,
                      height: `${100 / signZoom}%`,
                      border: 0,
                      transform: `scale(${signZoom})`,
                      transformOrigin: "top left",
                    }}
                  />
                </div>
              </div>
              {mySignatureUrl && !drawNewSig ? (
                /* 저장된 서명 원클릭 승인 */
                <div className="space-y-2">
                  <Label>저장된 내 서명</Label>
                  <div className="border rounded-lg bg-white p-2 flex items-center justify-center h-24">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mySignatureUrl} alt="저장된 서명" className="max-h-20 object-contain" />
                  </div>
                  <button type="button" className="text-xs text-blue-600 underline" onClick={() => { setDrawNewSig(true); sigRef.current?.clear(); }}>
                    새로 그리기 (기존 저장 서명 교체)
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>서명 *</Label>
                  <SignaturePad ref={sigRef} />
                  <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={saveAsDefault} onChange={e => setSaveAsDefault(e.target.checked)} />
                    이 서명을 저장해두고 다음 결재부터 자동 사용
                  </label>
                </div>
              )}
              {/* 계약서 실물 확인 — 요약만으로 부족할 때 (#101·#125).
                  새 창이 아니라 그 자리에서 크게 연다 (2026-09-02 이예지대리 재확인요청) */}
              <Button type="button" variant="outline" size="sm" className="w-full gap-1"
                onClick={() => openBigDoc(`/api/contracts/${signTarget.id}/bundle-preview?hl=1`, "서명할 문서")}>
                <Eye size={13} />크게 보기{signTarget.bundleId ? " (패키지 전체)" : ""}
              </Button>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setSignOpen(false)}>취소</Button>
                <Button disabled={signBusy} onClick={() => handleSign(signTarget.id, signTarget.status === "APPROVED")}>
                  {signBusy ? "처리 중..." : mySignatureUrl && !drawNewSig ? "저장된 서명으로 승인" : "서명"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 버전 히스토리 모달 */}
      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>버전 히스토리</DialogTitle></DialogHeader>
          {versionsTarget && (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {versions.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">버전 정보가 없습니다.</p>
              ) : (
                versions.map(v => (
                  <div key={v.id} className="border rounded-lg p-3 space-y-2 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium">V{v.version}</p>
                        <p className="text-xs text-gray-500">{v.title}</p>
                        <p className="text-xs text-gray-500">
                          {v.createdByUser.name} · {format(new Date(v.createdAt), "yyyy-MM-dd HH:mm")}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        이전 버전
                      </Badge>
                    </div>
                    <a href={`/api/docs/pdf?src=${encodeURIComponent(getFileUrl(v.fileUrl))}&title=${encodeURIComponent(v.title)}&download=1`} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline" className="w-full gap-1">
                        <Download size={12} />다운로드
                      </Button>
                    </a>
                  </div>
                ))
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 결재자 수정 다이얼로그 */}
      <Dialog open={updateApproverOpen} onOpenChange={setUpdateApproverOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>결재자 수정</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">현재 결재자</Label>
              <p className="text-sm font-medium">{updateApproverTarget?.step.approver?.name || "외부 서명자"}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newApprover" className="text-sm">새로운 결재자 *</Label>
              <Input
                id="newApprover"
                placeholder="이름 또는 지점으로 검색..."
                value={updateApproverSearch}
                onChange={e => setUpdateApproverSearch(e.target.value)}
                className="h-8 text-sm"
              />
              <div className="border rounded max-h-48 overflow-y-auto divide-y">
                {employees
                  .filter(emp => emp.role !== "ADMIN" || (emp as { isContractApprover?: boolean }).isContractApprover !== false)
                  .filter(emp => !updateApproverSearch
                    || emp.name.toLowerCase().includes(updateApproverSearch.toLowerCase())
                    || (emp.branch || "").toLowerCase().includes(updateApproverSearch.toLowerCase()))
                  .map(emp => (
                    <button type="button" key={emp.id} onClick={() => setUpdateApproverSelectedId(emp.id)}
                      className={`w-full text-left px-2.5 py-1.5 text-sm hover:bg-gray-50 ${updateApproverSelectedId === emp.id ? "bg-indigo-50 font-medium" : ""}`}>
                      {emp.branch ? `[${emp.branch}] ` : ""}{emp.name}{emp.role === "ADMIN" ? " · 관리자" : ""}
                    </button>
                  ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setUpdateApproverOpen(false)}>취소</Button>
              <Button onClick={handleUpdateApprover}>수정</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 결재/서명 회수 확인 다이얼로그 */}
      {/* 외부 계약 발송 직후 — 서명 링크 안내 (문자 자동 발송은 없다. 여기서 복사하거나 폰 문자 앱으로 보낸다) */}
      <Dialog open={extLinkOpen} onOpenChange={setExtLinkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>서명 링크 전달</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              <b>{extLink.name}</b> 님께 아래 링크를 전달하면 가입 없이 서명할 수 있습니다.
              {extLink.phone && <> ({extLink.phone})</>}
            </p>
            <div className="rounded-md border bg-gray-50 p-2.5 text-xs break-all select-all">{extLink.url}</div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" className="w-full"
                onClick={() => navigator.clipboard.writeText(extLink.url).then(() => toast.success("링크가 복사되었습니다. 카톡·문자에 붙여넣어 전달하세요."))}>
                🔗 링크 복사
              </Button>
              <Button type="button" variant="outline" className="w-full" disabled={!extLink.phone}
                onClick={() => extLink.phone && openSmsApp(extLink.phone, smsBody(extLink.name, extLink.url))}>
                💬 문자로 보내기
              </Button>
            </div>
            <p className="text-[11px] text-gray-400">
              문자는 자동으로 발송되지 않습니다. [문자로 보내기]는 <b>폰에서 눌렀을 때</b> 문자 앱이 내용이 채워진 채 열립니다(발송은 내 번호로 나갑니다). PC에서는 [링크 복사]를 쓰세요. 링크 유효기간은 14일입니다.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={revokeConfirmOpen} onOpenChange={setRevokeConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {revokeTarget?.type === "employee" ? "직원 서명 회수" : "결재 회수"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <p className="text-sm text-red-900">
                {revokeTarget?.type === "employee" ? (
                  <>
                    <strong>직원의 서명</strong>이 회수됩니다.<br />
                    처음부터 다시 서명을 진행해야 합니다.
                  </>
                ) : (
                  <>
                    <strong>{revokeTarget?.step?.order}단계 이후의 모든 결재</strong>가 회수됩니다.<br />
                    처음부터 다시 승인을 진행해야 합니다.
                  </>
                )}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="revokeReason" className="text-sm">회수 사유 *</Label>
              <textarea
                id="revokeReason"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="회수 이유를 자세히 입력해주세요."
                className="w-full border rounded p-2 text-sm min-h-20 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => {
                setRevokeConfirmOpen(false);
                setRevokeReason("");
              }}>
                취소
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (revokeTarget?.type === "employee") {
                    handleRevokeEmployeeSignature(revokeTarget.contractId);
                  } else {
                    handleRevokeApproval();
                  }
                }}
              >
                회수
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 결재 히스토리 모달 */}
      <Dialog open={approvalDetailsOpen} onOpenChange={setApprovalDetailsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-between w-full gap-2">
              <DialogTitle>결재 히스토리</DialogTitle>
              <div className="flex gap-2">
                {/* 삭제 버튼 - ADMIN && 결재 완료 아님 */}
                {role === "ADMIN" && approvalDetailsTarget && approvalDetailsTarget.status !== "SIGNED" && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="text-xs h-7"
                    onClick={() => {
                      setDeleteTarget({ id: approvalDetailsTarget.id, title: approvalDetailsTarget.title, bundleId: approvalDetailsTarget.bundleId });
                      setDeleteConfirmOpen(true);
                    }}
                  >
                    삭제
                  </Button>
                )}
                {/* 숨기기 버튼 - 회수된 결재가 있을 때만 표시 */}
                {role === "ADMIN" && approvalDetailsTarget &&
                  Array.isArray(approvalDetailsTarget.revocationLog) &&
                  approvalDetailsTarget.revocationLog.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/contracts/${approvalDetailsTarget.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ hideRevoked: !approvalDetailsTarget.hideRevoked }),
                        });
                        if (!res.ok) throw new Error("숨김 상태 변경 실패");
                        const data = await res.json();
                        setApprovalDetailsTarget(data.contract);
                        toast.success(data.contract.hideRevoked ? "숨겨졌습니다." : "표시됩니다.");
                        fetchContracts();
                      } catch (err) {
                        toast.error("숨김 상태 변경에 실패했습니다.");
                      }
                    }}
                  >
                    {approvalDetailsTarget.hideRevoked ? "표시" : "숨기기"}
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>
          {approvalDetailsTarget && (
            <div className="space-y-4 max-h-96 overflow-y-auto">
              <div className="space-y-2 pb-3 border-b">
                <p className="text-sm font-medium text-gray-600">계약서</p>
                <p className="text-sm font-semibold">{approvalDetailsTarget.title}</p>
                <p className="text-xs text-gray-500">
                  작성일: {format(new Date(approvalDetailsTarget.createdAt), "yyyy-MM-dd HH:mm")}
                </p>
              </div>

              {/* 직원 서명 */}
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-medium">직원 서명</p>
                    <p className="text-xs text-gray-500">{approvalDetailsTarget.user.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {approvalDetailsTarget.employeeSignedAt ? (
                      <Badge className="bg-green-100 text-green-700">완료</Badge>
                    ) : (
                      <Badge variant="outline" className="text-orange-600">대기</Badge>
                    )}
                    {/* 직원 서명 회수 버튼 */}
                    {role === "ADMIN" && approvalDetailsTarget.employeeSignedAt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs px-2 text-red-600 hover:text-red-700"
                        onClick={() => {
                          setRevokeTarget({ contractId: approvalDetailsTarget.id, type: "employee" });
                          setRevokeReason("");
                          setRevokeConfirmOpen(true);
                        }}
                      >
                        회수
                      </Button>
                    )}
                  </div>
                </div>
                {approvalDetailsTarget.employeeSignedAt && (
                  <p className="text-xs text-gray-500">
                    {format(new Date(approvalDetailsTarget.employeeSignedAt), "yyyy-MM-dd HH:mm")}
                  </p>
                )}
              </div>

              {/* 결재자 목록 */}
              {approvalDetailsTarget.approvalLine?.steps && approvalDetailsTarget.approvalLine.steps.map(step => (
                <div key={step.id} className="space-y-2 pb-2 border-b last:border-b-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{step.order}단계 결재</p>
                      <p className="text-xs text-gray-500">{step.approver?.name || `${(step as { externalName?: string }).externalName || "외부 서명자"} (외부 · 링크 서명)`}</p>
                      {/* 외부 서명 단계 — 링크 복사해 카톡·문자로 전달.
                          패키지 동반 문서(비밀유지·동의서)는 대표 계약서 링크로 함께 서명되므로 복사 숨김
                          (동반 링크를 잘못 전달하면 계약서가 미서명으로 남는 사고 방지) */}
                      {!step.approverId && (step as { signToken?: string }).signToken && step.status !== "APPROVED" && (
                        approvalDetailsTarget.employeeOnly && approvalDetailsTarget.bundleId ? (
                          <p className="mt-1 text-[11px] text-gray-400">패키지 대표 계약서의 서명 링크로 함께 서명됩니다 — 이 문서의 링크는 전달하지 마세요.</p>
                        ) : (
                        <span className="mt-1 flex items-center gap-3">
                          <button type="button" className="text-xs text-violet-600 underline"
                            onClick={() => {
                              const url = `${window.location.origin}/sign/${(step as { signToken?: string }).signToken}`;
                              navigator.clipboard.writeText(url).then(() => toast.success("서명 링크가 복사되었습니다. 카톡·문자로 전달하세요."));
                            }}>
                            🔗 서명 링크 복사
                          </button>
                          {approvalDetailsTarget.externalPhone && (
                            <button type="button" className="text-xs text-violet-600 underline"
                              onClick={() => {
                                const url = `${window.location.origin}/sign/${(step as { signToken?: string }).signToken}`;
                                openSmsApp(approvalDetailsTarget.externalPhone!, smsBody(approvalDetailsTarget.externalName || "계약자", url));
                              }}>
                              💬 문자로 보내기
                            </button>
                          )}
                        </span>
                        )
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {step.status === "APPROVED" ? (
                        <Badge className="bg-green-100 text-green-700">승인됨</Badge>
                      ) : step.status === "PENDING" ? (
                        <Badge variant="outline" className="text-orange-600">대기</Badge>
                      ) : (
                        <Badge variant="outline">미정</Badge>
                      )}
                      {/* 수정 버튼 */}
                      {(role === "ADMIN" || role === "MANAGER") && step.status === "WAITING" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs px-2"
                          onClick={() => {
                            setUpdateApproverTarget({ contractId: approvalDetailsTarget.id, step });
                            setUpdateApproverSelectedId("");
                            setUpdateApproverSearch("");
                            setUpdateApproverOpen(true);
                          }}
                        >
                          수정
                        </Button>
                      )}
                      {/* 회수 버튼 */}
                      {role === "ADMIN" && (step.status === "APPROVED" || step.status === "PENDING") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs px-2 text-red-600 hover:text-red-700"
                          onClick={() => {
                            setRevokeTarget({ contractId: approvalDetailsTarget.id, step });
                            setRevokeConfirmOpen(true);
                          }}
                        >
                          회수
                        </Button>
                      )}
                    </div>
                  </div>
                  {step.decidedAt && (
                    <p className="text-xs text-gray-500">
                      {format(new Date(step.decidedAt), "yyyy-MM-dd HH:mm")}
                    </p>
                  )}
                  {(step as any).signatureUrl && (
                    <div className="mt-1">
                      <p className="text-[11px] text-gray-400 mb-0.5">서명</p>
                      <img src={(step as any).signatureUrl} alt="서명" className="h-16 border rounded bg-white" />
                    </div>
                  )}
                </div>
              ))}

              {/* 최종 서명 */}
              {approvalDetailsTarget.signedAt && (
                <div className="space-y-2 pt-2 border-t">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium">최종 서명</p>
                      <p className="text-xs text-gray-500">완료</p>
                    </div>
                    <Badge className="bg-green-100 text-green-700">완료</Badge>
                  </div>
                  <p className="text-xs text-gray-500">
                    {format(new Date(approvalDetailsTarget.signedAt), "yyyy-MM-dd HH:mm")}
                  </p>
                  {approvalDetailsTarget.status === "SIGNED" && (
                    <a href={`/api/contracts/${approvalDetailsTarget.id}/signed-document`} className="block">
                      <Button className="w-full gap-1 bg-green-600 hover:bg-green-700"><Download size={14} />서명 완료본 다운로드</Button>
                    </a>
                  )}
                </div>
              )}

              {/* 회수 이력 */}
              {approvalDetailsTarget.revocationLog && Array.isArray(approvalDetailsTarget.revocationLog) && approvalDetailsTarget.revocationLog.length > 0 && (
                <div className="space-y-3 pt-2 border-t">
                  <p className="text-sm font-medium text-red-600">회수 이력</p>
                  {approvalDetailsTarget.revocationLog.map((log: any, idx: number) => {
                    const revokedByUser = employees.find(e => e.id === log.revokedBy);
                    return (
                      <div key={idx} className="bg-red-50 border border-red-200 rounded p-2 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="text-xs font-medium text-red-700">
                              {log.type === "employee" ? "직원 서명 회수" : `${log.stepOrder}단계 결재 회수`}
                            </p>
                            <p className="text-xs text-red-600">
                              {revokedByUser?.name || "알 수 없는 사용자"} · {format(new Date(log.revokedAt), "yyyy-MM-dd HH:mm")}
                            </p>
                          </div>
                        </div>
                        <p className="text-xs text-red-700 bg-white rounded p-2 border border-red-100">
                          <strong>사유:</strong> {log.reason || "사유 없음"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 계약서 삭제 확인 다이얼로그 */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>계약서 삭제</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <p className="text-sm text-red-900">
                <strong>"{deleteTarget?.title}"</strong> 계약서를 삭제하시겠습니까?<br />
                {deleteTarget?.bundleId && (
                  <span className="text-xs font-semibold text-red-800">패키지 문서라 묶음의 다른 문서들(비밀유지·동의서 등)도 함께 삭제됩니다.<br /></span>
                )}
                <span className="text-xs text-red-800">이 작업은 되돌릴 수 없습니다.</span>
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  setDeleteTarget(null);
                }}
              >
                취소
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteContract}
              >
                삭제
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── 문서 크게 보기 ──────────────────────────────────────────────
          "새창으로 옮기는거 불편합니다" (2026-09-02 이예지대리). 서명하다 창을 옮기면
          하던 일이 끊기므로, 같은 화면 위에 덮어서 보여주고 닫으면 바로 원래 자리로 돌아온다.
          Radix Dialog 를 중첩하지 않고 직접 덮는다 — 서명 모달 위에 또 Dialog 를 열면
          포커스 가둠이 겹쳐 바깥 모달의 입력이 막힌다. */}
      {bigDoc && (
        <div
          className="fixed inset-0 z-[100] bg-black/70 flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="문서 크게 보기"
          onClick={() => setBigDoc(null)}   /* 바깥을 누르면 닫힌다 */
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-white shrink-0" onClick={e => e.stopPropagation()}>
            <span className="text-sm truncate">{bigDoc.title}</span>
            <div className="flex items-center gap-1">
              <Button type="button" variant="secondary" size="sm" className="h-8 w-8 p-0" title="축소"
                onClick={() => setBigZoom(z => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}>−</Button>
              <Button type="button" variant="secondary" size="sm" className="h-8 px-2 text-xs" title="100%로 되돌리기"
                onClick={() => setBigZoom(1)}>{Math.round(bigZoom * 100)}%</Button>
              <Button type="button" variant="secondary" size="sm" className="h-8 w-8 p-0" title="확대"
                onClick={() => setBigZoom(z => Math.min(3, Math.round((z + 0.25) * 100) / 100))}>+</Button>
              <a href={bigDoc.src} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                <Button type="button" variant="secondary" size="sm" className="h-8 gap-1 text-xs" title="새 창으로 열기"><Eye size={13} />새 창</Button>
              </a>
              <Button type="button" variant="secondary" size="sm" className="h-8 px-3" onClick={() => setBigDoc(null)}>닫기</Button>
            </div>
          </div>
          <div className="flex-1 min-h-0 mx-2 mb-2 overflow-auto rounded bg-white" onClick={e => e.stopPropagation()}>
            {/* scale 로 키우면 잘리므로 iframe 크기를 1/zoom 으로 역보정 (서명 모달과 같은 방식) */}
            <iframe
              src={bigDoc.src}
              title={bigDoc.title}
              style={{
                width: `${100 / bigZoom}%`,
                height: `${100 / bigZoom}%`,
                border: 0,
                transform: `scale(${bigZoom})`,
                transformOrigin: "top left",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}