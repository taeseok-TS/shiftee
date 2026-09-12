"use client";
import { SIGN_CONSENT_TEXT } from "@/lib/contract-consent";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { FileSignature, PenLine, Download, CheckCircle2, Clock, ArrowRight, History, Eye } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import PdfViewer from "@/components/PdfViewer";

type Contract = {
  id: string;
  postSignAccess?: string; // 서명 완료 후 근로자 접근: full | view | none (#129)
  userId: string;
  title: string;
  type: string;
  fileUrl: string;
  status: string;
  extraFields?: Record<string, string> | null; // 개인정보동의서 선택 동의 등
  profileFields?: string[] | null; // 이 계약서가 쓰는 프로필 필드 (주소/생년월일)
  employeeFields?: string[] | null; // 직원이 서명 시 직접 입력하는 필드 (퇴사일자/퇴사사유 등)
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
  // 이 화면이 실제로 쓰는데 타입에서 빠져 있던 것들 (2026-09-03)
  startDate?: string | null;
  endDate?: string | null;
  hideRevoked?: boolean;              // 회수된 결재 숨김
  revocationLog?: { at?: string; by?: string; reason?: string }[] | null; // 회수 이력
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
  changes?: { field: string; from: string | null; to: string | null }[] | null; // 이 버전 뒤에 바뀐 항목(#206-6)
  reason?: string | null;
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

// fileUrl이 JSON 배열일 경우 파싱, 첫 번째 파일 URL 반환
// 서명 전 계약서는 다운로드 대신 브라우저 열람만 (다운로드는 서명 완료본만 허용)
// 서명 화면 미리보기용 — /docs/viewer 를 한 번 더 거치지 않고 변환 PDF 로 바로 간다.
// 중첩 iframe(모달 → viewer → PDF) 이 로딩을 두 배로 늘리고 있었다 (#179).
// #zoom=page-width 로 문서가 보기 영역 폭에 맞춰져 오른쪽이 잘리지 않는다 (#197).
// PdfViewer 는 주소 해시(#zoom=...)를 쓰지 않는다 — 브라우저 내장 뷰어용 옵션이라 붙이면 안 된다
function pdfSrc(fileUrl: string): string {
  return pdfHref(fileUrl).split("#")[0];
}

function pdfHref(fileUrl: string): string {
  const [rawPath, query] = fileUrl.split("?");
  const t = new URLSearchParams(query || "").get("t");
  const hash = "#zoom=page-width&toolbar=0&navpanes=0";
  if (/\.pdf$/i.test(rawPath)) return fileUrl + hash;
  if (!/\.docx?$/i.test(rawPath)) return viewHref(fileUrl);
  const qs = new URLSearchParams({ src: rawPath });
  if (t) qs.set("t", t);
  return `/api/docs/pdf?${qs.toString()}${hash}`;
}

function viewHref(fileUrl: string): string {
  // 워드는 자체 인앱 뷰어(즉시 렌더). 엑셀·PPT만 MS 온라인 뷰어 유지
  if (/\.docx?$/i.test(fileUrl)) return `/docs/viewer?src=${encodeURIComponent(fileUrl)}`;
  if (/\.(pptx?|xlsx?)$/i.test(fileUrl))
    return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(window.location.origin + fileUrl)}`;
  return fileUrl;
}

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
  const [myId, setMyId] = useState("");

  const [signOpen, setSignOpen] = useState(false);
  const [signTarget, setSignTarget] = useState<Contract | null>(null);
  // 서명 거부(반려) — 조건이 다르면 종전에는 그냥 안 누르고 버티는 수밖에 없어
  // **이유가 어디에도 안 남았다**. 사유를 적어 거부하면 관리자에게 바로 알림이 간다
  // (디렉터 결정 2026-09-04). 반려는 최종 상태다.
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  async function handleReject() {
    if (!signTarget) return;
    const reason = rejectReason.trim();
    if (!reason) { toast.error("사유를 입력해주세요"); return; }
    setRejectSubmitting(true);
    try {
      const res = await fetch(`/api/contracts/${signTarget.id}/reject`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "반려에 실패했습니다"); return; }
      toast.success("반려했습니다. 관리자에게 사유가 전달됩니다.");
      setRejectOpen(false); setRejectReason(""); setSignOpen(false); setSignTarget(null);
      fetchContracts();
    } catch {
      toast.error("오류가 발생했습니다");
    } finally {
      setRejectSubmitting(false);
    }
  }
  const sigRef = useRef<SignaturePadHandle>(null);
  const [consentChoices, setConsentChoices] = useState<Record<string, string>>({}); // 개인정보동의서 선택 항목
  const [consentRequired, setConsentRequired] = useState(false); // 필수 항목 명시 동의 (#104 — 자동 처리 금지)
  const [consentRead, setConsentRead] = useState(false); // 전문을 끝까지 확인했는가 (#104 — 열람 없이는 진행 불가)
  const [viewerAtBottom, setViewerAtBottom] = useState(false); // 전문 스크롤 바닥 도달
  const [signStep, setSignStep] = useState(1); // 개인정보동의서: 1=동의 확인, 2=서명
  const [docViewerOpen, setDocViewerOpen] = useState(false); // 동의서 전문 인앱 뷰어
  const [myProfile, setMyProfile] = useState<{ address: string; birthDate: string }>({ address: "", birthDate: "" });
  const [profileInput, setProfileInput] = useState<{ 주소: string; 생년월일: string }>({ 주소: "", 생년월일: "" });
  const [empFieldInput, setEmpFieldInput] = useState<Record<string, string>>({}); // 직원 직접입력 필드값(퇴사일자 등)
  const [mySigUrl, setMySigUrl] = useState(""); // 저장된 내 서명 (재사용, 개선 제안 #75)
  const [saveSig, setSaveSig] = useState(false); // 서명 후 저장 여부 — 기본 해제(#205-2, 2026-09-11)
  const [drawNewSig, setDrawNewSig] = useState(false); // 저장 서명 대신 새로 그리기 (#127 — 저장 서명이 기본)
  const [previewZoom, setPreviewZoom] = useState(false); // 미리보기 클릭 확대 (개선 제안 #73)
  const [previewLoading, setPreviewLoading] = useState(true); // 미리보기 로딩 표시 (#179)
  const [zoomLoading, setZoomLoading] = useState(true); // 확대 창 로딩 표시 (#179)
  // 주민등록번호 자동 하이픈 (개선 제안 #74): 숫자만 받아 6자리 뒤에 - 삽입, 13자리 제한
  const formatRrn = (raw: string) => {
    const d = raw.replace(/\D/g, "").slice(0, 13);
    return d.length > 6 ? `${d.slice(0, 6)}-${d.slice(6)}` : d;
  };
  // 서명 대상이 요구하는 프로필 필드 중 아직 비어 있는 것 (입력 유도) — 본인(계약 대상 직원)이 서명할 때만
  // (원장/본부 등 결재자는 대상 직원 정보이므로 입력 요구 X)
  const missingProfile = (signTarget?.userId === myId ? (signTarget?.profileFields || []) : []).filter((f: string) =>
    f === "주소" ? !myProfile.address : f === "생년월일" ? !myProfile.birthDate : false);
  // 직원 직접입력 필드 — 본인(계약 대상 직원)이 서명할 때만 (원장/본부 결재 시엔 이미 채워짐)
  const empFields: string[] = (signTarget?.userId === myId ? signTarget?.employeeFields : null) || [];
  const isEmpDateField = (f: string) => /일자|날짜|일$/.test(f);
  // 필드명으로 입력 타입 유추: 체크_→체크박스, ~일→날짜, 그 외→텍스트
  // 확인_ = 기본 해제·체크 필수(설명확인) / 체크_ = 기본 체크·해제 가능(지급금품)
  const empFieldType = (f: string): "check" | "confirm" | "date" | "text" =>
    f.startsWith("체크_") ? "check" : f.startsWith("확인_") ? "confirm" : isEmpDateField(f) ? "date" : "text";
  const empFieldLabel = (f: string) => f.startsWith("체크_") || f.startsWith("확인_") ? f.slice(3) : f;
  // 서명 대상에 선택 동의 항목이 있으면 라벨 매핑
  const CONSENT_LABELS: Record<string, string> = { 동의고유식별: "고유식별정보(외국인등록번호) 수집·이용", 동의채용정보: "채용정보 등 마케팅 정보 수신" };
  const consentKeys = signTarget?.extraFields ? Object.keys(CONSENT_LABELS).filter(k => k in signTarget.extraFields!) : [];

  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsTarget, setVersionsTarget] = useState<Contract | null>(null);
  const [versions, setVersions] = useState<ContractVersion[]>([]);

  const [approvalDetailsOpen, setApprovalDetailsOpen] = useState(false);
  const [approvalDetailsTarget, setApprovalDetailsTarget] = useState<Contract | null>(null);

  // 검색/필터
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());
  const [filterMonth, setFilterMonth] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSearchText, setFilterSearchText] = useState("");
  const [showHiddenRevoked, setShowHiddenRevoked] = useState(false);

  const fetchContracts = useCallback(async (filters?: any) => {
    const params = new URLSearchParams();
    const useFilters = filters || {
      year: filterYear,
      month: filterMonth,
      status: filterStatus,
      searchText: filterSearchText,
      showHiddenRevoked: showHiddenRevoked,
    };

    if (useFilters.year) params.append("year", useFilters.year);
    if (useFilters.month) params.append("month", useFilters.month);
    if (useFilters.status) params.append("status", useFilters.status);
    if (useFilters.searchText) params.append("searchText", useFilters.searchText);
    if (useFilters.showHiddenRevoked) params.append("showHiddenRevoked", "true");
    params.append("scope", "self"); // 개인 페이지: 본인 계약서만

    const res = await fetch(`/api/contracts?${params.toString()}`);
    const data = await res.json();
    setContracts(data.contracts || []);
    // (9/12) 결재 대기("내 승인 대기") 카드·요청 삭제 — 이 화면은 역할이 늘 EMPLOYEE 라 한 번도 그려지지 않던 죽은 코드.
    //   결재는 관리자 /admin/contract-approvals · 원장 /manager/team-contracts 에서 한다.
  }, [filterYear, filterMonth, filterStatus, filterSearchText, showHiddenRevoked]);

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

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      // 개인 페이지: 역할과 무관하게 본인 계약서만 표시 (작성/관리는 관리자·원장 페이지에서)
      setMyId(d.user?.id || "");
      setMyProfile({ address: d.user?.address || "", birthDate: d.user?.birthDate ? String(d.user.birthDate).slice(0, 10) : "" });
      setMySigUrl(d.user?.signatureUrl || "");
    });
  }, []);

  useEffect(() => {
    fetchContracts();
  }, [fetchContracts]);

  const [signSubmitting, setSignSubmitting] = useState(false); // 서명 처리 중 표시·중복 클릭 방지 (QA 2026-08-25)
  // 근로자 본인 서명 — 비밀번호 재확인 + 매번 직접 서명(#205-1·#205-2, 2026-09-11 디렉터). 결재자 서명은 지금처럼.
  const [signPassword, setSignPassword] = useState("");
  // 전자서명 동의(#205-3) + 문서를 끝까지 내려 봤는가(뷰어가 알려준다) — 서명 때 함께 기록된다
  const [signAgree, setSignAgree] = useState(false);
  const [docReadToEnd, setDocReadToEnd] = useState(false);
  const isEmpSign = !!signTarget && signTarget.userId === myId;
  // 창을 닫으면 본인 확인·동의·열람 표시를 모두 비운다 — 다음 문서가 이전 문서의 "끝까지 봄"을 물려받지 않게(묶음 ② 검증 2)
  useEffect(() => { if (!signOpen) { setSignPassword(""); setSignAgree(false); setDocReadToEnd(false); setViewerAtBottom(false); } }, [signOpen]);
  // 열람 알림(#205-4) — 서명 창을 열면 서버에 한 번 알린다(10분 안 중복은 서버가 하나로)
  useEffect(() => {
    if (!signOpen || !signTarget) return;
    fetch(`/api/contracts/${signTarget.id}/events`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "VIEWED" }),
    }).catch(() => {});
  }, [signOpen, signTarget]);
  async function handleSign(id: string, isApprover = false) {
    if (signSubmitting) return;
    // 저장된 서명 기본 모드(#127) — 패드가 마운트되지 않으므로 useSaved 로 전송 (검증관 C1).
    // 근로자 본인 서명은 저장 서명을 쓰지 않는다(#205-2 — 서버도 막는다)
    const useSaved = !isEmpSign && !!mySigUrl && !drawNewSig;
    if (!useSaved && (!sigRef.current || sigRef.current.isEmpty())) { toast.error("서명을 입력해주세요."); return; }
    if (isEmpSign && !signPassword) { toast.error("본인 확인을 위해 비밀번호를 입력해주세요."); return; }
    if (isEmpSign && !signAgree) { toast.error("전자서명 동의에 체크해주세요."); return; }
    // 프로필 미입력 항목이 있으면 입력 확인
    let profile: Record<string, string> | undefined;
    if (missingProfile.length) {
      profile = {};
      if (missingProfile.includes("주소")) {
        if (!profileInput.주소.trim()) { toast.error("주소를 입력해주세요."); return; }
        profile.주소 = profileInput.주소.trim();
      }
      if (missingProfile.includes("생년월일")) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(profileInput.생년월일)) { toast.error("생년월일을 입력해주세요."); return; }
        profile.생년월일 = profileInput.생년월일;
      }
    }
    // 직원 직접입력 필드(퇴사사유·지급희망일·지급금품 체크 등) — 문서에만 반영(프로필 저장 X)
    let fields: Record<string, string> | undefined;
    if (empFields.length) {
      fields = {};
      for (const f of empFields) {
        const type = empFieldType(f);
        if (type === "check") { fields[f] = empFieldInput[f] === "□" ? "□" : "☑"; continue; } // 기본 체크, 명시적 해제만 □
        if (type === "confirm") { // 설명확인 — 직접 체크해야 서명 가능
          if (empFieldInput[f] !== "☑") { toast.error(`"${empFieldLabel(f)}" 항목을 확인하고 체크해주세요.`); return; }
          fields[f] = "☑"; continue;
        }
        const v = (empFieldInput[f] || "").trim();
        const optional = f.includes("기타"); // 기타 내용 등 조건부 입력은 선택
        if (!v) { if (optional) { fields[f] = ""; continue; } toast.error(`${empFieldLabel(f)}을(를) 입력해주세요.`); return; }
        if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast.error(`${empFieldLabel(f)}을(를) YYYY-MM-DD 형식으로 입력해주세요.`); return; }
        // 주민등록번호는 반드시 13자리 (개선 제안 #74)
        if (f === "주민등록번호" && v.replace(/\D/g, "").length !== 13) { toast.error("주민등록번호 13자리를 정확히 입력해주세요."); return; }
        fields[f] = v;
      }
    }

    setSignSubmitting(true);
    try {
      const res = await fetch(`/api/contracts/${id}/sign`, {
        method: "POST",
        // 서명 창을 연 뒤 문서가 수정됐으면 서버가 거절한다(문서 버전 묶기, #206 검증 F2)
        headers: { "Content-Type": "application/json", ...(signTarget?.id === id ? (typeof (signTarget as { version?: number } | null)?.version === "number" ? { "x-doc-version": String((signTarget as { version?: number }).version) } : {}) : {}) },
        body: JSON.stringify({ ...(useSaved ? { useSaved: true } : { signatureData: sigRef.current!.toDataURL(), saveAsDefault: saveSig }), isApprover, ...(isEmpSign ? { password: signPassword, agree: true, readToEnd: docReadToEnd || viewerAtBottom } : {}), ...(consentKeys.length ? { consent: { ...consentChoices, 동의필수: "동의" } } : {}), ...(profile ? { profile } : {}), ...(fields ? { fields } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      // 입력한 프로필을 로컬에도 반영 (다음 계약서에서 다시 안 묻도록)
      if (profile) setMyProfile(p => ({ address: profile!.주소 ?? p.address, birthDate: profile!.생년월일 ?? p.birthDate }));
      toast.success(isApprover ? "계약 승인됨" : "서명 완료");
      setSignOpen(false);
      fetchContracts();
    } finally { setSignSubmitting(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">전자계약</h1>
      </div>

      {/* 직원 서명 대기 */}
      {contracts.filter(c => (c.status === "SENT" || c.status === "APPROVED") && c.approvalLine?.steps?.some(st => st.approverId === c.userId && st.status === "PENDING")).length > 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-base text-blue-700">내 서명 대기</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {contracts.filter(c => (c.status === "SENT" || c.status === "APPROVED") && c.approvalLine?.steps?.some(st => st.approverId === c.userId && st.status === "PENDING")).map(c => (
              <div key={c.id} className="flex items-center justify-between bg-white rounded-lg p-3 border border-blue-200">
                <div>
                  <p className="font-medium text-sm">{c.title}</p>
                  <ApprovalChain steps={c.approvalLine?.steps} userId={c.userId} />
                </div>
                <div className="flex gap-2">
                  <a href={viewHref(getFileUrl(c.fileUrl))} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline" className="gap-1"><Eye size={14} />보기</Button>
                  </a>
                  <Button size="sm" onClick={() => { setSignTarget(c); sigRef.current?.clear(); setConsentChoices({ 동의고유식별: c.extraFields?.동의고유식별 || "", 동의채용정보: c.extraFields?.동의채용정보 || "" }); setConsentRequired(false); setConsentRead(false); setDrawNewSig(false); setProfileInput({ 주소: "", 생년월일: "" }); setEmpFieldInput({}); setSignStep(1); setPreviewLoading(true); setSignOpen(true); }} className="gap-1">
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
                  <SelectItem value="REJECTED">반려</SelectItem>
                </SelectContent>
              </Select>
            </div>

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
                setFilterSearchText("");
                setShowHiddenRevoked(false);
                fetchContracts({ year: new Date().getFullYear().toString(), month: "", status: "", searchText: "", showHiddenRevoked: false });
              }}
            >
              초기화
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
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
                        {/* 완료된 계약은 서명·직인이 들어간 완료본 다운로드, 진행 중엔 브라우저 열람만 */}
                        {/* 완료본은 PDF로 — 다운로드 후 수정 방지 (디렉터 지시 2026-08-24) */}
                        {/* 진행 중이라도 내 서명이 반영된 진행본으로 열람 (#110) · 완료 후 접근은 문서별 정책 (#129) */}
                        {c.status === "SIGNED" && c.postSignAccess === "none" ? (
                          <span className="text-[11px] text-gray-400 px-1" title="사본이 필요하면 관리자에게 요청해주세요">제출 완료</span>
                        ) : (
                        <a href={c.status === "SIGNED" ? `/api/contracts/${c.id}/signed-document?pdf=1${c.postSignAccess === "view" ? "&inline=1" : ""}` : c.employeeSignedAt ? `/api/contracts/${c.id}/signed-document?pdf=1&inline=1` : viewHref(getFileUrl(c.fileUrl))} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" className="h-7">{c.status === "SIGNED" && c.postSignAccess !== "view" ? <Download size={12} /> : <Eye size={12} />}</Button></a>
                        )}
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 서명 모달 — 개인정보동의서는 2단계(동의 확인 → 서명), 그 외는 바로 서명 */}
      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        {/* 창을 확대하면 모달이 화면보다 길어져 하단 승인 버튼이 밀려 나가 서명을 못 하던 문제(#196) —
            높이를 화면 안으로 묶고 본문만 스크롤시킨다. */}
        <DialogContent className="max-w-2xl h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0"><DialogTitle>{consentKeys.length > 0 ? (signStep === 1 ? "개인정보 동의 확인" : "서명") : "서명"}</DialogTitle></DialogHeader>
          {signTarget && (
            <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1">
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <p className="text-sm font-medium">{signTarget.title}</p>
                <p className="text-xs text-gray-500">{signTarget.user.branch ? `[${signTarget.user.branch}] ` : ''}{signTarget.user.name}</p>
              </div>

              {/* ── 1단계: 개인정보동의서 동의 확인 ── */}
              {consentKeys.length > 0 && signStep === 1 && (
                <>
                  <button type="button" onClick={() => { setViewerAtBottom(false); setDocViewerOpen(true); }}
                    className={`flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg border text-sm font-medium ${consentRead ? "border-green-300 text-green-700 bg-green-50" : "border-indigo-300 text-indigo-700 hover:bg-indigo-50"}`}>
                    <Eye size={15} />{consentRead ? "전문 확인 완료 (다시 보기)" : "동의서 전문 보기 (필수)"}
                  </button>
                  {/* 필수 항목도 명시적 동의 — 자동 처리는 개인정보보호법 위반 (#104, 2026-08-27) */}
                  <label className="flex items-start gap-2 rounded-lg border border-gray-300 bg-gray-50 p-3 text-xs text-gray-700 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={consentRequired} onChange={e => setConsentRequired(e.target.checked)} />
                    <span><b>[필수]</b> 개인정보 수집·이용, 민감정보, 퇴직 후 보유, 제3자 제공에 <b>동의합니다</b>. (동의하지 않으면 채용이 취소·제한될 수 있습니다)</span>
                  </label>
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                    {/* 괄호 안내가 미동의를 권유하는 것처럼 읽혀 중립 문구로 교체 (#181, 2026-08-31 김가산) */}
                    <p className="text-xs font-semibold text-amber-800">선택 동의 항목</p>
                    <p className="text-[11px] text-amber-700">동의 여부와 관계없이 채용 절차에 영향을 주지 않습니다.</p>
                    {consentKeys.map(k => (
                      <div key={k} className="space-y-1">
                        <p className="text-xs text-gray-700">{CONSENT_LABELS[k]}</p>
                        <div className="flex gap-3 text-sm">
                          {["동의", "미동의"].map(opt => (
                            <label key={opt} className="flex items-center gap-1 cursor-pointer">
                              <input type="radio" checked={consentChoices[k] === opt}
                                onChange={() => setConsentChoices(prev => ({ ...prev, [k]: opt }))} />
                              {opt}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* 프로필 미입력(생년월일 등)도 이 단계에서 */}
                  {missingProfile.length > 0 && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-2">
                      <p className="text-xs font-semibold text-blue-800">필요한 정보 입력 (프로필에 저장됩니다)</p>
                      {missingProfile.includes("주소") && (
                        <div className="space-y-1"><Label className="text-xs">주소</Label>
                          <input className="w-full border rounded px-2 py-1.5 text-sm" placeholder="예: 서울시 강남구 테헤란로 123"
                            value={profileInput.주소} onChange={e => setProfileInput(p => ({ ...p, 주소: e.target.value }))} /></div>
                      )}
                      {missingProfile.includes("생년월일") && (
                        <div className="space-y-1"><Label className="text-xs">생년월일</Label>
                          <input type="date" className="w-full border rounded px-2 py-1.5 text-sm"
                            value={profileInput.생년월일} onChange={e => setProfileInput(p => ({ ...p, 생년월일: e.target.value }))} /></div>
                      )}
                    </div>
                  )}
                  {/* 막힌 이유를 버튼 위에 그대로 보여준다 — 토스트로만 알리면 왜 안 되는지 모른다 (#164).
                      선택 항목 미동의는 경고·확인창 없이 "선택 여부만" 안내한다(동의 유도 금지) */}
                  {(() => {
                    const blockReason =
                      !consentRead ? "동의서 전문을 끝까지 확인해주세요"
                      : !consentRequired ? "필수 항목에 동의해야 서명을 진행할 수 있습니다. 동의하지 않는 경우 채용이 취소·제한될 수 있습니다"
                      : consentKeys.some(k => consentChoices[k] !== "동의" && consentChoices[k] !== "미동의") ? "선택 항목의 동의 여부를 선택해주세요"
                      : null;
                    return (
                      <div className="space-y-2">
                        {blockReason && <p className="text-xs text-gray-500 text-right">{blockReason}</p>}
                        <div className="flex gap-2 justify-end">
                          <Button variant="outline" onClick={() => setSignOpen(false)}>취소</Button>
                          <Button
                            disabled={!!blockReason}
                            onClick={() => {
                              // 프로필 입력 검증 후 서명 단계로
                              if (missingProfile.includes("주소") && !profileInput.주소.trim()) { toast.error("주소를 입력해주세요."); return; }
                              if (missingProfile.includes("생년월일") && !/^\d{4}-\d{2}-\d{2}$/.test(profileInput.생년월일)) { toast.error("생년월일을 입력해주세요."); return; }
                              setSignStep(2);
                            }}>확인 완료 · 서명하기 →</Button>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}

              {/* ── 서명 단계 (2단계 또는 동의 없는 문서) ── */}
              {(consentKeys.length === 0 || signStep === 2) && (
                <>
                  {/* 동의 없는 문서(근로계약서·비밀유지)의 프로필 미입력 항목 */}
                  {consentKeys.length === 0 && missingProfile.length > 0 && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-2">
                      <p className="text-xs font-semibold text-blue-800">계약서에 필요한 정보를 입력해주세요 (프로필에 저장됩니다)</p>
                      {missingProfile.includes("주소") && (
                        <div className="space-y-1"><Label className="text-xs">주소</Label>
                          <input className="w-full border rounded px-2 py-1.5 text-sm" placeholder="예: 서울시 강남구 테헤란로 123"
                            value={profileInput.주소} onChange={e => setProfileInput(p => ({ ...p, 주소: e.target.value }))} /></div>
                      )}
                      {missingProfile.includes("생년월일") && (
                        <div className="space-y-1"><Label className="text-xs">생년월일</Label>
                          <input type="date" className="w-full border rounded px-2 py-1.5 text-sm"
                            value={profileInput.생년월일} onChange={e => setProfileInput(p => ({ ...p, 생년월일: e.target.value }))} /></div>
                      )}
                    </div>
                  )}
                  {/* 직원 직접입력 필드(퇴사사유·지급희망일·지급금품 체크 등) */}
                  {empFields.length > 0 && (
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 space-y-2">
                      <p className="text-xs font-semibold text-indigo-800">아래 항목을 직접 작성해주세요</p>
                      {empFields.some(f => empFieldType(f) === "check") && (
                        <p className="text-xs font-medium text-gray-600 pt-1">지급금품 <span className="text-gray-400 font-normal">(해당 항목 체크)</span></p>
                      )}
                      {empFields.map(f => {
                        const type = empFieldType(f);
                        if (type === "check" || type === "confirm") {
                          // check = 기본 체크(해제 가능), confirm = 기본 해제(직접 체크 필수)
                          const checked = type === "check" ? empFieldInput[f] !== "□" : empFieldInput[f] === "☑";
                          return (
                            <label key={f} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input type="checkbox" checked={checked}
                                onChange={e => setEmpFieldInput(p => ({ ...p, [f]: e.target.checked ? "☑" : "□" }))} />
                              {empFieldLabel(f)}
                            </label>
                          );
                        }
                        return (
                          <div key={f} className="space-y-1"><Label className="text-xs">{empFieldLabel(f)}</Label>
                            {type === "date" ? (
                              <input type="date" className="w-full border rounded px-2 py-1.5 text-sm"
                                value={empFieldInput[f] || ""} onChange={e => setEmpFieldInput(p => ({ ...p, [f]: e.target.value }))} />
                            ) : f === "주민등록번호" ? (
                              // 숫자만 입력받아 하이픈 자동 삽입 + 13자리 제한 (개선 제안 #74)
                              <input type="text" inputMode="numeric" className="w-full border rounded px-2 py-1.5 text-sm"
                                placeholder="숫자만 입력 (하이픈 자동)" maxLength={14}
                                value={empFieldInput[f] || ""} onChange={e => setEmpFieldInput(p => ({ ...p, [f]: formatRrn(e.target.value) }))} />
                            ) : (
                              <textarea rows={2} className="w-full border rounded px-2 py-1.5 text-sm" placeholder={`${empFieldLabel(f)} 입력`}
                                value={empFieldInput[f] || ""} onChange={e => setEmpFieldInput(p => ({ ...p, [f]: e.target.value }))} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* 무슨 내용에 서명하는지 같은 화면에서 보이게 — 내용 미리보기 내장 (QA 2026-08-25, 김가산) */}
                  {consentKeys.length === 0 && (
                    <>
                      {/* 미리보기 아무 데나 클릭하면 크게 보기 (개선 제안 #73)
                          38vh 였을 땐 A4 한 장이 통째로 줄어들어 본문 글씨가 1~2px 이 됐다 —
                          "확대하지 않은 상태에서도 조항이 읽혀야 한다"는 지적(#180)에 따라 높이를 키웠다.
                          변환 PDF 는 글꼴이 박힌 벡터 문서라 확대하면 선명하다(해상도 문제가 아니었다). */}
                      <div className="relative">
                        <PdfViewer url={pdfSrc(getFileUrl(signTarget.fileUrl))}
                          className="w-full border rounded" style={{ height: "52vh" }}
                          onLoaded={() => setPreviewLoading(false)}
                          onReachEnd={() => setDocReadToEnd(true)} />
                        <button type="button" onClick={() => { setZoomLoading(true); setPreviewZoom(true); }} title="클릭하여 크게 보기"
                          className="absolute inset-0 cursor-zoom-in flex items-start justify-end p-2">
                          <span className="text-[11px] bg-black/60 text-white rounded-full px-2.5 py-1 shadow">🔍 클릭하면 크게 보입니다</span>
                        </button>
                        {/* 로딩 중 빈 화면이면 오류인지 대기 중인지 구분이 안 된다는 지적 (#179) */}
                        {previewLoading && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 pointer-events-none">
                            <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-500" />
                            <span className="text-xs text-gray-500">문서를 불러오는 중입니다…</span>
                          </div>
                        )}
                      </div>
                      <a href={viewHref(getFileUrl(signTarget.fileUrl))} target="_blank" rel="noreferrer" className="text-xs text-blue-600">크게 보기 (새 창)</a>
                    </>
                  )}
                  {/* 저장된 서명이 있으면 기본으로 표시, 새로 그리기는 선택 (#127) */}
                  {!isEmpSign && mySigUrl && !drawNewSig ? (
                    <div className="space-y-2">
                      <Label>저장된 내 서명</Label>
                      <div className="border rounded-lg bg-white p-2 flex items-center justify-center h-24">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={mySigUrl} alt="저장된 서명" className="max-h-20 object-contain" />
                      </div>
                      <button type="button" className="text-xs text-blue-600 underline" onClick={() => { setDrawNewSig(true); sigRef.current?.clear(); }}>
                        수정하기 (새로 그리기 — 저장 서명 교체)
                      </button>
                    </div>
                  ) : (
                  <div className="space-y-2">
                    <Label>서명 *</Label>
                    <SignaturePad ref={sigRef} />
                    {/* 서명 재사용 저장 (개선 제안 #75) */}
                    <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                      <input type="checkbox" checked={saveSig} onChange={e => setSaveSig(e.target.checked)} />
                      이 서명을 저장해두고 다음 서명 때 재사용
                    </label>
                  </div>
                  )}
                  {/* 본인 확인 — 근로자 본인 서명만(#205-1). 결재자 서명은 지금처럼 */}
                  {isEmpSign && (
                    <div className="space-y-1">
                      <Label>본인 확인 — 비밀번호 *</Label>
                      <Input type="password" autoComplete="current-password" value={signPassword}
                        onChange={e => setSignPassword(e.target.value)} placeholder="로그인 비밀번호" />
                      <p className="text-[11px] text-gray-400">본인이 직접 서명하는지 확인합니다. 비밀번호는 저장되지 않습니다.</p>
                    </div>
                  )}
                  {/* 전자서명 동의(#205-3) — 근로자 본인 서명만. 문구는 서버 기록과 같은 상수 */}
                  {isEmpSign && (
                    <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer rounded border border-indigo-200 bg-indigo-50 p-2">
                      <input type="checkbox" className="mt-0.5" checked={signAgree} onChange={e => setSignAgree(e.target.checked)} />
                      <span><b>[필수]</b> {SIGN_CONSENT_TEXT}</span>
                    </label>
                  )}
                  {/* 스크롤해도 항상 보이도록 하단에 붙인다 (#196) */}
                  <div className="flex gap-2 justify-end sticky bottom-0 bg-white pt-3 pb-1 -mx-1 px-1 border-t">
                    {consentKeys.length > 0 && <Button variant="outline" onClick={() => setSignStep(1)}>← 이전</Button>}
                    <Button variant="outline" onClick={() => setSignOpen(false)}>취소</Button>
                    {/* 조건이 다르면 그냥 안 누르고 버티는 대신 사유를 남긴다 (2026-09-04) */}
                    <Button variant="ghost" className="text-red-600 hover:bg-red-50"
                            onClick={() => { setRejectReason(""); setRejectOpen(true); }}>
                      서명 거부
                    </Button>
                    <Button onClick={() => handleSign(signTarget.id, signTarget.status === "APPROVED")} disabled={signSubmitting}>{signSubmitting ? "서명 중..." : "서명"}</Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 미리보기 확대 — 미리보기를 클릭하면 크게 (개선 제안 #73) */}
      <Dialog open={previewZoom} onOpenChange={setPreviewZoom}>
        <DialogContent className="!max-w-[96vw] w-[96vw] h-[94vh] sm:!max-w-[96vw] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b shrink-0">
            <DialogTitle className="text-base">{signTarget?.title || "계약서"}</DialogTitle>
          </DialogHeader>
          {signTarget && previewZoom && (
            <div className="relative flex-1 min-h-0">
              <PdfViewer url={pdfSrc(getFileUrl(signTarget.fileUrl))} className="h-full w-full"
                onLoaded={() => setZoomLoading(false)} />
              {zoomLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 pointer-events-none">
                  <span className="h-7 w-7 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-500" />
                  <span className="text-xs text-gray-500">문서를 불러오는 중입니다…</span>
                </div>
              )}
            </div>
          )}
          <div className="px-4 py-3 border-t shrink-0 flex justify-end">
            <Button onClick={() => setPreviewZoom(false)} variant="outline">닫기</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 동의서 전문 인앱 뷰어 — 다 읽고 "확인"을 누르면 동의 화면으로 복귀 */}
      <Dialog open={docViewerOpen} onOpenChange={setDocViewerOpen}>
        <DialogContent className="!max-w-[96vw] w-[96vw] h-[94vh] sm:!max-w-[96vw] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b shrink-0">
            <DialogTitle className="text-base">동의서 전문 — 끝까지 확인해주세요</DialogTitle>
          </DialogHeader>
          {signTarget && docViewerOpen && (
            /* 내장 PDF 뷰어(iframe)는 스크롤 위치를 바깥에 알려주지 않아 최소 열람 시간(8초)으로
               대체했었다. PdfViewer 는 스크롤을 직접 다루므로 끝까지 읽었는지 정확히 판정한다 (#182). */
            <PdfViewer
              url={pdfSrc(getFileUrl(signTarget.fileUrl))}
              className="flex-1 w-full"
              onReachEnd={() => setViewerAtBottom(true)}
            />
          )}
          <div className="px-4 py-3 border-t shrink-0 flex items-center justify-between gap-3">
            <span className="text-xs text-gray-400">{viewerAtBottom ? "확인이 완료되었습니다." : "동의서를 끝까지 내려서 읽어주세요."}</span>
            <Button disabled={!viewerAtBottom} onClick={() => { setConsentRead(true); setDocViewerOpen(false); }} className="bg-indigo-600 hover:bg-indigo-700">
              확인 (다 읽었습니다) →
            </Button>
          </div>
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
                          {v.createdByUser.name} · {format(new Date(v.createdAt), "yyyy-MM-dd HH:mm")} 수정
                        </p>
                        {/* 무엇을 무엇에서 무엇으로(#206-6) — 이 기능 전의 버전에는 기록이 없다 */}
                        {v.reason && <p className="text-xs text-amber-700 mt-0.5">{v.reason}</p>}
                        {Array.isArray(v.changes) && v.changes.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {v.changes.map((c, i) => (
                              <li key={i} className="text-xs text-gray-700 break-all">
                                <span className="text-gray-400">{c.field}</span> {c.from ?? "(없음)"} → <b>{c.to ?? "(없음)"}</b>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs">
                        이전 버전
                      </Badge>
                    </div>
                    <a href={viewHref(getFileUrl(v.fileUrl))} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline" className="w-full gap-1">
                        <Eye size={12} />보기
                      </Button>
                    </a>
                  </div>
                ))
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 결재 히스토리 모달 */}
      <Dialog open={approvalDetailsOpen} onOpenChange={setApprovalDetailsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-between w-full gap-2">
              <DialogTitle>결재 히스토리</DialogTitle>
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
                      <p className="text-xs text-gray-500">{step.approver?.name || (step as { externalName?: string }).externalName || "외부 서명자"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {step.status === "APPROVED" ? (
                        <Badge className="bg-green-100 text-green-700">승인됨</Badge>
                      ) : step.status === "PENDING" ? (
                        <Badge variant="outline" className="text-orange-600">대기</Badge>
                      ) : step.status === "REJECTED" ? (
                        <Badge variant="destructive">반려</Badge>
                      ) : (
                        <Badge variant="outline">미정</Badge>
                      )}
                    </div>
                  </div>
                  {step.decidedAt && (
                    <p className="text-xs text-gray-500">
                      {format(new Date(step.decidedAt), "yyyy-MM-dd HH:mm")}
                    </p>
                  )}
                  {/* ⚠ 반려 사유가 화면 어디에도 안 보였다 — DB(step.comment)에는 남는데
                      사람에게 닿는 길이 봇 DM 하나뿐이었고, 그 DM 이 실패하면 사유가 제품
                      안에서 영영 도달 불가였다(2026-09-04 검증관 F2). 여기서 보여준다. */}
                  {step.status === "REJECTED" && (step as { comment?: string | null }).comment && (
                    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 whitespace-pre-wrap">
                      <strong>반려 사유:</strong> {(step as { comment?: string | null }).comment}
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
                    <a href={`/api/contracts/${approvalDetailsTarget.id}/signed-document?pdf=1`} className="block">
                      <Button className="w-full gap-1 bg-green-600 hover:bg-green-700"><Download size={14} />서명 완료본 다운로드</Button>
                    </a>
                  )}
                </div>
              )}

              {/* 회수·반려 이력 */}
              {approvalDetailsTarget.revocationLog && Array.isArray(approvalDetailsTarget.revocationLog) && approvalDetailsTarget.revocationLog.length > 0 && (
                <div className="space-y-3 pt-2 border-t">
                  <p className="text-sm font-medium text-red-600">회수·반려 이력</p>
                  {approvalDetailsTarget.revocationLog.map((log: any, idx: number) => {
                    // ⚠ 반려는 rejectedBy/rejectedAt, 회수는 revokedBy/revokedAt 으로 남는다.
                    //   종전에는 회수 키만 읽어, 반려 건에서 `format(Invalid Date)` 가 **예외를
                    //   던져 페이지가 통째로 죽었다**(date-fns v4, 2026-09-04 검증관 F1).
                    //   항목 모양이 또 늘 수 있으니 날짜는 유효성까지 확인하고 그린다.
                    const isReject = log.type === "reject";
                    const at = new Date(log.rejectedAt ?? log.revokedAt ?? NaN);
                    const when = isNaN(at.getTime()) ? "시각 미상" : format(at, "yyyy-MM-dd HH:mm");
                    // reset(서명 후 수정)·resend(재발송)는 초기화 직전 결재를 signers 로 함께 남긴다(#206, 2026-09-11).
                    // 반려는 9/11 부터 최종이 아니다(고쳐서 다시 보낼 수 있다) — "계약 종료" 문구를 뺐다.
                    const what = isReject
                      ? `${log.stepOrder}단계 반려`
                      : log.type === "reset" ? "내용 수정으로 결재 초기화"
                      : log.type === "resend" ? "재발송으로 결재 초기화"
                      : log.type === "employee" ? "직원 서명 회수" : `${log.stepOrder}단계 결재 회수`;
                    return (
                      <div key={idx} className="bg-red-50 border border-red-200 rounded p-2 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="text-xs font-medium text-red-700">{what}</p>
                            <p className="text-xs text-red-600">
                              {/* 처리자 이름은 이 화면에 직원 목록이 없어 종전에도 늘 이 문구였다(9/12 죽은 코드 정리 — 표시 그대로) */}
                              알 수 없는 사용자 · {when}
                            </p>
                          </div>
                        </div>
                        <p className="text-xs text-red-700 bg-white rounded p-2 border border-red-100 whitespace-pre-wrap">
                          <strong>사유:</strong> {log.reason || "사유 없음"}
                          {Array.isArray(log.signers) && log.signers.length > 0 && (
                            <span className="block mt-1 text-gray-600">
                              초기화 전 결재: {log.signers.map((x: { order: number; name: string; status: string; decidedAt?: string | null }) => {
                                const d = new Date(x.decidedAt ?? NaN);
                                return `${x.order}단계 ${x.name} ${x.status === "REJECTED" ? "반려" : "서명"}${isNaN(d.getTime()) ? "" : ` ${format(d, "MM-dd HH:mm")}`}`;
                              }).join(" · ")}
                            </span>
                          )}
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

      {/* 서명 거부 확인 — 되돌릴 수 없으므로 사유를 받는다 (2026-09-04 디렉터 결정) */}
      <Dialog open={rejectOpen} onOpenChange={(o) => { setRejectOpen(o); if (!o) setRejectReason(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>서명 거부</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-gray-700">
              <div className="font-medium">{signTarget?.title}</div>
              <p className="mt-2 text-red-600">
                거부하면 결재가 멈추고 관리자에게 사유가 전달됩니다. 관리자가 내용을 고쳐 다시 보내면 처음부터 다시 진행됩니다.
              </p>
            </div>
            <div>
              <label className="text-sm mb-1 block font-medium">거부 사유 <span className="text-red-500">*</span></label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="어디가 다른지 적어 주세요. 관리자에게 그대로 전달됩니다."
                rows={4}
                maxLength={500}
                autoFocus
              />
              <div className="text-xs text-gray-400 text-right mt-1">{rejectReason.length}/500</div>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setRejectOpen(false)}>취소</Button>
            <Button variant="destructive" disabled={!rejectReason.trim() || rejectSubmitting} onClick={handleReject}>
              {rejectSubmitting ? "처리 중..." : "거부하기"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}