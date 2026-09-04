"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { FileSignature, PenLine, ArrowRight, CheckCircle2, Clock, Eye } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Step = {
  id: string;
  order: number;
  status: string;
  approverId: string;
  approver: { id: string; name: string; branch?: string | null };
};
type Contract = {
  id: string;
  title: string;
  type: string;
  status: string;
  fileUrl: string;
  userId: string;
  startDate: string | null;
  endDate: string | null;
  extraFields?: Record<string, string> | null; // 작성 시 입력값 요약 (연봉·수습 기간 등)
  createdAt: string;
  user: { id: string; name: string; department: string | null; branch: string | null };
  approvalLine?: { steps: Step[] } | null;
};

const typeLabel: Record<string, string> = {
  EMPLOYMENT: "근로계약서", PART_TIME: "단시간근로계약서", CONFIDENTIAL: "비밀유지계약", OTHER: "기타",
};
const statusConfig: Record<string, { label: string; variant: any }> = {
  DRAFT: { label: "초안", variant: "outline" },
  SENT: { label: "결재 진행 중", variant: "secondary" },
  APPROVED: { label: "결재 중", variant: "secondary" },
  SIGNED: { label: "완료", variant: "default" },
  EXPIRED: { label: "만료", variant: "destructive" },
  // 반려는 최종 상태다 — 다시 하려면 계약을 새로 만들어 발송한다 (2026-09-04)
  REJECTED: { label: "반려", variant: "destructive" },
};

function getFileUrl(fileUrl: string): string {
  if (!fileUrl) return "";
  try {
    const urls = JSON.parse(fileUrl);
    return Array.isArray(urls) ? urls[0] : fileUrl;
  } catch {
    return fileUrl;
  }
}

// 결재자는 파일을 내려받아 보관하지 않도록 브라우저에서 바로 열람.
// 워드는 자체 인앱 뷰어(즉시 렌더), 엑셀·PPT는 MS 온라인 뷰어
function viewHref(fileUrl: string): string {
  if (/\.docx?$/i.test(fileUrl)) return `/docs/viewer?src=${encodeURIComponent(fileUrl)}`;
  if (/\.(pptx?|xlsx?)$/i.test(fileUrl))
    return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(window.location.origin + fileUrl)}`;
  return fileUrl;
}

function ApprovalChain({ steps, userId }: { steps?: Step[]; userId?: string }) {
  if (!steps || steps.length === 0) return <span className="text-xs text-gray-400">결재선 없음</span>;
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      {steps.map((step, idx) => (
        <div key={step.id} className="flex items-center gap-1">
          {idx > 0 && <ArrowRight size={14} className="text-gray-400" />}
          {step.status === "APPROVED" ? (
            <CheckCircle2 size={16} className="text-green-600" />
          ) : step.status === "PENDING" ? (
            <Clock size={16} className="text-orange-600" />
          ) : (
            <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
          )}
          <span className="font-medium">{step.approverId === userId ? "직원" : step.approver?.name || (step as { externalName?: string }).externalName || "외부 서명자"}</span>
        </div>
      ))}
    </div>
  );
}

export default function ManagerContractsPage() {
  const [branch, setBranch] = useState("");
  const [myName, setMyName] = useState("");
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [myApprovals, setMyApprovals] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");

  const [signOpen, setSignOpen] = useState(false);
  const [signTarget, setSignTarget] = useState<Contract | null>(null);
  const [signing, setSigning] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);
  // 저장된 결재 서명 — 있으면 원클릭 승인
  const [mySignatureUrl, setMySignatureUrl] = useState<string | null>(null);
  const [drawNewSig, setDrawNewSig] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      setBranch(d.user?.branch || d.branch || "");
      setMyName(d.user?.name || "");
      setMySignatureUrl(d.user?.signatureUrl || null);
    }).catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (search.trim()) params.set("searchText", search.trim());
      // MANAGER 세션 → API가 자기 지점 직원 계약서만 반환
      const [listRes, apprRes] = await Promise.all([
        fetch(`/api/contracts?${params.toString()}`),
        fetch("/api/contracts/my-approvals"),
      ]);
      if (listRes.ok) setContracts((await listRes.json()).contracts || []);
      if (apprRes.ok) setMyApprovals((await apprRes.json()).contracts || []);
    } catch {
      toast.error("계약서를 불러올 수 없습니다");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleApprove() {
    if (!signTarget) return;
    const useSaved = !!mySignatureUrl && !drawNewSig;
    let body: Record<string, unknown>;
    if (useSaved) {
      body = { useSaved: true, isApprover: true };
    } else {
      if (!sigRef.current || sigRef.current.isEmpty()) { toast.error("서명을 입력해주세요."); return; }
      body = { signatureData: sigRef.current.toDataURL(), isApprover: true, saveAsDefault };
    }
    setSigning(true);
    try {
      const res = await fetch(`/api/contracts/${signTarget.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "결재 처리에 실패했습니다."); return; }
      toast.success("계약서를 승인했습니다.");
      setSignOpen(false);
      setSignTarget(null);
      if (!useSaved && saveAsDefault) {
        fetch("/api/auth/me").then(r => r.json()).then(d => setMySignatureUrl(d.user?.signatureUrl || null)).catch(() => {});
      }
      fetchData();
    } finally {
      setSigning(false);
    }
  }

  const filteredContracts = useMemo(() => contracts, [contracts]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">팀 계약서</h2>
        <p className="text-gray-600 mt-1">{branch} - 팀원 계약서 조회 및 결재</p>
      </div>

      {/* 내 승인 대기 */}
      {myApprovals.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-base text-orange-700">내 결재 대기 ({myApprovals.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {myApprovals.map(c => (
              <div key={c.id} className="flex items-center justify-between bg-white rounded-lg p-3 border border-orange-200">
                <div className="space-y-1">
                  <p className="font-medium text-sm">{c.title}</p>
                  <p className="text-xs text-gray-500">{c.user.name} · {typeLabel[c.type] || c.type}</p>
                  <ApprovalChain steps={c.approvalLine?.steps} userId={c.userId} />
                </div>
                <div className="flex gap-2">
                  {getFileUrl(c.fileUrl) && (
                    <a href={viewHref(getFileUrl(c.fileUrl))} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline" className="gap-1"><Eye size={14} />보기</Button>
                    </a>
                  )}
                  <Button size="sm" className="gap-1" onClick={() => { setSignTarget(c); setDrawNewSig(false); setSignOpen(true); }}>
                    <PenLine size={14} />승인
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
          <div className="flex flex-wrap gap-3 mb-4 pb-4 border-b">
            <div className="space-y-1">
              <Label className="text-xs font-medium">상태</Label>
              <Select value={filterStatus || "ALL"} onValueChange={v => setFilterStatus(v === "ALL" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">전체</SelectItem>
                  <SelectItem value="DRAFT">초안</SelectItem>
                  <SelectItem value="SENT">직원 서명 대기</SelectItem>
                  <SelectItem value="APPROVED">결재 중</SelectItem>
                  <SelectItem value="SIGNED">완료</SelectItem>
                  <SelectItem value="EXPIRED">만료</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label className="text-xs font-medium">검색</Label>
              <Input className="h-8 text-xs" placeholder="제목 검색" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-gray-500">불러오는 중...</div>
          ) : filteredContracts.length === 0 ? (
            <div className="py-12 text-center text-gray-500">계약서가 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-gray-600">
                  <tr>
                    <th className="pb-3 font-medium">직원</th>
                    <th className="pb-3 font-medium">제목</th>
                    <th className="pb-3 font-medium">상태</th>
                    <th className="pb-3 font-medium">결재 진행</th>
                    <th className="pb-3 font-medium text-right">처리</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredContracts.map(c => {
                    const sc = statusConfig[c.status] || { label: c.status, variant: "outline" };
                    return (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="py-3">
                          <div className="font-medium">{c.user.name}</div>
                          <div className="text-xs text-gray-400">{c.user.branch}</div>
                        </td>
                        <td className="py-3">
                          <div>{c.title}</div>
                          <div className="text-xs text-gray-400">{typeLabel[c.type] || c.type}</div>
                        </td>
                        <td className="py-3"><Badge variant={sc.variant}>{sc.label}</Badge></td>
                        <td className="py-3"><ApprovalChain steps={c.approvalLine?.steps} userId={c.userId} /></td>
                        <td className="py-3 text-right">
                          <div className="flex gap-2 justify-end">
                            {getFileUrl(c.fileUrl) && (
                              <a href={viewHref(getFileUrl(c.fileUrl))} target="_blank" rel="noreferrer">
                                <Button size="sm" variant="outline"><Eye size={14} /></Button>
                              </a>
                            )}
                            {/* 서명본은 관리자·계약 당사자만 접근 (개인정보 보관 방지) */}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 승인 다이얼로그 */}
      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>계약서 결재 승인</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {signTarget && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p className="font-medium">{signTarget.title}</p>
                <p className="text-gray-500 text-xs">{signTarget.user.name} · {typeLabel[signTarget.type] || signTarget.type}</p>
                <ApprovalChain steps={signTarget.approvalLine?.steps} userId={signTarget.userId} />
                {/* 작성 시 입력값 요약 — 계약서를 열지 않아도 핵심 내용 확인 */}
                <div className="mt-2 pt-2 border-t border-gray-200 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  <span className="text-gray-400">직원명</span><span>{signTarget.user.name}{signTarget.user.branch ? ` (${signTarget.user.branch})` : ""}</span>
                  {(signTarget.startDate || signTarget.endDate) && (
                    <><span className="text-gray-400">계약기간</span>
                    <span>{signTarget.startDate ? format(new Date(signTarget.startDate), "yyyy-MM-dd") : "?"} ~ {signTarget.endDate ? format(new Date(signTarget.endDate), "yyyy-MM-dd") : "?"}</span></>
                  )}
                  {signTarget.extraFields && Object.entries(signTarget.extraFields).map(([k, v]) => (
                    <span key={k} className="contents"><span className="text-gray-400">{k}</span><span>{v}</span></span>
                  ))}
                </div>
              </div>
            )}
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
                <p className="text-xs text-gray-400">승인 시 다음 결재자에게 전달되며, 마지막 단계면 계약이 완료됩니다.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>서명 *</Label>
                <SignaturePad ref={sigRef} />
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={saveAsDefault} onChange={e => setSaveAsDefault(e.target.checked)} />
                  이 서명을 저장해두고 다음 결재부터 자동 사용
                </label>
                <p className="text-xs text-gray-400">승인 시 다음 결재자에게 전달되며, 마지막 단계면 계약이 완료됩니다.</p>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setSignOpen(false)} disabled={signing}>취소</Button>
              <Button onClick={handleApprove} disabled={signing}>{signing ? "처리 중..." : mySignatureUrl && !drawNewSig ? "저장된 서명으로 승인" : "승인"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
