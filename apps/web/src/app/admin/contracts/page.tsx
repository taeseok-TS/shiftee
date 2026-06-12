"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileSignature, Plus, PenLine, Download, Send, CheckCircle2, Clock, ArrowRight, History, Trash2, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Contract = {
  id: string;
  userId: string;
  title: string;
  type: string;
  fileUrl: string;
  status: string;
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

type Employee = { id: string; name: string; department: string | null; branch?: string | null };

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
  CONFIDENTIAL: "비밀유지계약",
  OTHER: "기타",
};

const statusConfig: Record<string, { label: string; variant: any }> = {
  DRAFT: { label: "초안", variant: "outline" },
  SENT: { label: "직원 서명 대기", variant: "secondary" },
  APPROVED: { label: "결재 중", variant: "secondary" },
  SIGNED: { label: "완료", variant: "default" },
  EXPIRED: { label: "만료", variant: "destructive" },
};

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
          {step.approverId === userId ? "직원" : step.approver.name}
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
  const [employeeSearchText, setEmployeeSearchText] = useState("");
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
  const [approverIds, setApproverIds] = useState<string[]>([]);

  const [signOpen, setSignOpen] = useState(false);
  const [signTarget, setSignTarget] = useState<Contract | null>(null);
  const [signName, setSignName] = useState("");

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
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  // 계약서 수정 (DRAFT 상태)
  const [editOpen, setEditOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<any>(null);
  const [editForm, setEditForm] = useState({ title: "", type: "", startDate: "", endDate: "" });
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editUploading, setEditUploading] = useState(false);

  // 템플릿 업로드
  const [uploadTemplateOpen, setUploadTemplateOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: "", description: "", type: "EMPLOYMENT" });
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);

  // 템플릿 리스트 보기
  const [showTemplatesList, setShowTemplatesList] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<ContractTemplate | null>(null);

  // 검색/필터
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());
  const [filterMonth, setFilterMonth] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [filterSearchText, setFilterSearchText] = useState("");
  const [showHiddenRevoked, setShowHiddenRevoked] = useState(false);

  const fetchContracts = useCallback(async (filters?: any) => {
    const params = new URLSearchParams();
    const useFilters = filters || {
      year: filterYear,
      month: filterMonth,
      status: filterStatus,
      userId: filterUserId,
      searchText: filterSearchText,
      showHiddenRevoked: showHiddenRevoked,
    };

    if (useFilters.year) params.append("year", useFilters.year);
    if (useFilters.month) params.append("month", useFilters.month);
    if (useFilters.status) params.append("status", useFilters.status);
    if (useFilters.userId) params.append("userId", useFilters.userId);
    if (useFilters.searchText) params.append("searchText", useFilters.searchText);
    if (useFilters.showHiddenRevoked) params.append("showHiddenRevoked", "true");

    const res = await fetch(`/api/contracts?${params.toString()}`);
    const data = await res.json();
    setContracts(data.contracts || []);

    if (role !== "EMPLOYEE") {
      const approvalRes = await fetch("/api/contracts/my-approvals");
      const approvalData = await approvalRes.json();
      setMyApprovals(approvalData.contracts || []);
    }
  }, [role, filterYear, filterMonth, filterStatus, filterUserId, filterSearchText, showHiddenRevoked]);

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
          setEditForm({ title: "", type: "", startDate: "", endDate: "" });
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
          setEditForm({ title: "", type: "", startDate: "", endDate: "" });
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

  const handleTemplateSelect = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      setCreateForm(f => ({
        ...f,
        title: template.name,
        type: template.type,
      }));
      // 템플릿의 파일 정보는 서버에서 처리
    }
  };

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      setRole(d.user?.role || "EMPLOYEE");
      setMyId(d.user?.id || "");
      setMyName(d.user?.name || "");
    });
    fetch("/api/employees").then(r => r.json()).then(d => setEmployees(d.employees || [])).catch(() => {});
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

  async function handleUploadTemplate(e: React.FormEvent) {
    e.preventDefault();

    if (!templateForm.name.trim()) {
      toast.error("템플릿 이름을 입력해주세요.");
      return;
    }

    if (!templateFile) {
      toast.error("파일을 선택해주세요.");
      return;
    }

    setUploadingTemplate(true);
    try {
      const formData = new FormData();
      formData.append("file", templateFile);
      formData.append("name", templateForm.name);
      formData.append("description", templateForm.description);
      formData.append("type", templateForm.type);

      const res = await fetch("/api/contract-templates", {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "템플릿 업로드에 실패했습니다.");
        setUploadingTemplate(false);
        return;
      }

      toast.success("템플릿이 저장되었습니다.");
      setUploadTemplateOpen(false);
      setTemplateForm({ name: "", description: "", type: "EMPLOYMENT" });
      setTemplateFile(null);
      setUploadingTemplate(false);
      fetchTemplates();
    } catch (error) {
      console.error("템플릿 업로드 실패:", error);
      toast.error("템플릿 업로드에 실패했습니다.");
      setUploadingTemplate(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();

    // 템플릿 사용 시에는 파일이 서버에서 처리됨
    if (!useTemplate && files.length === 0) { toast.error("파일을 선택해주세요."); return; }
    if (!createForm.userId) { toast.error("직원을 선택해주세요."); return; }
    if (!createForm.title) { toast.error("제목을 입력해주세요."); return; }

    setUploading(true);
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
    formData.append("title", createForm.title);
    formData.append("type", createForm.type);
    formData.append("startDate", createForm.startDate);
    formData.append("endDate", createForm.endDate);
    formData.append("salary", createForm.salary);

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
    setCreateForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "" });
    fetchContracts();
  }

  async function handleSend(id: string) {
    if (approverIds.length === 0) { toast.error("승인자를 선택해주세요."); return; }

    console.log("=== 프론트엔드 발송 ===");
    console.log("approverIds:", approverIds);
    console.log("approverIds 길이:", approverIds.length);
    (approverIds || []).forEach((aid, idx) => {
      const emp = employees.find(e => e.id === aid);
      console.log(`${idx + 1}단계: ${aid} (${emp?.name || "Unknown"})`);
    });

    const res = await fetch(`/api/contracts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "SENT", approverIds }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("계약서 발송됨");
    setSendOpen(false);
    setApproverIds([]);
    fetchContracts();
  }

  async function handleSign(id: string, isApprover = false) {
    if (!signName) { toast.error("이름을 입력해주세요."); return; }

    const res = await fetch(`/api/contracts/${id}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signatureName: signName, isApprover }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success(isApprover ? "계약 승인됨" : "서명 완료");
    setSignOpen(false);
    setSignName("");
    fetchContracts();
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
                setCreateForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "" });
                setFiles([]);
                setUseTemplate(false);
                setSelectedTemplate("");
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
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => setUploadTemplateOpen(true)}>
                      <Plus size={16} className="mr-2" />
                      새 템플릿 저장
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setShowTemplatesList(true)}>
                      <FileSignature size={16} className="mr-2" />
                      저장된 템플릿 ({templates.length})
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>계약서 작성</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label>직원 *</Label>
                  {/* 직원 검색 */}
                  <div className="space-y-2">
                    <Input
                      placeholder="직원명 또는 지점으로 검색..."
                      value={employeeSearchText}
                      onChange={(e) => setEmployeeSearchText(e.target.value)}
                      className="text-sm"
                    />
                    {/* 선택된 직원 표시 */}
                    {createForm.userId && (
                      <div className="bg-blue-50 border border-blue-200 rounded p-2">
                        <p className="text-xs text-blue-700 font-medium">
                          선택됨: {employees.find(e => e.id === createForm.userId)?.name}
                        </p>
                      </div>
                    )}
                    {/* 검색 결과 */}
                    <div className="border rounded bg-white max-h-48 overflow-y-auto">
                      {employees
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
                              setCreateForm(f => ({ ...f, userId: e.id }));
                              setEmployeeSearchText("");
                            }}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-b-0 transition ${
                              createForm.userId === e.id ? "bg-blue-100 font-medium" : ""
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
                      <SelectTrigger><SelectValue placeholder="템플릿 선택" /></SelectTrigger>
                      <SelectContent>
                        {templates.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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

                <div className="space-y-2">
                  <Label>계약 기간 *</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-gray-600">시작일</label>
                      <Input
                        type="date"
                        value={createForm.startDate}
                        onChange={e => setCreateForm(f => ({ ...f, startDate: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-600">종료일</label>
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

                <div className="space-y-2">
                  <Label>연봉 <span className="text-xs text-gray-400 font-normal">(선택 · 워드 템플릿의 {"{연봉}"} 필드에 입력됨)</span></Label>
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

                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>취소</Button>
                  <Button type="submit" disabled={uploading}>{uploading ? "업로드" : "작성"}</Button>
                </div>
              </form>
            </DialogContent>
            </Dialog>

            {/* 템플릿 업로드 Dialog */}
            <Dialog open={uploadTemplateOpen} onOpenChange={(open) => {
              setUploadTemplateOpen(open);
              if (!open) {
                setTemplateForm({ name: "", description: "", type: "EMPLOYMENT" });
                setTemplateFile(null);
              }
            }}>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>계약서 템플릿 저장</DialogTitle></DialogHeader>
                <form onSubmit={handleUploadTemplate} className="space-y-4">
                  <div className="space-y-2">
                    <Label>템플릿 이름 *</Label>
                    <Input
                      placeholder="예: 2025 신입사원 근로계약서"
                      value={templateForm.name}
                      onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>설명</Label>
                    <Input
                      placeholder="선택사항: 템플릿 설명"
                      value={templateForm.description}
                      onChange={e => setTemplateForm(f => ({ ...f, description: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>유형</Label>
                    <Select value={templateForm.type} onValueChange={v => v && setTemplateForm(f => ({ ...f, type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(typeLabel).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>파일 (PDF 또는 워드) *</Label>
                    <div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-gray-50"
                      onClick={() => document.getElementById("templateFileInput")?.click()}>
                      <input
                        id="templateFileInput"
                        type="file"
                        accept=".pdf,.docx"
                        onChange={(e) => setTemplateFile(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                      {templateFile ? (
                        <div>
                          <p className="text-sm font-medium text-green-600">✓ {templateFile.name}</p>
                          <p className="text-xs text-gray-500 mt-1">클릭하여 변경</p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm text-gray-600">PDF 또는 워드(.docx) 파일을 선택하세요</p>
                          <p className="text-xs text-gray-400 mt-1">클릭 또는 파일 드래그</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
                    <p className="font-semibold">💡 워드(.docx) 템플릿은 자동 입력 필드를 지원합니다</p>
                    <p>문서 안에 아래 필드를 넣어두면 계약서 작성 시 자동으로 채워집니다:</p>
                    <p className="font-mono text-[11px] leading-relaxed">
                      {"{직원명} {이메일} {연락처} {지점} {직책} {직급}"}<br />
                      {"{입사일} {제목} {계약시작일} {계약종료일} {연봉} {작성일}"}
                    </p>
                  </div>

                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" onClick={() => setUploadTemplateOpen(false)}>
                      취소
                    </Button>
                    <Button type="submit" disabled={uploadingTemplate}>
                      {uploadingTemplate ? "저장 중..." : "저장"}
                    </Button>
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
            setEditForm({ title: "", type: "", startDate: "", endDate: "" });
            setEditFile(null);
          }
        }}>
          <DialogContent className="max-w-sm">
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
                  <p className="text-xs text-gray-500">{c.user.name} · {typeLabel[c.type]}</p>
                </div>
                <Button size="sm" onClick={() => { setSignTarget(c); setSignName(""); setSignOpen(true); }} className="gap-1">
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
                  <ApprovalChain steps={c.approvalLine?.steps} userId={c.userId} />
                </div>
                <div className="flex gap-2">
                  <a href={getFileUrl(c.fileUrl)} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline"><Download size={14} /></Button>
                  </a>
                  <Button size="sm" onClick={() => { setSignTarget(c); setSignName(""); setSignOpen(true); }} className="gap-1">
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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 pb-4 border-b">
            {/* 연도 */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">연도</Label>
              <Select value={filterYear} onValueChange={(v) => { setFilterYear(v); setFilterMonth(""); }}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2026, 2025, 2024, 2023, 2022, 2021, 2020].map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}년</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 월 */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">월</Label>
              <Select value={filterMonth} onValueChange={setFilterMonth} disabled={!filterYear}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">전체</SelectItem>
                  {Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0')).map(month => (
                    <SelectItem key={month} value={month}>{month}월</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 상태 */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">상태</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">전체</SelectItem>
                  <SelectItem value="DRAFT">초안</SelectItem>
                  <SelectItem value="SENT">직원 서명 대기</SelectItem>
                  <SelectItem value="APPROVED">결재 중</SelectItem>
                  <SelectItem value="SIGNED">완료</SelectItem>
                  <SelectItem value="EXPIRED">만료</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 직원 (ADMIN/MANAGER만) */}
            {role !== "EMPLOYEE" && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">직원</Label>
                <Select value={filterUserId} onValueChange={setFilterUserId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="전체" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">전체</SelectItem>
                    {employees.map(emp => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.branch ? `[${emp.branch}] ` : ''}{emp.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 검색 */}
            <div className="space-y-1">
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
                setFilterSearchText("");
                setShowHiddenRevoked(false);
                fetchContracts({ year: new Date().getFullYear().toString(), month: "", status: "", userId: "", searchText: "", showHiddenRevoked: false });
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
                      {role !== "EMPLOYEE" && <td className="py-3"><p className="font-medium">{c.user.branch ? `[${c.user.branch}] ` : ''}{c.user.name}</p></td>}
                      <td className="py-3 font-medium">{c.title}</td>
                      <td className="py-3"><Badge variant={s.variant}>{s.label}</Badge></td>
                      <td className="py-3">
                        <ApprovalChain
                          steps={c.approvalLine?.steps}
                          userId={c.userId}
                          onClick={() => {
                            setApprovalDetailsTarget(c);
                            setApprovalDetailsOpen(true);
                          }}
                        />
                      </td>
                      <td className="py-3 space-x-1">
                        <a href={getFileUrl(c.fileUrl)} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" className="h-7"><Download size={12} /></Button></a>
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
                        {role !== "EMPLOYEE" && c.status === "DRAFT" && (
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
                                });
                                setEditOpen(true);
                              }}
                            >
                              <PenLine size={12} />수정
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => {
                                setDeleteTarget({ id: c.id, title: c.title });
                                setDeleteConfirmOpen(true);
                              }}
                            >
                              <Trash2 size={12} />삭제
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => { setSendTarget(c); setApproverIds([]); setSendOpen(true); }}>
                              <Send size={12} />발송
                            </Button>
                            <Dialog open={sendOpen && sendTarget?.id === c.id} onOpenChange={setSendOpen}>
                              <DialogContent className="max-w-sm">
                                <DialogHeader><DialogTitle>발송 전 승인자 설정</DialogTitle></DialogHeader>
                                {sendTarget && (
                                  <div className="space-y-4">
                                    <p className="text-sm text-gray-600">'{sendTarget.title}'의 승인자를 순서대로 선택하세요.</p>
                                    <div className="space-y-2">
                                      {[1, 2, 3].map(order => (
                                        <div key={order} className="space-y-1">
                                          <Label className="text-xs">{order}단계 승인자</Label>
                                          <Select value={approverIds[order - 1] || ""} onValueChange={v => {
                                            if (!v || v === "") return; // 빈 값 무시
                                            const newIds = [...approverIds];
                                            newIds[order - 1] = v;
                                            setApproverIds(newIds);
                                          }}>
                                            <SelectTrigger className="h-8"><SelectValue placeholder="선택 (선택사항)" /></SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="">없음</SelectItem>
                                              {/* 계약서 당사자(직원) - 모든 단계에서 선택 가능 */}
                                              {!approverIds.includes(sendTarget.userId) && (
                                                <SelectItem value={sendTarget.userId} className="text-blue-600 font-semibold">
                                                  👤 {sendTarget.user?.name || '직원'} (당사자)
                                                </SelectItem>
                                              )}
                                              {/* 다른 직원들 */}
                                              {employees.filter(e => !approverIds.includes(e.id)).map(e => (
                                                <SelectItem key={e.id} value={e.id}>{e.branch ? `[${e.branch}] ` : ''}{e.name}</SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      ))}
                                    </div>
                                    <div className="flex gap-2 justify-end">
                                      <Button variant="outline" onClick={() => setSendOpen(false)}>취소</Button>
                                      <Button onClick={() => handleSend(sendTarget.id)}>발송</Button>
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
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>서명</DialogTitle></DialogHeader>
          {signTarget && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <p className="text-sm font-medium">{signTarget.title}</p>
                <p className="text-xs text-gray-500">{signTarget.user.branch ? `[${signTarget.user.branch}] ` : ''}{signTarget.user.name}</p>
                <a href={getFileUrl(signTarget.fileUrl)} target="_blank" rel="noreferrer" className="text-xs text-blue-600">파일</a>
              </div>
              <div className="space-y-2">
                <Label>서명자</Label>
                <Input value={signName} onChange={e => setSignName(e.target.value)} placeholder={myName} />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setSignOpen(false)}>취소</Button>
                <Button onClick={() => handleSign(signTarget.id, signTarget.status === "APPROVED")}>서명</Button>
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
                        {statusConfig[v.status]?.label || v.status}
                      </Badge>
                    </div>
                    <a href={getFileUrl(v.fileUrl)} target="_blank" rel="noreferrer">
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
              <p className="text-sm font-medium">{updateApproverTarget?.step.approver.name}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newApprover" className="text-sm">새로운 결재자 *</Label>
              <Select value={updateApproverSelectedId} onValueChange={setUpdateApproverSelectedId}>
                <SelectTrigger id="newApprover">
                  <SelectValue placeholder="승인자 선택" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map(emp => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name} {emp.branch ? `(${emp.branch})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setUpdateApproverOpen(false)}>취소</Button>
              <Button onClick={handleUpdateApprover}>수정</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 결재/서명 회수 확인 다이얼로그 */}
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
                      setDeleteTarget({ id: approvalDetailsTarget.id, title: approvalDetailsTarget.title });
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
                      <p className="text-xs text-gray-500">{step.approver.name}</p>
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
    </div>
  );
}