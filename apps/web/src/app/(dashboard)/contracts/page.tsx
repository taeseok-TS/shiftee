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
import { FileSignature, Plus, PenLine, Download, Send, CheckCircle2, Clock, ArrowRight, History } from "lucide-react";
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
  user: { name: string; department: string | null };
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

type Employee = { id: string; name: string; department: string | null };

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

function ApprovalChain({ steps }: { steps?: any[] }) {
  if (!steps || steps.length === 0) return null;
  
  const stepElements = [];
  // 직원
  stepElements.push(
    <div key="employee" className="flex items-center gap-1">
      <div className="flex items-center gap-1">
        <CheckCircle2 size={16} className="text-green-600" />
        <span className="text-xs font-medium">직원</span>
      </div>
    </div>
  );

  // 승인자들
  steps.forEach((step, idx) => {
    stepElements.push(
      <ArrowRight key={`arrow-${idx}`} size={14} className="text-gray-400" />
    );
    stepElements.push(
      <div key={`step-${step.order}`} className="flex items-center gap-1">
        {step.status === "APPROVED" ? (
          <CheckCircle2 size={16} className="text-green-600" />
        ) : step.status === "PENDING" ? (
          <Clock size={16} className="text-orange-600" />
        ) : (
          <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
        )}
        <span className="text-xs font-medium">{step.approver.name}</span>
      </div>
    );
  });

  return <div className="flex items-center gap-2 flex-wrap text-xs">{stepElements}</div>;
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
  const [createForm, setCreateForm] = useState({
    userId: "",
    title: "",
    type: "EMPLOYMENT",
    startDate: "",
    endDate: "",
  });
  const [file, setFile] = useState<File | null>(null);
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

  const fetchContracts = useCallback(async () => {
    const res = await fetch("/api/contracts");
    const data = await res.json();
    setContracts(data.contracts || []);

    if (role !== "EMPLOYEE") {
      const approvalRes = await fetch("/api/contracts/my-approvals");
      const approvalData = await approvalRes.json();
      setMyApprovals(approvalData.contracts || []);
    }
  }, [role]);

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();

    // 템플릿 사용 시에는 파일이 서버에서 처리됨
    if (!useTemplate && !file) { toast.error("파일을 선택해주세요."); return; }
    if (!createForm.userId) { toast.error("직원을 선택해주세요."); return; }
    if (!createForm.title) { toast.error("제목을 입력해주세요."); return; }

    setUploading(true);
    const formData = new FormData();

    if (useTemplate && selectedTemplate) {
      formData.append("templateId", selectedTemplate);
    } else if (file) {
      formData.append("file", file);
    }

    formData.append("userId", createForm.userId);
    formData.append("title", createForm.title);
    formData.append("type", createForm.type);
    formData.append("startDate", createForm.startDate);
    formData.append("endDate", createForm.endDate);

    const res = await fetch("/api/contracts", { method: "POST", body: formData });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("계약서 작성됨");
    setCreateOpen(false);
    setFile(null);
    setUseTemplate(false);
    setSelectedTemplate("");
    setCreateForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "" });
    fetchContracts();
  }

  async function handleSend(id: string) {
    if (approverIds.length === 0) { toast.error("승인자를 선택해주세요."); return; }

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
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus size={16} />계약서 작성</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>계약서 작성</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label>직원 *</Label>
                  <Select value={createForm.userId} onValueChange={v => setCreateForm(f => ({ ...f, userId: v }))}>
                    <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                    <SelectContent>
                      {employees.map(e => (
                        <SelectItem key={e.id} value={e.id}>{e.name} ({e.department})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                    <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
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
                    <Label>파일 *</Label>
                    <Input type="file" accept=".pdf" onChange={e => setFile(e.target.files?.[0] || null)} disabled={uploading} />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>제목 *</Label>
                  <Input value={createForm.title} onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))} required />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label>유형</Label>
                    <Select value={createForm.type} onValueChange={v => setCreateForm(f => ({ ...f, type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(typeLabel).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>기간</Label>
                    <Input type="date" value={createForm.startDate} onChange={e => setCreateForm(f => ({ ...f, startDate: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>취소</Button>
                  <Button type="submit" disabled={uploading}>{uploading ? "업로드" : "작성"}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

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
                  <ApprovalChain steps={c.approvalLine?.steps} />
                </div>
                <div className="flex gap-2">
                  <a href={c.fileUrl} target="_blank">
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
                  const s = statusConfig[c.status];
                  return (
                    <tr key={c.id} className="border-b hover:bg-gray-50">
                      {role !== "EMPLOYEE" && <td className="py-3"><p className="font-medium">{c.user.name}</p></td>}
                      <td className="py-3 font-medium">{c.title}</td>
                      <td className="py-3"><Badge variant={s.variant}>{s.label}</Badge></td>
                      <td className="py-3"><ApprovalChain steps={c.approvalLine?.steps} /></td>
                      <td className="py-3 space-x-1">
                        <a href={c.fileUrl} target="_blank"><Button size="sm" variant="ghost" className="h-7"><Download size={12} /></Button></a>
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
                          <Dialog open={sendOpen && sendTarget?.id === c.id} onOpenChange={setSendOpen}>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => { setSendTarget(c); setApproverIds([]); }}>
                                <Send size={12} />발송
                              </Button>
                            </DialogTrigger>
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
                                          const newIds = [...approverIds];
                                          newIds[order - 1] = v;
                                          setApproverIds(newIds.filter(Boolean));
                                        }}>
                                          <SelectTrigger className="h-8"><SelectValue placeholder="선택 (선택사항)" /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="">없음</SelectItem>
                                            {employees.filter(e => !approverIds.includes(e.id)).map(e => (
                                              <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
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
                <p className="text-xs text-gray-500">{signTarget.user.name}</p>
                <a href={signTarget.fileUrl} target="_blank" className="text-xs text-blue-600">파일</a>
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
                    <a href={v.fileUrl} target="_blank">
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
    </div>
  );
}