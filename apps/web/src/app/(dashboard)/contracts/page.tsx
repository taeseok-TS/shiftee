"use client";
import { ReauthPasswordInput } from "@/components/ui/reauth-password-input";
import { SIGN_CONSENT_TEXT } from "@/lib/contract-consent";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { FileSignature, PenLine, Eye, Loader2 } from "lucide-react";
import { PageHead, Btn, btnClass, Box, FilterRow, inputClass, tableClass, StatusPill, FlowDots, type PillTone, type FlowStep } from "@/components/kit";
import { format } from "date-fns";
import { toast } from "sonner";
import PdfViewer from "@/components/PdfViewer";
import ApprovalFullView from "@/components/contracts/ApprovalFullView";
import ApprovalFullViewHost, { type HostContract } from "@/components/contracts/ApprovalFullViewHost";

const DOC_LABEL: Record<string, string> = { EMPLOYMENT: "근로계약서", PART_TIME: "단시간근로계약서", CONFIDENTIAL: "비밀유지", OTHER: "기타" };

type ApprovalItem = {
  id: string; title: string; fileUrl: string; status: string;
  startDate?: string | null; endDate?: string | null;
  extraFields?: Record<string, string> | null;
  summaryFields?: Record<string, string> | null;
  userId?: string;
  externalName?: string | null; // 외부(게스트) 계약 — 소유자가 작성 관리자라 본인 계약과 구별해야 한다
  user?: { id?: string; name?: string; branch?: string | null } | null;
};

type Contract = {
  id: string;
  postSignAccess?: string; // 서명 완료 후 근로자 접근: full | view | none (#129)
  userId: string;
  externalName?: string | null; // 외부(게스트) 계약이면 게스트 이름 — userId 는 작성 관리자라 본인 서명과 구별해야 한다
  title: string;
  type: string;
  fileUrl: string;
  status: string;
  extraFields?: Record<string, string> | null; // 개인정보동의서 선택 동의 등
  summaryFields?: Record<string, string> | null; // 그 문서 양식 칸만 추린 요약(서버 계산) — 폰 카드 「연봉」
  sendMessage?: string | null; // 본부 발송 메시지(#65)
  isTest?: boolean; // 나에게 테스트 발송(#67) 시험 문서 — 관리자 본인이 서명자
  profileFields?: string[] | null; // 이 계약서가 쓰는 프로필 필드 (주소/생년월일)
  employeeFields?: string[] | null; // 직원이 서명 시 직접 입력하는 필드 (퇴사일자/퇴사사유 등)
  fieldTypes?: Record<string, { type: string; options?: string[] }> | null; // PDF 칸 배치(#22 2단계)의 칸 종류 — 체크박스·드롭다운·날짜
  employeeSignedAt?: string | null;
  signedAt: string | null;
  createdAt: string;
  user: { name: string; department: string | null; branch?: string | null };
  approvalLine?: {
    createdAt?: string;   // 결재선은 발송·재발송 때 새로 만든다 — 「받은 날」(시안 직원 내 계약서)
    steps: Array<{
      id: string;
      order: number;
      approverId: string;
      approver: { name: string; role?: string | null };
      status: string;
      decidedAt?: string | null;
    }>;
  };
  // 이 화면이 실제로 쓰는데 타입에서 빠져 있던 것들 (2026-09-03)
  startDate?: string | null;
  endDate?: string | null;
  signDeadline?: string | null;       // 서명 기한(#45) — 목록 「기한」 칸
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

// 상태 알약(시안 3-9 — 대기 주황 · 완료 파랑 · 반려 분홍 · 그 밖 회색). 내 서명 차례인 문서는 목록에서 「서명 대기」로 따로 적는다
const STATUS_PILL: Record<string, { tone: PillTone; label: string }> = {
  DRAFT: { tone: "gray", label: "초안" },
  SENT: { tone: "wait", label: "서명 대기" },   // 필터 「서명 대기」(SENT) · 「결재 중」(APPROVED)와 같은 말(검증 3)
  APPROVED: { tone: "wait", label: "결재 중" },
  SIGNED: { tone: "done", label: "체결 완료" },
  EXPIRED: { tone: "gray", label: "만료" },
  // 반려 — 2026-09-11 부터 최종이 아니다: 관리자가 고쳐(수정) 또는 그대로(재발송) 다시 보낼 수 있다(#206-4)
  REJECTED: { tone: "rej", label: "반려" },
};

// 날짜 칸(받은 날 · 기한) — 한국 시각 날짜. 올해면 「10/23」, 다른 해면 「2025/10/23」
function kstDay(iso?: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  const d = new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const thisYear = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 4);
  return (d.slice(0, 4) === thisYear ? d.slice(5) : d).replace(/-/g, "/");
}
// 폰 카드(시안 S1-4) 날짜 — 「10월 26일 (월)」, 올해가 아니면 「2027년 10월 25일 (월)」(공통 규칙 ■4: 요일 포함 · 해가 바뀌면 연도)
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
function longKDate(iso?: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const wd = WEEKDAY[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const thisYear = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
  return `${y === thisYear ? "" : `${y}년 `}${mo}월 ${d}일 (${wd})`;
}
// 좁은 칸 기한 「11/04 (수)」
function shortKDate(iso?: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  const k = new Date(t + 9 * 3600 * 1000);
  const thisYear = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
  const md = `${String(k.getUTCMonth() + 1).padStart(2, "0")}/${String(k.getUTCDate()).padStart(2, "0")} (${WEEKDAY[k.getUTCDay()]})`;
  return k.getUTCFullYear() === thisYear ? md : `${k.getUTCFullYear()}/${md}`;
}
// 연봉 「34,000,000원」 → 「3,400만 원」. 숫자 · 쉼표 · 원 · ₩ 만으로 된 값만 바꾼다 — 「3400만원」 「월 280만 원(연 3,360만 원)」처럼
// 단위 글자가 든 자유 입력은 그대로 보여 준다(단위를 모른 채 숫자만 긁으면 1/10,000 로 틀리게 보였다, 10/23 검증 1). 1억 이상은 「1억 2,000만 원」
function manWon(v?: string | null): string | null {
  const raw = (v || "").trim();
  if (!raw) return null;
  if (!/^[\s₩0-9,.원]+$/.test(raw)) return raw;
  const n = Math.round(Number(raw.replace(/[^0-9.]/g, "")));
  if (!Number.isFinite(n) || n <= 0) return raw;
  if (n < 10000) return `${n.toLocaleString()}원`;
  const eok = Math.floor(n / 100000000), man = Math.floor((n % 100000000) / 10000), rest = n % 10000;
  const parts = [eok ? `${eok.toLocaleString()}억` : "", man ? `${man.toLocaleString()}만` : "", rest ? `${rest.toLocaleString()}` : ""].filter(Boolean);
  return `${parts.join(" ")} 원`.replace(/(\d) 원$/, "$1원");
}

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

type ChainStep = { order: number; status: string; approverId: string; approver?: { name?: string } | null; externalName?: string | null };
function ApprovalChain({ steps, userId, onClick }: { steps?: ChainStep[]; userId?: string; onClick?: () => void }) {
  if (!steps || !Array.isArray(steps) || steps.length === 0) return null;
  // 결재 진행 = 사람마다 점 + 이름(시안 3-9 — 끝남 파랑 · 지금 차례 주황 · 남음 회색, 초록 체크 아이콘 없음). 실제 배치 순서대로.
  // 단계마다 「이름 직급」(10/16 이예지 재확인 3 — 근로자도 「직원」 대신 이름. 이름 표기는 서버 labelApproverNames)
  const dots: FlowStep[] = steps.map((step) => ({
    label: step.approver?.name || (step.approverId === userId ? "직원" : step.externalName || "외부 서명자"),
    state: step.status === "APPROVED" ? "done" : step.status === "PENDING" ? "now" : "todo",
  }));
  return (
    <button type="button" onClick={onClick} className="text-left hover:opacity-70" title="결재 진행 자세히">
      <FlowDots steps={dots} />
    </button>
  );
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [listLoading, setListLoading] = useState(true);   // 목록 불러오는 중(#217-1)
  const [myId, setMyId] = useState("");
  const [myRole, setMyRole] = useState("");   // 세션 역할 — 「내가 결재할 계약서」 상자는 직원(EMPLOYEE) 세션에만(관리자 · 원장은 결재함이 따로 있다, 2026-10-23 본부 ■1)
  const [myRoleName, setMyRoleName] = useState("결재자");   // 결재 전체 창의 내 단계 이름
  // 내 결재 대기(원장 대행 등) → 원장·본부와 같은 결재 전체 창(2026-10-21 본부 이예지 재요청 C)
  const [hostTarget, setHostTarget] = useState<Contract | null>(null);
  const [meLoaded, setMeLoaded] = useState(false); // 내 정보 조회가 끝났는지 — 실패해도 결재 대기 카드를 감추지 않는다(검증관 F3)

  const [signOpen, setSignOpen] = useState(false);
  const [signTarget, setSignTarget] = useState<Contract | null>(null);
  // 서명 거부(반려) — 조건이 다르면 종전에는 그냥 안 누르고 버티는 수밖에 없어
  // **이유가 어디에도 안 남았다**. 사유를 적어 거부하면 관리자에게 바로 알림이 간다
  // (디렉터 결정 2026-09-04). 반려는 최종 상태다.
  const [rejectOpen, setRejectOpen] = useState(false);
  // 내 결재 대기 — 결재자(원장·본부 등)로 내 차례인 남의 계약서. 앱 계약서 화면과 같은 구성(2026-09-16 디렉터 지시)
  const [myApprovals, setMyApprovals] = useState<ApprovalItem[]>([]);
  const [approverMode, setApproverMode] = useState(false); // 결재자 승인 서명 창인지(본인 서명과 절차가 다르다)
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
  const missingProfile = (signTarget?.userId === myId && !signTarget?.externalName ? (signTarget?.profileFields || []) : []).filter((f: string) =>
    f === "주소" ? !myProfile.address : f === "생년월일" ? !myProfile.birthDate : false);
  // 직원 직접입력 필드 — 본인(계약 대상 직원)이 서명할 때만 (원장/본부 결재 시엔 이미 채워짐)
  const empFields: string[] = (signTarget?.userId === myId && !signTarget?.externalName ? signTarget?.employeeFields : null) || [];
  const isEmpDateField = (f: string) => /일자|날짜|일$/.test(f);
  // 필드명으로 입력 타입 유추: 체크_→체크박스, ~일→날짜, 그 외→텍스트
  // 확인_ = 기본 해제·체크 필수(설명확인) / 체크_ = 기본 체크·해제 가능(지급금품)
  const empFieldType = (f: string): "check" | "confirm" | "consent" | "date" | "text" | "box" | "select" => {
    // PDF 칸 배치(#22 2단계)는 칸 종류를 안다 — 이름 접두가 없어도 체크박스(기본 해제·선택)·드롭다운·날짜로 그린다
    const t = signTarget?.fieldTypes?.[f]?.type;
    if (t === "checkbox" && !/^(체크_|확인_|동의_)/.test(f)) return "box";
    if (t === "select") return "select";
    if (t === "date") return "date";
    return f.startsWith("체크_") ? "check" : f.startsWith("확인_") ? "confirm" : f.startsWith("동의_") ? "consent" : isEmpDateField(f) ? "date" : "text";
  };
  const empFieldLabel = (f: string) => f.startsWith("체크_") || f.startsWith("확인_") || f.startsWith("동의_") ? f.slice(3) : f;
  // 서명 대상에 선택 동의 항목이 있으면 라벨 매핑
  const CONSENT_LABELS: Record<string, string> = { 동의고유식별: "고유식별정보(외국인등록번호) 수집·이용", 동의채용정보: "채용정보 등 마케팅 정보 수신" };
  const consentKeys = signTarget?.extraFields && signTarget.userId === myId && !signTarget.externalName ? Object.keys(CONSENT_LABELS).filter(k => k in signTarget.extraFields!) : [];

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
  const [filtersOpen, setFiltersOpen] = useState(false);   // 찾기 줄 — 기본 접힘, 「찾기」 버튼으로 펼침(2026-10-23 본부 ■1 · ■4)
  const thisYearStr = new Date().getFullYear().toString();
  const activeFilterCount = [filterSearchText.trim(), filterMonth, filterStatus, showHiddenRevoked ? "1" : "", filterYear !== thisYearStr ? "1" : ""].filter(Boolean).length;

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

    setListLoading(true);
    const res = await fetch(`/api/contracts?${params.toString()}`).finally(() => setListLoading(false));
    const data = await res.json();
    setContracts(data.contracts || []);
    // 내 결재 대기 — 결재 차례가 온 남의 계약서(앱과 같은 API). 관리자·원장 화면에도 있지만 개인 화면에서도 보여준다.
    try {
      const ar = await fetch("/api/contracts/my-approvals");
      const ad = await ar.json();
      setMyApprovals(ar.ok ? (ad.contracts || []) : []);
    } catch { setMyApprovals([]); }
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
      setMeLoaded(true);
      // 개인 페이지: 역할과 무관하게 본인 계약서만 표시 (작성/관리는 관리자·원장 페이지에서)
      setMyId(d.user?.id || "");
      setMyRole(d.user?.role || "");
      setMyProfile({ address: d.user?.address || "", birthDate: d.user?.birthDate ? String(d.user.birthDate).slice(0, 10) : "" });
      setMySigUrl(d.user?.signatureUrl || "");
      setMyRoleName(d.user?.role === "ADMIN" ? "본부" : d.user?.role === "MANAGER" ? "원장" : "결재자");
    }).catch(() => setMeLoaded(true));
  }, []);

  useEffect(() => {
    fetchContracts();
  }, [fetchContracts]);

  const [signSubmitting, setSignSubmitting] = useState(false); // 서명 처리 중 표시·중복 클릭 방지 (QA 2026-08-25)
  // 근로자 본인 서명 — 비밀번호 재확인 + 매번 직접 서명(#205-1·#205-2, 2026-09-11 디렉터).
  // 결재자 서명도 2026-10-16부터 비밀번호를 다시 확인한다(#220-3 본부 결정 — 저장 서명 원클릭은 그대로)
  const [signPassword, setSignPassword] = useState("");
  // 문서 열기 전 본인 확인(#20) — 확인하면 30분 동안 서명 때 비밀번호를 다시 묻지 않는다(서버가 기록으로 확인)
  const [unlocked, setUnlocked] = useState(false);
  const [unlockPw, setUnlockPw] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  // 확인 뒤 30분이 지나 서버가 비밀번호를 다시 요구하면 — 창(그린 서명·입력값)은 그대로 두고 비밀번호 칸만 다시 보인다(#20 검증 D3)
  const [needPw, setNeedPw] = useState(false);
  // 내 서명 창 열기 — 목록의 [서명]과 첫 화면(/contract-open)에서 넘어온 ?sign= 이 같은 길(시안 v2 5번)
  function openEmpSign(c: Contract) {
    setUnlocked(false);   // 앞 창의 확인 상태를 물려받지 않게(검증)
    setApproverMode(false); setSignTarget(c); sigRef.current?.clear(); setConsentChoices({ 동의고유식별: c.extraFields?.동의고유식별 || "", 동의채용정보: c.extraFields?.동의채용정보 || "" }); setConsentRequired(false); setConsentRead(false); setDrawNewSig(false); setProfileInput({ 주소: "", 생년월일: "" }); setEmpFieldInput({}); setSignStep(1); setPreviewLoading(true); setSignOpen(true);
    // 첫 화면에서(또는 30분 안에 같은 기기에서) 이미 확인했으면 비밀번호 칸을 건너뛴다 — 서명 때 서버가 같은 기준으로 다시 본다
    fetch(`/api/contracts/${c.id}/unlock`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.unlocked && openTargetRef.current === c.id) setUnlocked(true); }).catch(() => {});
    openTargetRef.current = c.id;
  }
  const openTargetRef = useRef<string | null>(null);
  // 첫 화면에서 넘어온 서류(?sign=) — 한 번만, 목록(올해 작성분 필터)과 상관없이 그 서류를 직접 불러와 연다(검증)
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current || !myId) return;
    deepLinkDone.current = true;
    const want = new URLSearchParams(window.location.search).get("sign");
    if (!want) return;
    window.history.replaceState(null, "", window.location.pathname);
    fetch(`/api/contracts?ids=${encodeURIComponent(want)}&scope=self`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      const c = ((d?.contracts || []) as Contract[]).find((x) => x.id === want && (x.status === "SENT" || x.status === "APPROVED") && x.userId === myId && !x.externalName && x.approvalLine?.steps?.some((st) => st.approverId === myId && st.status === "PENDING"));
      if (c) openEmpSign(c); else toast.info("그 서류는 지금 서명할 차례가 아닙니다. 아래 목록에서 확인해 주세요.");
    }).catch(() => {});
  }, [myId]);
  async function unlockDoc() {
    if (!signTarget || !unlockPw) return;
    setUnlocking(true);
    try {
      const res = await fetch(`/api/contracts/${signTarget.id}/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: unlockPw }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "본인 확인에 실패했습니다."); return; }
      setUnlocked(true); setUnlockPw("");
    } finally { setUnlocking(false); }
  }
  // 전자서명 동의(#205-3) + 문서를 끝까지 내려 봤는가(뷰어가 알려준다) — 서명 때 함께 기록된다
  const [signAgree, setSignAgree] = useState(false);
  const [docReadToEnd, setDocReadToEnd] = useState(false);
  // 외부 계약은 소유자가 작성 관리자라 userId 만 보면 본인 서명으로 오판된다 — 서버 sign 라우트와 같은 기준(검증관 F1)
  const isEmpSign = !!signTarget && signTarget.userId === myId && !signTarget.externalName;
  // 근로자 본인 서명 — 원장 승인과 같은 전체 창(2026-10-21 본부 이예지 재요청 C): 비밀번호로 문서를 연 뒤 한 쪽씩 보고 마지막 쪽 서명란에 서명.
  // 동의·주소·직접 입력·전자서명 동의는 창 오른쪽(확인할 것)에. 본문은 종전 미리보기와 같은 변환 PDF
  const empFull = signOpen && !!signTarget && isEmpSign && unlocked;
  const [empDoc, setEmpDoc] = useState<string | null>(null);
  const [empDocErr, setEmpDocErr] = useState<string | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- 창을 열고 닫을 때 본문 상태를 초기화하는 것이 목적이다 */
  useEffect(() => {
    setEmpDoc(null); setEmpDocErr(null);
    if (!empFull || !signTarget) return;
    const raw = getFileUrl(signTarget.fileUrl);
    if (!raw) return;
    let alive = true;
    let made: string | null = null;
    fetch(pdfSrc(raw)).then(async (r) => {
      const ct = r.headers.get("content-type") || "";
      if (!r.ok || !ct.includes("pdf")) throw new Error(r.status === 403 ? "문서를 열 권한이 없습니다." : "문서를 불러오지 못했습니다.");
      return r.blob();
    }).then((b) => { if (!alive) return; made = URL.createObjectURL(b); setEmpDoc(made); })
      .catch((e: unknown) => { if (alive) setEmpDocErr(e instanceof Error ? e.message : "문서를 불러오지 못했습니다."); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [empFull, signTarget]);
  /* eslint-enable react-hooks/set-state-in-effect */
  // 창을 닫으면 본인 확인·동의·열람 표시를 모두 비운다 — 다음 문서가 이전 문서의 "끝까지 봄"을 물려받지 않게(묶음 ② 검증 2)
  useEffect(() => { if (!signOpen) { setSignPassword(""); setSignAgree(false); setDocReadToEnd(false); setViewerAtBottom(false); setUnlocked(false); setUnlockPw(""); setNeedPw(false); } }, [signOpen]);
  // 열람 알림(#205-4) — 서명 창을 열면 서버에 한 번 알린다(10분 안 중복은 서버가 하나로)
  useEffect(() => {
    // 본인 서명이면 비밀번호 확인 뒤에 문서가 열리므로 그때 남긴다(#20 검증 D5)
    if (!signOpen || !signTarget || (isEmpSign && !unlocked)) return;
    fetch(`/api/contracts/${signTarget.id}/events`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "VIEWED" }),
    }).catch(() => {});
  }, [signOpen, signTarget, isEmpSign, unlocked]);
  // ov = 전체 창에서 넘긴 서명·비밀번호(근로자 본인 서명, 재요청 C). 전체 창은 마지막 쪽까지 봐야 낼 수 있어 readToEnd 도 참
  async function handleSign(id: string, isApprover = false, ov?: { signatureData?: string; password?: string }) {
    if (signSubmitting) return;
    // 저장된 서명 기본 모드(#127) — 패드가 마운트되지 않으므로 useSaved 로 전송 (검증관 C1).
    // 근로자 본인 서명은 저장 서명을 쓰지 않는다(#205-2 — 서버도 막는다)
    const useSaved = !ov && !isEmpSign && !!mySigUrl && !drawNewSig;
    const sigData = ov?.signatureData;
    if (!useSaved && !sigData && (!sigRef.current || sigRef.current.isEmpty())) { toast.error("서명을 입력해주세요."); return; }
    const pwv = ov?.password || signPassword;
    if ((!isEmpSign || !unlocked || needPw) && !pwv) { toast.error("본인 확인을 위해 비밀번호를 입력해주세요."); return; }
    if (ov && consentKeys.length && !consentRequired) { toast.error("필수 개인정보 항목에 동의해 주세요."); return; }
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
        if (type === "box") { fields[f] = empFieldInput[f] === "☑" ? "☑" : "□"; continue; } // PDF 체크박스 — 기본 해제, 선택
        if (type === "confirm") { // 설명확인 — 직접 체크해야 서명 가능
          if (empFieldInput[f] !== "☑") { toast.error(`"${empFieldLabel(f)}" 항목을 확인하고 체크해주세요.`); return; }
          fields[f] = "☑"; continue;
        }
        if (type === "consent") { // 동의함/동의하지 않음 중 하나를 반드시 고른다(추가 템플릿 8종)
          const v = empFieldInput[f];
          if (v !== "동의" && v !== "미동의") { toast.error(`"${empFieldLabel(f)}" 항목의 동의 여부를 선택해주세요.`); return; }
          fields[f] = v; continue;
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
        body: JSON.stringify({ ...(useSaved ? { useSaved: true } : { signatureData: sigData || sigRef.current!.toDataURL(), saveAsDefault: ov ? false : saveSig }), isApprover, ...(pwv ? { password: pwv } : {}), ...(isEmpSign ? { agree: true, readToEnd: !!ov || docReadToEnd || viewerAtBottom } : {}), ...(consentKeys.length ? { consent: { ...consentChoices, 동의필수: "동의" } } : {}), ...(profile ? { profile } : {}), ...(fields ? { fields } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "PASSWORD_REQUIRED" && isEmpSign) { setNeedPw(true); toast.error("확인한 지 30분이 지났습니다. 아래 비밀번호 칸에 다시 입력하고 서명해 주세요."); return; }
        toast.error(data.error); return;
      }
      // 입력한 프로필을 로컬에도 반영 (다음 계약서에서 다시 안 묻도록)
      if (profile) setMyProfile(p => ({ address: profile!.주소 ?? p.address, birthDate: profile!.생년월일 ?? p.birthDate }));
      toast.success(isApprover ? "계약 승인됨" : "서명 완료");
      setSignOpen(false);
      fetchContracts();
    } finally { setSignSubmitting(false); }
  }

  // 직원 직접입력 필드(퇴사사유·지급희망일·지급금품 체크 등) — 옛 서명 창과 전체 창(재요청 C)이 같이 쓴다
  const empFieldsBox = empFields.length > 0 ? (
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
                        if (type === "box") {   // PDF 칸 배치 체크박스 — 기본 해제, 고르면 ☑
                          return (
                            <label key={f} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input type="checkbox" checked={empFieldInput[f] === "☑"} onChange={e => setEmpFieldInput(p => ({ ...p, [f]: e.target.checked ? "☑" : "□" }))} />
                              {empFieldLabel(f)}
                            </label>
                          );
                        }
                        if (type === "select") {   // PDF 칸 배치 드롭다운 — 본부가 정한 선택지 중 하나
                          return (
                            <div key={f} className="space-y-1"><Label className="text-xs">{empFieldLabel(f)}</Label>
                              <select className="w-full border rounded px-2 py-1.5 text-sm bg-white" value={empFieldInput[f] || ""} onChange={e => setEmpFieldInput(p => ({ ...p, [f]: e.target.value }))}>
                                <option value="">선택</option>
                                {(signTarget?.fieldTypes?.[f]?.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                            </div>
                          );
                        }
                        if (type === "consent") {
                          return (
                            <div key={f} className="space-y-1"><Label className="text-xs">{empFieldLabel(f)}</Label>
                              <div className="flex gap-4 text-sm">
                                {[["동의", "동의함"], ["미동의", "동의하지 않음"]].map(([v, l]) => (
                                  <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                                    <input type="radio" checked={empFieldInput[f] === v} onChange={() => setEmpFieldInput(p => ({ ...p, [f]: v }))} />{l}
                                  </label>
                                ))}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div key={f} className="space-y-1"><Label className="text-xs">{empFieldLabel(f)}</Label>
                            {type === "date" ? (
                              <input type="date" max="9999-12-31" className="w-full border rounded px-2 py-1.5 text-sm"
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
  ) : null;
  // 직접 입력 칸이 덜 채워진 이유(handleSign 의 검사와 같은 기준 — 창 안 빨간 줄로 먼저 보인다)
  function empFieldsMissing(): string | null {
    for (const f of empFields) {
      const type = empFieldType(f);
      if (type === "check" || type === "box") continue;
      if (type === "confirm") { if (empFieldInput[f] !== "☑") return `「${empFieldLabel(f)}」을(를) 확인하고 체크해 주세요`; continue; }
      if (type === "consent") { if (empFieldInput[f] !== "동의" && empFieldInput[f] !== "미동의") return `「${empFieldLabel(f)}」 동의 여부를 골라 주세요`; continue; }
      const v = (empFieldInput[f] || "").trim();
      if (!v) { if (f.includes("기타")) continue; return `${empFieldLabel(f)}을(를) 넣어 주세요`; }
      if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${empFieldLabel(f)}을(를) YYYY-MM-DD 로 넣어 주세요`;
      if (f === "주민등록번호" && v.replace(/\D/g, "").length !== 13) return "주민등록번호 13자리를 넣어 주세요";
    }
    return null;
  }
  // 전체 창 오른쪽 「확인할 것」 — 개인정보 동의(필수·선택)·프로필 빈 칸·직접 입력·전자서명 동의. 서명 단추가 막힌 이유는 empBlock
  const empBlock = !empFull ? null
    : consentKeys.length > 0 && !consentRequired ? "필수 개인정보 항목에 동의해야 서명할 수 있습니다(동의하지 않으면 채용이 취소·제한될 수 있습니다)"
    : consentKeys.some(k => consentChoices[k] !== "동의" && consentChoices[k] !== "미동의") ? "선택 동의 항목의 동의 여부를 골라 주세요"
    : missingProfile.includes("주소") && !profileInput.주소.trim() ? "주소를 넣어 주세요"
    : missingProfile.includes("생년월일") && !/^\d{4}-\d{2}-\d{2}$/.test(profileInput.생년월일) ? "생년월일을 넣어 주세요"
    : empFieldsMissing() || (!signAgree ? "전자서명 동의에 체크해 주세요" : null);
  const empExtra = empFull ? (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="border-b pb-2 text-base font-bold text-gray-900">확인할 것</h2>
      {consentKeys.length > 0 && (
        <>
          {/* 필수 항목도 명시적 동의 — 자동 처리는 개인정보보호법 위반(#104). 전문은 왼쪽 문서(마지막 쪽까지 봐야 서명) */}
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-xs text-gray-700">
            <input type="checkbox" className="mt-0.5" checked={consentRequired} onChange={e => setConsentRequired(e.target.checked)} />
            <span><b>[필수]</b> 개인정보 수집·이용, 민감정보, 퇴직 후 보유, 제3자 제공에 <b>동의합니다</b>. (동의하지 않으면 채용이 취소·제한될 수 있습니다)</span>
          </label>
          <div className="space-y-2 rounded-lg border border-gray-200 p-2.5">
            <p className="text-xs font-semibold text-gray-700">선택 동의 항목 <span className="font-normal text-gray-500">— 동의 여부와 관계없이 채용 절차에 영향을 주지 않습니다</span></p>
            {consentKeys.map(k => (
              <div key={k} className="space-y-1">
                <p className="text-xs text-gray-700">{CONSENT_LABELS[k]}</p>
                <div className="flex gap-3 text-sm">
                  {["동의", "미동의"].map(opt => (
                    <label key={opt} className="flex cursor-pointer items-center gap-1">
                      <input type="radio" checked={consentChoices[k] === opt} onChange={() => setConsentChoices(prev => ({ ...prev, [k]: opt }))} />{opt}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {missingProfile.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-700">필요한 정보 <span className="font-normal text-gray-500">(프로필에 저장됩니다)</span></p>
          {missingProfile.includes("주소") && (
            <div className="space-y-1"><Label className="text-xs">주소</Label>
              <input className="w-full rounded border px-2 py-1.5 text-sm" placeholder="예: 서울시 강남구 테헤란로 123"
                value={profileInput.주소} onChange={e => setProfileInput(p => ({ ...p, 주소: e.target.value }))} /></div>
          )}
          {missingProfile.includes("생년월일") && (
            <div className="space-y-1"><Label className="text-xs">생년월일</Label>
              <input type="date" max="9999-12-31" className="w-full rounded border px-2 py-1.5 text-sm"
                value={profileInput.생년월일} onChange={e => setProfileInput(p => ({ ...p, 생년월일: e.target.value }))} /></div>
          )}
        </div>
      )}
      {empFieldsBox}
      {/* 전자서명 동의(#205-3) — 문구는 서버 기록과 같은 상수 */}
      <label className="flex cursor-pointer items-start gap-2 rounded border border-indigo-200 bg-indigo-50 p-2 text-xs text-gray-700">
        <input type="checkbox" className="mt-0.5" checked={signAgree} onChange={e => setSignAgree(e.target.checked)} />
        <span><b>[필수]</b> {SIGN_CONSENT_TEXT}</span>
      </label>
    </section>
  ) : null;

  // 내 결재 대기 — 결재자로서 내 차례인 남의 계약서(원장 대행 등). 본인 계약은 아래 목록의 [서명]으로
  const approvalsShown = myApprovals.filter((a) => ((a.userId ?? a.user?.id) !== myId || !!a.externalName));
  // 내 서명 차례 — 종전 「내 서명 대기」 카드와 같은 기준. 이제 목록 줄 오른쪽 인디고 [서명]으로 연다(시안 직원 내 계약서)
  const canSign = (c: Contract) => (c.status === "SENT" || c.status === "APPROVED") && !!c.approvalLine?.steps?.some(st => st.approverId === c.userId && st.status === "PENDING");
  const signCount = contracts.filter(canSign).length;
  // 줄 하나의 상태 · 열기 주소 · 버튼 — PC 표와 폰 카드(시안 S1-4)가 같은 규칙을 쓴다
  const rowOf = (c: Contract) => {
    const mineToSign = canSign(c);
    const pill = mineToSign ? { tone: "wait" as PillTone, label: "내 서명 차례" } : STATUS_PILL[c.status] || { tone: "gray" as PillTone, label: "미정" };
    // 완료된 계약은 서명·직인이 들어간 완료본 다운로드, 진행 중엔 브라우저 열람만
    // 완료본은 PDF로 — 다운로드 후 수정 방지 (디렉터 지시 2026-08-24)
    // 진행 중이라도 내 서명이 반영된 진행본으로 열람 (#110) · 완료 후 접근은 문서별 정책 (#129)
    const noAccess = c.status === "SIGNED" && c.postSignAccess === "none";
    // 본인 서명 차례 문서는 [서명하기] 창에서 비밀번호를 넣어야 열린다(#20) — 따로 여는 [보기]는 두지 않는다
    const lockedSelf = c.status !== "SIGNED" && !c.employeeSignedAt && c.userId === myId && !c.externalName
      && (c.approvalLine?.steps || []).some(s => s.approverId === myId && s.status === "PENDING");
    const canDownload = c.status === "SIGNED" && c.postSignAccess !== "view";
    const openHref = c.status === "SIGNED" ? `/api/contracts/${c.id}/signed-document?pdf=1${c.postSignAccess === "view" ? "&inline=1" : ""}` : c.employeeSignedAt ? `/api/contracts/${c.id}/signed-document?pdf=1&inline=1` : viewHref(getFileUrl(c.fileUrl));
    const onOpen = () => { if (c.status === "SIGNED") fetch(`/api/contracts/${c.id}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: c.postSignAccess === "view" ? "VIEWED" : "DOWNLOADED" }) }).catch(() => {}); };
    return { mineToSign, pill, noAccess, lockedSelf, canDownload, openHref, onOpen };
  };

  return (
    <div>
      {/* 머리(시안 3-3) — 제목 = 왼쪽 메뉴 이름 + 위 작은 경로 */}
      <PageHead crumb="전자계약 › 내 계약서" title="내 계약서" />

      {/* 내가 결재할 계약서 — 결재자(원장 대행 등)로서 내 차례인 계약서. 「열기」 = 원장·본부와 같은 결재 전체 창(재요청 C).
          직원 세션에만 — 관리자 · 원장이 직원 모드로 들어오면 숨긴다(결재함이 따로 있다). 내 정보를 못 받으면(역할 "") 감추지 않는다(검증관 F3) */}
      {meLoaded && myRole !== "ADMIN" && myRole !== "MANAGER" && approvalsShown.length > 0 && (
        <Box icon={<PenLine />} title="내가 결재할 계약서" count={approvalsShown.length} sub="원장 대행 등 결재자로 지정된 계약서" bodyClassName="px-6 py-1">
          {approvalsShown.map((c) => (
            <div key={c.id} className="flex items-center gap-3.5 border-t border-[#f1f5f9] py-[15px] first:border-t-0">
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[16px] font-bold text-[#0f172a]">{c.title}</b>
                <span className="block text-[13.5px] text-[#596578]">
                  {c.externalName ? `[외부] ${c.externalName}` : c.user?.name}{!c.externalName && c.user?.branch ? ` · ${c.user.branch}` : ""}
                  {c.startDate || c.endDate ? ` · 계약기간 ${String(c.startDate || "?").slice(0, 10)} ~ ${String(c.endDate || "?").slice(0, 10)}` : ""}
                </span>
                {Object.entries(c.summaryFields || c.extraFields || {}).length > 0 && (
                  <span className="block text-[12.5px] text-[#596578]">
                    {Object.entries(c.summaryFields || c.extraFields || {}).map(([k, v]) => `${k} ${v}`).join(" · ")}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <a href={viewHref(getFileUrl(c.fileUrl))} target="_blank" rel="noreferrer" className={btnClass("secondary", "px-3.5 py-1.5")}>보기</a>
                <Btn kind="primary" className="px-3.5 py-1.5" onClick={() => setHostTarget(c as unknown as Contract)}>열기</Btn>
              </div>
            </div>
          ))}
        </Box>
      )}

      {/* 계약서 목록(시안 직원 내 계약서) — 표: 서류 · 상태 알약 · 결재 진행 · 받은 날 · 기한 · 처리(서명 차례 = 인디고 「서명」, 끝난 문서 = 흰 「받기」) */}
      <Box icon={<FileSignature />} title="계약서 목록" count={signCount} sub={listLoading ? "불러오는 중…" : signCount > 0 ? `${contracts.length}건 · 서명 대기 ${signCount}건` : `${contracts.length}건`}
        right={
          // 찾기 — 기본 접힘(■4 「찾기 칸은 접어 두기」). 걸린 조건 수를 배지로
          <Btn onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen} className="px-3 py-1.5">
            찾기{activeFilterCount > 0 && <em className="rounded-full bg-[#eef2ff] px-[7px] text-[12px] not-italic leading-[19px] text-[#4f46e5]">{activeFilterCount}</em>}
          </Btn>
        }>
        {/* 필터 한 줄(시안 3-8) — 찾기 · 연도 · 월 · 상태 + 오른쪽 숨긴 결재 포함 · 초기화. 「찾기」를 눌렀을 때만 */}
        {filtersOpen && <FilterRow right={
          <span className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[13px] text-[#475569]">
              <input type="checkbox" checked={showHiddenRevoked} onChange={(e) => setShowHiddenRevoked(e.target.checked)} />숨긴 결재 포함
            </label>
            <button
              type="button"
              className={btnClass("text", "text-[13px]")}
              onClick={() => {
                setFilterYear(new Date().getFullYear().toString());
                setFilterMonth("");
                setFilterStatus("");
                setFilterSearchText("");
                setShowHiddenRevoked(false);
                fetchContracts({ year: new Date().getFullYear().toString(), month: "", status: "", searchText: "", showHiddenRevoked: false });
              }}
            >
              필터 초기화
            </button>
          </span>
        }>
          <input type="search" value={filterSearchText} onChange={(e) => setFilterSearchText(e.target.value)} placeholder="서류 이름으로 찾기" className={`${inputClass} w-56`} aria-label="찾기" />
          <select value={filterYear} onChange={(e) => { setFilterYear(e.target.value); setFilterMonth(""); }} className={inputClass} aria-label="연도">
            {[2026, 2025, 2024, 2023, 2022, 2021, 2020].map(year => (
              <option key={year} value={year.toString()}>{year}년</option>
            ))}
          </select>
          <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} disabled={!filterYear} className={inputClass} aria-label="월">
            <option value="">전체 월</option>
            {Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0')).map(month => (
              <option key={month} value={month}>{month}월</option>
            ))}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={inputClass} aria-label="상태">
            <option value="">상태: 전체</option>
            <option value="DRAFT">초안</option>
            <option value="SENT">서명 대기</option>
            <option value="APPROVED">결재 중</option>
            <option value="SIGNED">체결 완료</option>
            <option value="EXPIRED">만료</option>
            <option value="REJECTED">반려</option>
          </select>
        </FilterRow>}

        {/* 폰(md 미만)은 표 대신 카드(시안 S1-4) — 기한 · 서류 이름 · 계약 기간 · 연봉 · 상태 알약 · 아래 가로로 꽉 찬 버튼 */}
        <div className="md:hidden">
          {listLoading ? (
            <p className="py-8 text-center text-[#94a3b8]"><span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />목록을 불러오는 중…</span></p>
          ) : contracts.length === 0 ? (
            <p className="py-8 text-center text-[#94a3b8]">없음</p>
          ) : contracts.map((c) => {
            const r = rowOf(c);
            const due = c.status === "SENT" || c.status === "APPROVED" ? shortKDate(c.signDeadline) : null;
            const start = longKDate(c.startDate), end = longKDate(c.endDate);
            const salary = manWon((c.summaryFields || c.extraFields || {})["연봉"]);
            return (
              <div key={c.id} className="space-y-2.5 border-t border-[#f1f5f9] px-4 py-4 first:border-t-0">
                <div className="flex items-start justify-between gap-3">
                  <b className="min-w-0 text-[16px] font-bold leading-snug text-[#0f172a]">{c.title}</b>
                  {due && <span className="shrink-0 pt-0.5 text-[12.5px] text-[#596578]">기한 {due}</span>}
                </div>
                {(start || end) && <p className="text-[13.5px] text-[#334155]"><span className="text-[#596578]">계약 기간</span> {start || "?"} ~ {end || "?"}</p>}
                {salary && <p className="text-[13.5px] text-[#334155]"><span className="text-[#596578]">연봉</span> {salary}</p>}
                <div className="flex items-center gap-2">
                  <StatusPill tone={r.pill.tone}>{r.pill.label}</StatusPill>
                  {c.isTest && <span className="text-[12px] text-[#94a3b8]">테스트 문서</span>}
                </div>
                <div className="flex gap-2 pt-0.5">
                  {r.noAccess ? (
                    <span className="flex-1 py-2 text-center text-[13px] text-[#94a3b8]">제출 완료</span>
                  ) : r.lockedSelf ? (
                    r.mineToSign ? null : <span className="flex-1 py-2 text-center text-[13px] text-[#94a3b8]">서명하기에서 열기</span>
                  ) : (
                    <a href={r.openHref} target="_blank" rel="noreferrer" className={btnClass("secondary", "flex-1 py-2.5")} onClick={r.onOpen}>{r.canDownload ? "받기" : "보기"}</a>
                  )}
                  {r.mineToSign && <Btn kind="primary" className="flex-1 py-2.5" onClick={() => openEmpSign(c)}>서명하기</Btn>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>서류</th>
                <th>상태</th>
                <th className="hidden md:table-cell">결재 진행</th>
                <th className="hidden md:table-cell whitespace-nowrap">받은 날</th>
                <th className="hidden md:table-cell">기한</th>
                <th className="text-right">처리</th>
              </tr>
            </thead>
            <tbody>
              {listLoading ? (
                <tr><td colSpan={6} className="py-8 text-center text-[#94a3b8]"><span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />목록을 불러오는 중…</span></td></tr>
              ) : contracts.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-[#94a3b8]">없음</td></tr>
              ) : contracts.map(c => {
                const { mineToSign, pill, noAccess, lockedSelf, canDownload, openHref, onOpen } = rowOf(c);
                const received = kstDay(c.approvalLine?.createdAt);
                const due = c.status === "SENT" || c.status === "APPROVED" ? kstDay(c.signDeadline) : null;
                const period = c.startDate || c.endDate ? `계약기간 ${String(c.startDate || "?").slice(0, 10)} ~ ${String(c.endDate || "?").slice(0, 10)}` : null;
                const sub = [period, c.isTest && "테스트 문서"].filter(Boolean).join(" · ");
                return (
                  <tr key={c.id} className="hover:bg-[#fafbfd]">
                    <td>
                      <b className="font-bold text-[#0f172a]">{c.title}</b>
                      {sub && <span className="block text-[12.5px] text-[#596578]">{sub}</span>}
                      {/* 휴대폰은 받은 날 · 기한을 회색 한 줄로(칸이 숨는다) */}
                      {(received || due) && <span className="block text-[12.5px] text-[#596578] md:hidden">{[received && `받은 날 ${received}`, due && `기한 ${due}`].filter(Boolean).join(" · ")}</span>}
                    </td>
                    <td><StatusPill tone={pill.tone}>{pill.label}</StatusPill></td>
                    <td className="hidden md:table-cell">
                      <ApprovalChain
                        steps={c.approvalLine?.steps}
                        userId={c.userId}
                        onClick={() => {
                          setApprovalDetailsTarget(c);
                          setApprovalDetailsOpen(true);
                        }}
                      />
                    </td>
                    <td className="hidden md:table-cell whitespace-nowrap text-[#475569] tabular-nums">{received ?? <span className="text-[#94a3b8]">—</span>}</td>
                    <td className="hidden md:table-cell whitespace-nowrap text-[#475569] tabular-nums">{due ?? <span className="text-[#94a3b8]">—</span>}</td>
                    <td className="whitespace-nowrap text-right">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {noAccess ? (
                          <span className="text-[12.5px] text-[#94a3b8]" title="사본이 필요하면 관리자에게 요청해주세요">제출 완료</span>
                        ) : lockedSelf ? (
                          mineToSign ? null : <span className="text-[12.5px] text-[#94a3b8]" title="「서명하기」에서 비밀번호를 넣으면 열립니다">서명하기에서 열기</span>
                        ) : (
                          <a href={openHref} target="_blank" rel="noreferrer" className={btnClass("secondary", "px-3.5 py-1.5")} title={canDownload ? "체결본 받기(PDF)" : "열람"} onClick={onOpen}>
                            {canDownload ? "받기" : "보기"}
                          </a>
                        )}
                        {mineToSign && <Btn kind="primary" className="px-3.5 py-1.5" onClick={() => openEmpSign(c)}>서명하기</Btn>}
                      </span>
                      {/* 버전 히스토리 아이콘은 뺐다(2026-10-16 이예지 QA E3 — 근로자에게는 「버전 정보가 없습니다」만 떠 의미가 없었다) */}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Box>

      {/* 서명 모달 — 개인정보동의서는 2단계(동의 확인 → 서명), 그 외는 바로 서명 */}
      {/* 근로자 본인 서명 — 전체 창(재요청 C). 문서를 열기 전 비밀번호 확인은 아래 옛 창이 그대로 한다 */}
      {empFull && signTarget && (
        <ApprovalFullView
          key={signTarget.id}
          mode="sign"
          c={{
            id: signTarget.id, title: signTarget.title, userId: signTarget.userId, externalName: signTarget.externalName, sendMessage: signTarget.sendMessage,
            user: { name: signTarget.user.name, branch: signTarget.user.branch ?? null },
            docLabel: DOC_LABEL[signTarget.type] || signTarget.type,
            period: signTarget.startDate || signTarget.endDate ? `${(signTarget.startDate || "?").slice(0, 10)} ~ ${(signTarget.endDate || "?").slice(0, 10)}` : null,
            summaryFields: null,
            steps: (signTarget.approvalLine?.steps || []).map((st) => ({ id: st.id, order: st.order, status: st.status, approverId: st.approverId, decidedAt: st.decidedAt, approver: { id: st.approverId, name: st.approver?.name || "", role: st.approver?.role ?? null } })),
          }}
          myId={myId} myRole="근로자"
          docUrl={empDoc} docErr={empDocErr} docIsProgress={false} hasFile={!!getFileUrl(signTarget.fileUrl)}
          mySignatureUrl={null} busy={signSubmitting} paused={rejectOpen}
          pwNeeded={needPw} rejectLabel="서명 거부"
          extra={empExtra} extraBlock={empBlock}
          onSubmit={(p) => void handleSign(signTarget.id, signTarget.status === "APPROVED", { signatureData: p.signatureData, password: p.password || undefined })}
          onReject={() => { setRejectReason(""); setRejectOpen(true); }}
          onClose={() => { if (!signSubmitting) setSignOpen(false); }}
        />
      )}
      {/* 결재(원장 대행 등) — 결재 전체 창 */}
      {hostTarget && (
        <ApprovalFullViewHost
          key={hostTarget.id}
          c={hostTarget as unknown as HostContract}
          docLabel={DOC_LABEL[hostTarget.type] || hostTarget.type || "계약서"}
          myId={myId} myRole={myRoleName}
          onClose={() => setHostTarget(null)}
          onDone={() => { setHostTarget(null); fetchContracts(); }}
        />
      )}
      <Dialog open={signOpen && !empFull} onOpenChange={setSignOpen}>
        {/* 창을 확대하면 모달이 화면보다 길어져 하단 승인 버튼이 밀려 나가 서명을 못 하던 문제(#196) —
            높이를 화면 안으로 묶고 본문만 스크롤시킨다. */}
        <DialogContent className="max-w-2xl h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0"><DialogTitle>{consentKeys.length > 0 ? (signStep === 1 ? "개인정보 동의 확인" : "서명") : "서명"}</DialogTitle></DialogHeader>
          {/* 문서 열기 전 본인 확인(#20) — 근로자 본인 서명 차례면 비밀번호부터 */}
          {signTarget && isEmpSign && !unlocked && (
            <div className="space-y-3 flex-1">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm font-medium">{signTarget.title}</p>
                <p className="text-xs text-gray-500 mt-1">본인 확인을 위해 큐브티 로그인 비밀번호를 입력하면 문서가 열립니다.</p>
              </div>
              <form onSubmit={e => { e.preventDefault(); unlockDoc(); }} className="space-y-2">
                <ReauthPasswordInput autoFocus value={unlockPw} onChange={e => setUnlockPw(e.target.value)} placeholder="로그인 비밀번호" />
                <Button type="submit" className="w-full bg-[#4f46e5] text-white hover:bg-[#4338ca]" disabled={!unlockPw || unlocking}>{unlocking ? "확인 중…" : "확인하고 문서 열기"}</Button>
                <p className="text-[11px] text-gray-400">확인 기록(시각)은 전자서명 완료 증명서에 남습니다. 비밀번호는 저장되지 않습니다.</p>
              </form>
            </div>
          )}
          {signTarget && (!isEmpSign || unlocked) && (
            <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1">
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <p className="text-sm font-medium">{signTarget.title}</p>
                <p className="text-xs text-gray-500">{signTarget.externalName ? `[외부] ${signTarget.externalName}` : `${signTarget.user.branch ? `[${signTarget.user.branch}] ` : ''}${signTarget.user.name}`}</p>
                {signTarget.sendMessage && (
                  <p className="text-xs text-indigo-800 bg-indigo-50 border border-indigo-100 rounded px-2 py-1.5 mt-1 whitespace-pre-wrap">본부 메시지 · {signTarget.sendMessage}</p>
                )}
              </div>

              {/* ── 1단계: 개인정보동의서 동의 확인 ── */}
              {consentKeys.length > 0 && signStep === 1 && (
                <>
                  <button type="button" onClick={() => { setViewerAtBottom(false); setDocViewerOpen(true); }}
                    className={`flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg border text-sm font-medium ${consentRead ? "border-[#c7d2fe] text-[#4f46e5] bg-[#eef2ff]" : "border-[#4f46e5] bg-[#4f46e5] text-white hover:bg-[#4338ca]"}`}>
                    <Eye size={15} />{consentRead ? "전문 확인 완료 (다시 보기)" : "동의서 전문 보기 (필수)"}
                  </button>
                  {/* 필수 항목도 명시적 동의 — 자동 처리는 개인정보보호법 위반 (#104, 2026-08-27) */}
                  <label className="flex items-start gap-2 rounded-lg border border-gray-300 bg-gray-50 p-3 text-xs text-gray-700 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={consentRequired} onChange={e => setConsentRequired(e.target.checked)} />
                    <span><b>[필수]</b> 개인정보 수집·이용, 민감정보, 퇴직 후 보유, 제3자 제공에 <b>동의합니다</b>. (동의하지 않으면 채용이 취소·제한될 수 있습니다)</span>
                  </label>
                  <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3 space-y-2">
                    {/* 괄호 안내가 미동의를 권유하는 것처럼 읽혀 중립 문구로 교체 (#181, 2026-08-31 김가산) */}
                    <p className="text-xs font-semibold text-[#0f172a]">선택 동의 항목</p>
                    <p className="text-[11px] text-[#596578]">동의 여부와 관계없이 채용 절차에 영향을 주지 않습니다.</p>
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
                    <div className="rounded-lg border border-[#e0e7ff] bg-[#eef2ff]/60 p-3 space-y-2">
                      <p className="text-xs font-semibold text-[#3730a3]">필요한 정보 입력 (프로필에 저장됩니다)</p>
                      {missingProfile.includes("주소") && (
                        <div className="space-y-1"><Label className="text-xs">주소</Label>
                          <input className="w-full border rounded px-2 py-1.5 text-sm" placeholder="예: 서울시 강남구 테헤란로 123"
                            value={profileInput.주소} onChange={e => setProfileInput(p => ({ ...p, 주소: e.target.value }))} /></div>
                      )}
                      {missingProfile.includes("생년월일") && (
                        <div className="space-y-1"><Label className="text-xs">생년월일</Label>
                          <input type="date" max="9999-12-31" className="w-full border rounded px-2 py-1.5 text-sm"
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
                            className="bg-[#4f46e5] text-white hover:bg-[#4338ca]"
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
                    <div className="rounded-lg border border-[#e0e7ff] bg-[#eef2ff]/60 p-3 space-y-2">
                      <p className="text-xs font-semibold text-[#3730a3]">계약서에 필요한 정보를 입력해주세요 (프로필에 저장됩니다)</p>
                      {missingProfile.includes("주소") && (
                        <div className="space-y-1"><Label className="text-xs">주소</Label>
                          <input className="w-full border rounded px-2 py-1.5 text-sm" placeholder="예: 서울시 강남구 테헤란로 123"
                            value={profileInput.주소} onChange={e => setProfileInput(p => ({ ...p, 주소: e.target.value }))} /></div>
                      )}
                      {missingProfile.includes("생년월일") && (
                        <div className="space-y-1"><Label className="text-xs">생년월일</Label>
                          <input type="date" max="9999-12-31" className="w-full border rounded px-2 py-1.5 text-sm"
                            value={profileInput.생년월일} onChange={e => setProfileInput(p => ({ ...p, 생년월일: e.target.value }))} /></div>
                      )}
                    </div>
                  )}
                  {/* 직원 직접입력 필드(퇴사사유·지급희망일·지급금품 체크 등) */}
                  {empFieldsBox}
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
                          <span className="text-[11px] bg-white/95 text-[#334155] border border-[#e2e8f0] rounded-full px-2.5 py-1 shadow">클릭하면 크게 보입니다</span>
                        </button>
                        {/* 로딩 중 빈 화면이면 오류인지 대기 중인지 구분이 안 된다는 지적 (#179) */}
                        {previewLoading && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 pointer-events-none">
                            <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-500" />
                            <span className="text-xs text-gray-500">문서를 불러오는 중입니다…</span>
                          </div>
                        )}
                      </div>
                      <a href={viewHref(getFileUrl(signTarget.fileUrl))} target="_blank" rel="noreferrer" className="text-xs text-[#4f46e5]">크게 보기 (새 창)</a>
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
                      <button type="button" className="text-xs text-[#4f46e5] underline" onClick={() => { setDrawNewSig(true); sigRef.current?.clear(); }}>
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
                  {/* 본인 확인 — 근로자 본인 서명(#205-1)과 결재자 승인(#220-3, 2026-10-16) 모두. 근로자는 문서 열기 전에 확인했으면(#20) 다시 묻지 않는다 */}
                  {(!isEmpSign || !unlocked || needPw) && (
                    <div className="space-y-1">
                      <Label>본인 확인 — 비밀번호 *</Label>
                      <ReauthPasswordInput value={signPassword}
                        onChange={e => setSignPassword(e.target.value)} placeholder="로그인 비밀번호" />
                      <p className="text-[11px] text-gray-400">{isEmpSign ? "본인이 직접 서명하는지 확인합니다." : "결재자 본인이 직접 승인하는지 확인합니다."} 비밀번호는 저장되지 않습니다.</p>
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
                  {meLoaded && !myId && <p className="text-xs text-red-600">내 정보를 불러오지 못했습니다. 페이지를 새로고침 한 뒤 다시 시도해 주세요.</p>}
                  <div className="flex gap-2 justify-end sticky bottom-0 bg-white pt-3 pb-1 -mx-1 px-1 border-t">
                    {consentKeys.length > 0 && <Button variant="outline" onClick={() => setSignStep(1)}>← 이전</Button>}
                    <Button variant="outline" onClick={() => setSignOpen(false)}>취소</Button>
                    {/* 조건이 다르면 그냥 안 누르고 버티는 대신 사유를 남긴다 (2026-09-04) */}
                    <Button variant="ghost" className="text-red-600 hover:bg-red-50"
                            onClick={() => { setRejectReason(""); setRejectOpen(true); }}>
                      서명 거부
                    </Button>
                    <Button className="bg-[#4f46e5] text-white hover:bg-[#4338ca]" onClick={() => handleSign(signTarget.id, approverMode || signTarget.status === "APPROVED")} disabled={signSubmitting || !myId}>{signSubmitting ? "서명 중..." : "서명"}</Button>
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
                        {v.reason && <p className="text-xs text-[#b45309] mt-0.5">{v.reason}</p>}
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
                    {/* 본인 서명 차례 문서는 [서명]에서 비밀번호를 넣어야 열린다(#20 검증 R2) — 이전 버전도 따로 열지 않는다 */}
                    {!(versionsTarget.userId === myId && !versionsTarget.externalName && versionsTarget.status !== "SIGNED"
                        && (versionsTarget.approvalLine?.steps || []).some(s => s.approverId === myId && s.status === "PENDING")) && (
                    <a href={viewHref(getFileUrl(v.fileUrl))} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline" className="w-full gap-1">
                        <Eye size={12} />보기
                      </Button>
                    </a>
                    )}
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
                      <StatusPill tone="done">완료</StatusPill>
                    ) : (
                      <StatusPill tone="wait">대기</StatusPill>
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
                        <StatusPill tone="done">승인됨</StatusPill>
                      ) : step.status === "PENDING" ? (
                        <StatusPill tone="wait">대기</StatusPill>
                      ) : step.status === "REJECTED" ? (
                        <StatusPill tone="rej">반려</StatusPill>
                      ) : (
                        <StatusPill tone="gray">미정</StatusPill>
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
                    <StatusPill tone="done">완료</StatusPill>
                  </div>
                  <p className="text-xs text-gray-500">
                    {format(new Date(approvalDetailsTarget.signedAt), "yyyy-MM-dd HH:mm")}
                  </p>
                  {approvalDetailsTarget.status === "SIGNED" && (
                    <a href={`/api/contracts/${approvalDetailsTarget.id}/signed-document?pdf=1`} className={btnClass("secondary", "w-full")} onClick={() => { fetch(`/api/contracts/${approvalDetailsTarget.id}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "DOWNLOADED" }) }).catch(() => {}); }}>
                      서명 완료본 받기
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
                              {/* 처리자 이름은 목록 API 가 actorName 으로 채워 준다(9/12) — 이 화면엔 직원 목록이 없다 */}
                              {log.actorName || "알 수 없는 사용자"} · {when}
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