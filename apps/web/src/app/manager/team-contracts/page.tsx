"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileSignature, PenLine, ArrowRight, CheckCircle2, Clock, Eye } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import ApprovalFullView, { type SignPayload } from "@/components/contracts/ApprovalFullView";

type Step = {
  id: string;
  order: number;
  status: string;
  approverId: string;
  approver: { id: string; name: string; branch?: string | null; role?: string | null };
  decidedAt?: string | null;
  externalName?: string | null;
  hasSignature?: boolean; // 서명이 있는가(주소는 서버가 안 준다) — 진행본으로 열지 판정
};
type Contract = {
  id: string;
  title: string;
  sendMessage?: string | null; // 본부 발송 메시지(#65)
  type: string;
  status: string;
  fileUrl: string;
  userId: string;
  externalName?: string | null; // 외부(미가입) 계약자 이름 — 있으면 소유자는 작성 관리자라 당사자 표기가 다르다
  employeeOnly?: boolean; // 직원전용 문서(비밀유지·개인정보동의서) — 원장은 진행본을 못 연다
  isTest?: boolean;
  startDate: string | null;
  endDate: string | null;
  extraFields?: Record<string, string> | null; // 작성 시 입력값 요약 (연봉·수습 기간 등)
  summaryFields?: Record<string, string> | null; // 서명 창 요약 — 그 문서 템플릿 필드만(서버 계산, #206-2)
  createdAt: string;
  user: { id: string; name: string; department: string | null; branch: string | null; empNo?: number | null };
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
  // 반려 — 2026-09-11 부터 최종이 아니다: 관리자가 고쳐(수정) 또는 그대로(재발송) 다시 보낼 수 있다(#206-4)
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

// 서명 진행본·완료본(2026-10-17 디렉터 결정 「원장도 지점의 관리자」) — 서명이 하나라도 있는 진행 중 계약(반려 제외)·완료 계약.
// 서버(signed-document)와 같은 범위: 직원전용 문서·외부 계약·시험 문서는 원장이 진행본을 못 연다 → 원본 보기 그대로.
// 원장은 열람만(inline) — 내려받기 버튼은 두지 않는다
function progressHref(c: Contract): string | null {
  if (c.externalName || c.employeeOnly || c.isTest) return null;
  const signed = c.status === "SIGNED" || (c.status !== "REJECTED" && (c.approvalLine?.steps || []).some((s) => !!s.hasSignature));
  return signed ? `/api/contracts/${c.id}/signed-document?pdf=1&inline=1` : null;
}

// 열람 기록(#205-4) — 화면이 문서를 열면 POST 로 알린다(서버가 10분 안 중복은 하나로)
function recordViewed(id: string) {
  fetch(`/api/contracts/${id}/events`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "VIEWED" }),
  }).catch(() => {});
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
          <span className="font-medium">{step.approver?.name || (step.approverId === userId ? "직원" : (step as { externalName?: string }).externalName || "외부 서명자")}</span>
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
  // 승인 창 안 본문(2026-10-16 이예지 QA R1) — 본문 PDF 를 실제로 받아 창에 띄운 뒤에만 승인 버튼을 켠다(본문을 안 보고 한 번에 서명하던 것).
  // iframe 의 load 신호는 오류 화면에도 오므로 쓰지 않는다 — 응답이 정상 PDF 일 때만 docBlob(전체 창이 그 뒤 마지막 쪽까지 봐야 승인을 켠다)
  const [docBlob, setDocBlob] = useState<string | null>(null);
  const [docErr, setDocErr] = useState<string | null>(null);
  const [docIsProgress, setDocIsProgress] = useState(false); // 창에 뜬 본문이 서명 진행본인가(못 받아 원본으로 넘어가면 false)
  const [signTarget, setSignTarget] = useState<Contract | null>(null);
  const [signing, setSigning] = useState(false);
  // ⚠ 원장은 표준 결재선의 1단계 결재자인데 **반려할 수단이 아예 없었다** — 관리자 결재함
  //   (/admin/contract-approvals)은 ADMIN 전용이라 들어갈 수도 없다(2026-09-04 검증관 F4).
  //   조건이 안 맞으면 그냥 승인을 안 누르고 버티는 수밖에 없었고, 이유가 안 남았다.
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);
  // 저장된 결재 서명 — 있으면 원클릭 승인
  const [mySignatureUrl, setMySignatureUrl] = useState<string | null>(null);

  const [myId, setMyId] = useState("");
  const [myRole, setMyRole] = useState("");   // 승인 창 제목·내 단계 이름 — 본부(관리자)가 열면 「본부」(2026-10-21 디렉터 지적)
  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      setMyId(d.user?.id || "");
      setMyRole(d.user?.role || "");
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

  // 전체 창(시안 v2 6번)에서 승인 — 규칙·API 는 handleApprove 와 같다(서명 그림 또는 저장 서명 + 비밀번호, 문서 버전 묶기)
  async function handleApproveFull(p: SignPayload) {
    if (!signTarget || signing) return;
    const body: Record<string, unknown> = p.useSaved ? { useSaved: true, isApprover: true } : { signatureData: p.signatureData, isApprover: true, saveAsDefault: p.saveAsDefault };
    body.password = p.password;
    setSigning(true);
    try {
      const res = await fetch(`/api/contracts/${signTarget.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(typeof (signTarget as { version?: number } | null)?.version === "number" ? { "x-doc-version": String((signTarget as { version?: number }).version) } : {}) },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "결재 처리에 실패했습니다."); return; }
      toast.success("계약서를 승인했습니다.");
      setSignOpen(false); setSignTarget(null);
      if (!p.useSaved && p.saveAsDefault) fetch("/api/auth/me").then(r => r.json()).then(d => setMySignatureUrl(d.user?.signatureUrl || null)).catch(() => {});
      fetchData();
    } finally { setSigning(false); }
  }

  async function handleReject() {
    if (!signTarget) return;
    const reason = rejectReason.trim();
    if (!reason) { toast.error("반려 사유를 입력해주세요."); return; }
    setRejectBusy(true);
    try {
      const res = await fetch(`/api/contracts/${signTarget.id}/reject`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "반려에 실패했습니다."); return; }
      toast.success("반려했습니다. 작성자와 당사자에게 알림이 갑니다.");
      setRejectOpen(false); setRejectReason(""); setSignOpen(false); setSignTarget(null);
      fetchData();
    } finally {
      setRejectBusy(false);
    }
  }

  const filteredContracts = useMemo(() => contracts, [contracts]);

  // 승인 창 본문 받기(R1) — docx 는 서버 변환 PDF(/api/docs/pdf), PDF 양식은 파일 그대로. 정상 PDF 일 때만 승인 가능
  // 앞 단계 서명이 이미 있으면 서명 반영본(진행본)을 띄운다(2026-10-17). 진행본을 못 받으면 원본으로 — 승인 조건(정상 PDF)은 같다
  /* eslint-disable react-hooks/set-state-in-effect -- 창을 열고 닫을 때 본문 상태를 초기화하는 것이 목적이다 */
  useEffect(() => {
    const raw = signOpen && signTarget ? getFileUrl(signTarget.fileUrl) : "";
    let alive = true;
    let made: string | null = null;
    setDocErr(null); setDocBlob(null); setDocIsProgress(false);
    if (!signOpen || !signTarget) return;
    if (!raw) return;   // 파일 없는 계약(옛 데이터)은 요약만으로
    const src = /\.pdf$/i.test(raw) ? raw : `/api/docs/pdf?src=${encodeURIComponent(raw)}`;
    const prog = progressHref(signTarget);
    const load = (u: string) => fetch(u).then(async (r) => {
      const ct = r.headers.get("content-type") || "";
      if (!r.ok || !ct.includes("pdf")) throw new Error(r.status === 403 ? "본문을 열 권한이 없습니다." : "본문을 불러오지 못했습니다.");
      return { b: await r.blob(), isProg: u === prog };
    });
    (prog ? load(prog).catch(() => load(src)) : load(src))
      .then(({ b, isProg }) => {
        if (!alive) return;
        made = URL.createObjectURL(b);
        setDocBlob(made); setDocIsProgress(isProg);
        recordViewed(signTarget.id);   // 열람 기록(#205-4) — 본문이 실제로 열렸을 때
      })
      .catch((e: unknown) => { if (alive) setDocErr(e instanceof Error ? e.message : "본문을 불러오지 못했습니다."); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [signOpen, signTarget]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
                  <p className="text-xs text-gray-500">{c.externalName ? `[외부] ${c.externalName}` : c.user.name} · {typeLabel[c.type] || c.type}</p>
                  <ApprovalChain steps={c.approvalLine?.steps} userId={c.externalName ? undefined : c.userId} />
                </div>
                <div className="flex gap-2">
                  {(progressHref(c) || getFileUrl(c.fileUrl)) && (
                    <a href={progressHref(c) || viewHref(getFileUrl(c.fileUrl))} target="_blank" rel="noreferrer" onClick={() => { if (progressHref(c)) recordViewed(c.id); }}>
                      <Button size="sm" variant="outline" className="gap-1"><Eye size={14} />보기</Button>
                    </a>
                  )}
                  <Button size="sm" className="gap-1" onClick={() => { setSignTarget(c); setSignOpen(true); }}>
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
                <SelectTrigger className="h-8 text-xs w-36"><SelectValue>{({ ALL: "전체", DRAFT: "초안", SENT: "직원 서명 대기", APPROVED: "결재 중", SIGNED: "완료", EXPIRED: "만료", REJECTED: "반려" } as Record<string, string>)[filterStatus || "ALL"] ?? filterStatus}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">전체</SelectItem>
                  <SelectItem value="DRAFT">초안</SelectItem>
                  <SelectItem value="SENT">직원 서명 대기</SelectItem>
                  <SelectItem value="APPROVED">결재 중</SelectItem>
                  <SelectItem value="SIGNED">완료</SelectItem>
                  <SelectItem value="EXPIRED">만료</SelectItem>
                  <SelectItem value="REJECTED">반려</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label className="text-xs font-medium">검색</Label>
              <Input className="h-8 text-xs" placeholder="제목 · 이름으로 찾기" value={search} onChange={e => setSearch(e.target.value)} />
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
                          <div className="font-medium">{c.externalName ? `[외부] ${c.externalName}` : c.user.name}</div>
                          <div className="text-xs text-gray-400">{c.externalName ? "외부 계약자" : c.user.branch}</div>
                        </td>
                        <td className="py-3">
                          <div>{c.title}</div>
                          <div className="text-xs text-gray-400">{typeLabel[c.type] || c.type}</div>
                        </td>
                        <td className="py-3"><Badge variant={sc.variant}>{sc.label}</Badge></td>
                        <td className="py-3"><ApprovalChain steps={c.approvalLine?.steps} userId={c.externalName ? undefined : c.userId} /></td>
                        <td className="py-3 text-right">
                          <div className="flex gap-2 justify-end">
                            {/* 서명이 있으면 지금까지의 서명 반영본(진행본)·완료본으로 — 원본을 열면 원장이 서명한 뒤에도 서명이 안 보였다(2026-10-17).
                                원장은 열람만(서버가 inline·PDF 로만 준다) — 내려받기 버튼은 두지 않는다(개인정보 보관 방지) */}
                            {(progressHref(c) || getFileUrl(c.fileUrl)) && (
                              <a href={progressHref(c) || viewHref(getFileUrl(c.fileUrl))} target="_blank" rel="noreferrer"
                                 title={progressHref(c) ? (c.status === "SIGNED" ? "완료본 보기" : "서명 진행본 보기") : "원본 보기"}
                                 onClick={() => { if (progressHref(c)) recordViewed(c.id); }}>
                                <Button size="sm" variant="outline"><Eye size={14} /></Button>
                              </a>
                            )}
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

      {/* 승인 — 전체 창(2026-10-20 시안 v2 6번). 왼쪽 쪽 목록 · 가운데 A4 한 쪽씩 · 오른쪽 승인 정보, 마지막 쪽까지 봐야 승인 */}
      {signOpen && signTarget && (
        <ApprovalFullView
          key={signTarget.id}
          c={{
            id: signTarget.id, title: signTarget.title, userId: signTarget.userId, externalName: signTarget.externalName, sendMessage: signTarget.sendMessage,
            user: { name: signTarget.user.name, branch: signTarget.user.branch, empNo: signTarget.user.empNo },
            docLabel: typeLabel[signTarget.type] || signTarget.type,
            period: signTarget.startDate || signTarget.endDate ? `${(signTarget.startDate || "?").slice(0, 10)} ~ ${(signTarget.endDate || "?").slice(0, 10)}` : null,
            summaryFields: signTarget.summaryFields ?? signTarget.extraFields ?? null,
            steps: (signTarget.approvalLine?.steps || []).map((st) => ({ id: st.id, order: st.order, status: st.status, approverId: st.approverId, decidedAt: st.decidedAt, approver: st.approver, externalName: st.externalName })),
          }}
          myId={myId} myRole={myRole === "ADMIN" ? "본부" : "원장"}
          docUrl={docBlob} docErr={docErr} docIsProgress={docIsProgress} hasFile={!!getFileUrl(signTarget.fileUrl)}
          mySignatureUrl={mySignatureUrl} busy={signing} paused={rejectOpen}
          onSubmit={handleApproveFull}
          onReject={() => { setRejectReason(""); setRejectOpen(true); }}
          onClose={() => { if (!signing) setSignOpen(false); }}
        />
      )}

      {/* 반려 확인 — 되돌릴 수 없으므로 사유를 받는다 (2026-09-04) */}
      <Dialog open={rejectOpen} onOpenChange={(o) => { setRejectOpen(o); if (!o) setRejectReason(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>계약 반려</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-gray-700">
              <div className="font-medium">{signTarget?.title}</div>
              <p className="mt-2 text-red-600">
                반려하면 결재가 멈추고 작성자·당사자에게 사유가 전달됩니다. 관리자가 내용을 고쳐 다시 보내면 1단계부터 다시 진행됩니다.
              </p>
            </div>
            <div>
              <label className="text-sm mb-1 block font-medium">반려 사유 <span className="text-red-500">*</span></label>
              <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="어디가 잘못됐는지 적어 주세요. 작성자와 당사자에게 그대로 전달됩니다."
                        rows={4} maxLength={500} autoFocus />
              <div className="text-xs text-gray-400 text-right mt-1">{rejectReason.length}/500</div>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setRejectOpen(false)}>취소</Button>
            <Button variant="destructive" disabled={!rejectReason.trim() || rejectBusy} onClick={handleReject}>
              {rejectBusy ? "처리 중..." : "반려하기"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}