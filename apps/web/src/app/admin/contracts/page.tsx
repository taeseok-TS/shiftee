"use client";
import ContractEventsList from "@/components/contracts/ContractEventsList";

import BulkValuesTable, { bulkColumns, deriveHours, evalPeriods, normDate, DATE_COLS, PERSON_DATE_COLS, EVAL_COLS, type BulkRowValues } from "@/components/contracts/BulkValuesTable";
import BulkSendDialog from "@/components/contracts/BulkSendDialog";
import { koreanMoney } from "@/lib/korean-money";
import { DEFAULT_STEPS, KIND_LABEL, STEP_KINDS, effectiveKind, kindOfApprover, parseApprovalSteps, stepsLabel, type ApprovalStepSpec, type StepKind } from "@/lib/approval-order";
import { TEMPLATE_CATEGORIES, templateCategoryOf } from "@/lib/template-category";
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
import { FileSignature, Plus, PenLine, Download, Send, CheckCircle2, Clock, ArrowRight, History, Trash2, ChevronDown, X, Eye, Upload, Loader2 } from "lucide-react";
import { format } from "date-fns";
import type { FieldSettings } from "@/lib/contract-field-settings";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";

type Contract = {
  id: string;
  userId: string;
  templateId?: string | null;
  title: string;
  type: string;
  fileUrl: string;
  status: string;
  extraFields?: Record<string, string> | null; // 작성 시 입력값 요약 (연봉·수습 기간 등)
  summaryFields?: Record<string, string> | null; // 서명 창 요약 — 그 문서 템플릿 필드만(서버 계산, #206-2)
  signedUrl?: string | null; // 완료 시 저장되는 서명본(서명+직인) 파일
  bundleId?: string | null; // 신규입사 패키지 묶음
  employeeOnly?: boolean; // 직원 서명만·직원전용 문서
  externalName?: string | null; // 외부(미가입) 계약자 이름 — 있으면 외부 계약
  externalPhone?: string | null;
  externalEmail?: string | null;   // 외부 계약자 받을 이메일(10/16 QA 7)
  employeeSignedAt?: string | null;
  signedAt: string | null;
  createdAt: string;
  // 이 화면이 실제로 쓰는데 타입에서 빠져 있던 것들 (2026-09-03).
  // 빌드가 타입 오류를 무시하도록 돼 있어 13건이 그대로 통과하고 있었다.
  startDate?: string | null;
  endDate?: string | null;
  hideRevoked?: boolean;              // 회수된 결재 숨김
  revocationLog?: { at?: string; by?: string; reason?: string }[] | null; // 회수 이력
  templateVersion?: number | null; // 발송 당시 양식 버전(#48)
  signDeadline?: string | null;    // 서명 기한(#45)
  sendMessage?: string | null;     // 본부 발송 메시지(#65)
  isTest?: boolean;                // 나에게 테스트 발송(#67) 시험 문서 — 7일 뒤 자동 삭제
  approvalSteps?: { kind: string }[] | null; // 양식의 결재 순서(#213-2) — 없으면 본부→원장→근로자. 재계약이면 서버가 재계약 순서로 바꿔 준다(2026-10-15)
  approvalRenewal?: boolean;                 // 이 계약에 양식의 재계약 순서가 적용됨
  approvalLocked?: boolean;                  // 발송 때 순서 변경 불가(기본)
  importBatch?: string | null;     // 모두싸인 이관본(#4)
  certificateUrl?: string | null;  // 이관본의 감사추적 인증서(#4)
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

type Employee = { id: string; name: string; department: string | null; branch?: string | null; role?: string; birthDate?: string | null; managerBranches?: string[]; hireDate?: string | null; position?: string | null; empNo?: number | null; phone?: string | null; email?: string | null; resignDate?: string | null };

// 휴대폰 일부만(#26) — 010-****-1234, 서울 02-****-4567
const maskPhone = (p?: string | null) => {
  const d = (p || "").replace(/[^0-9]/g, "");
  return d.length >= 8 ? `${d.slice(0, d.startsWith("02") ? 2 : 3)}-****-${d.slice(-4)}` : "";
};

// 중복 발송 경고(#47) 확인창 — 발송 창·[다시 보내기]가 같이 쓴다. 날짜는 KST
function askDuplicate(data: { duplicates?: { title: string; status: string; lastSentAt: string | null }[] }): boolean {
  const st: Record<string, string> = { SENT: "진행 중", APPROVED: "진행 중", SIGNED: "완료", EXPIRED: "만료" };
  const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const lines = (data.duplicates || []).slice(0, 5).map(d => `· ${d.title} — ${st[d.status] ?? d.status}${d.lastSentAt ? ` (발송 ${kst(d.lastSentAt)})` : ""}`);
  return confirm(`같은 직원에게 같은 양식이 진행 중이거나 최근 30일 안에 보낸 계약이 있습니다.\n\n${lines.join("\n")}\n\n그래도 발송할까요?`);
}

type ContractTemplate = {
  approvalStepsRenewal?: { kind: string }[] | null; // 재계약일 때의 결재 순서(2026-10-15) — 작성 창 안내용
  id: string;
  name: string;
  createdAt?: string; // 패키지 자동 선택 순서(#78 F1)
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
  changes?: { field: string; from: string | null; to: string | null }[] | null; // 이 버전 뒤에 바뀐 항목(#206-6)
  reason?: string | null;
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
  // 반려 — 2026-09-11 부터 최종이 아니다: 관리자가 고쳐(수정) 또는 그대로(재발송) 다시 보낼 수 있다(#206-4)
  REJECTED: { label: "반려", variant: "destructive" },
};

// 상태 필터 트리거에 코드값 대신 표시할 라벨 (#141)
const FILTER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "초안", SENT: "직원 서명 대기", APPROVED: "결재 중", SIGNED: "완료", EXPIRED: "만료",
  REJECTED: "반려",
};

// 발송 승인자 슬롯 (#158·#159) — 칸 수·역할은 **양식의 결재 순서**(#213-2, lib/approval-order)대로. 순서 없는 양식은 본부→원장→근로자
type ApproverSlots = (string | null)[];

// 문서 종류 필터 그룹 (#168) — 양식 분류 5묶음(lib/template-category, #214-5)과 같은 기준
const DOC_GROUPS = TEMPLATE_CATEGORIES;
const docGroupOf = templateCategoryOf;

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
        {/* 단계마다 「이름 직급」(10/16 이예지 재확인 3 — 근로자도 「직원」 대신 이름. 이름 표기는 서버 labelApproverNames) */}
        <span className="text-xs font-medium">
          {step.approver?.name || (step.approverId === userId ? "직원" : (step as { externalName?: string }).externalName || "외부 서명자")}
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

// 퇴사 패키지 문서 5종과 기본 체크(#203, 이예지 답 2026-10-14: 사직원·비밀유지서약서 기본, 나머지는 필요할 때)
const RESIGN_DOC_LABELS = ["사직원", "금품청산 지급기일연장 동의서", "퇴직금 정산 신청서", "연차수당 정산 신청서", "비밀유지서약서(퇴직시)"];
const RESIGN_PICK_DEFAULT = [true, false, false, false, true];

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [myApprovals, setMyApprovals] = useState<Contract[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  // 지점 → 메인 원장 이름(#213-4). 원장이 둘인 지점은 메인 원장이 문서의 「원장명」이다. 없으면 그 지점 원장(겸직 포함) 아무나
  const [mainManagers, setMainManagers] = useState<Record<string, string>>({});
  const [branchAddresses, setBranchAddresses] = useState<Record<string, string>>({});   // 지점 → 주소(인사발령통지서 발령 근무지 자동)
  const [transferCustom, setTransferCustom] = useState(false);   // 발령지점 「목록에 없음」 직접 입력 중
  const [mainManagerIds, setMainManagerIds] = useState<Record<string, string>>({});   // 지점 → 메인 원장 id(발송 창 원장 단계 자동 채움)
  const branchManagerName = (branch?: string | null): string => {
    if (!branch) return "";
    if (mainManagers[branch]) return mainManagers[branch];
    const mgr = employees.find(e => e.role === "MANAGER" && (e.branch === branch || (e.managerBranches || []).includes(branch)));
    return mgr?.name || "";
  };
  const lastAutoFillUser = useRef<string>("");   // 자동 채움을 마지막으로 한 직원 — 같은 직원이면 빈칸·자동값만 바꾼다(직접 고친 값 보존)
  const autoFilled = useRef<Record<string, string>>({});   // 키 → 마지막에 자동으로 넣은 값. 현재 값이 이것과 같으면 사람이 안 고친 것
  const [listLoading, setListLoading] = useState(true);   // 목록 불러오는 중(#217-1)
  // 포털 인사카드가 채워 줄 수 있는 빈 프로필 칸(#25) — 칸 이름만 받는다(값은 화면에 보이지 않는다)
  const [portalFill, setPortalFill] = useState<{ userId: string; fields: string[] } | null>(null);
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [role, setRole] = useState("EMPLOYEE");
  const [myId, setMyId] = useState("");
  const [myName, setMyName] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [useTemplate, setUseTemplate] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [bundleMode, setBundleMode] = useState(false); // 신규입사 패키지(2종 묶음: 근로계약서+개인정보동의서 — 비밀유지서약서는 채용 단계 별도, #202 이예지 답 10/14) 발송
  // 퇴사 패키지 「문서 고르기」(#203, 이예지 답 10/14) — 사직원은 대표 문서라 항상, 기본 체크는 사직원·비밀유지서약서(퇴직시)
  const [resignPicks, setResignPicks] = useState<boolean[]>([...RESIGN_PICK_DEFAULT]);
  const scanSeqRef = useRef(0);   // scanFields 호출 순번 — 마지막 호출만 반영
  const [resignBundleMode, setResignBundleMode] = useState(false); // 퇴사 패키지(사직원 + 고른 문서, 최대 5종) 발송
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
  // 여러 명 작성 — 개인별 값(#19 #34). 비우면 공통 입력값
  const [bulkValues, setBulkValues] = useState<BulkRowValues>({});
  // 목록에서 초안 여러 건 골라 한꺼번에 발송(#34)
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
  const [bulkSendKey, setBulkSendKey] = useState(0);   // 열 때마다 새 창(앞 묶음의 본부·메시지가 남지 않게)
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
  // 발송 메시지(#65) — 발송 창을 열 때 본부 기본 문구로 채운다. 「기본으로 저장」하면 다음 발송부터 이 문구
  const [sendMsg, setSendMsg] = useState("");
  const [deadlineDays, setDeadlineDays] = useState("14");   // 서명 기한(#45, 본부 답변 #35 기본 2주)
  // 패키지 서류별 결재 순서(10/16 이예지 QA 5) — 서류 id → 결재자 id 순서. 없으면 공통 순서. 이 발송에만 적용
  const [docOrdersRaw, setDocOrders] = useState<Record<string, string[]>>({});
  const [docOrdersKey, setDocOrdersKey] = useState("");   // 서류별 순서를 정할 때의 공통 결재자 — 결재자를 바꾸면 서류별 순서는 처음부터(검증 F4)
  // 외부 계약 받을 이메일(10/16 이예지 QA 7) — 발송 때 필수. 링크 본인 확인(뒷자리와 함께)·완료본 PDF 받는 곳
  const [sendExtEmail, setSendExtEmail] = useState("");
  const [savingMsg, setSavingMsg] = useState(false);
  async function openSendDialog(c: Contract) {
    setSendTarget(c); resetApproverSlots(c); setApproverSearch(""); setSendMsg(""); setDeadlineDays("14"); setDocOrders({}); setSendExtEmail(c.externalEmail || ""); setSendOpen(true);
    try {
      const d = await fetch("/api/admin/contract-message").then(r => (r.ok ? r.json() : null));
      if (d?.message) setSendMsg(m => (m ? m : d.message));
    } catch { /* 기본 문구를 못 받아도 발송은 된다 */ }
  }
  async function saveDefaultMsg() {
    setSavingMsg(true);
    try {
      const res = await fetch("/api/admin/contract-message", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: sendMsg }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "저장하지 못했습니다."); return; }
      toast.success(sendMsg.trim() ? "기본 메시지로 저장했습니다." : "기본 메시지를 비웠습니다.");
    } finally { setSavingMsg(false); }
  }
  const [sendTarget, setSendTarget] = useState<Contract | null>(null);
  // 승인자는 3칸 고정 슬롯 — 1단계 본부 / 2단계 원장 / 3단계 근로자 (#158·#159).
  // 서버 계약은 그대로라 발송 시 null 을 뺀 배열(approverIds)로 변환해 보낸다.
  const [approverSlots, setApproverSlots] = useState<ApproverSlots>([null, null, null]);
  const [slotSpecs, setSlotSpecs] = useState<ApprovalStepSpec[]>(DEFAULT_STEPS);   // 칸마다의 종류(본부·원장·근로자·외부) — 양식 순서(#213-2)
  const [activeSlot, setActiveSlot] = useState<number | null>(null); // 슬롯을 먼저 눌러 "지금 채울 칸" 지정
  const approverIds = approverSlots.filter((x): x is string => !!x);
  const docOrders = docOrdersKey === approverIds.join(",") ? docOrdersRaw : {};
  // 양식에 순서가 있고 고정이면(기본) 칸 종류대로만 사람을 넣고 순서를 못 바꾼다. 순서 변경 허용 양식은 ▲▼·추가·삭제.
  // 순서가 없는(레거시) 양식은 종전 그대로 — 3칸(본부·원장·근로자)에 아무나 넣을 수 있고 서버도 검사하지 않는다(3f2d0d4 검증 F1)
  const slotLocked = !!sendTarget?.approvalSteps && sendTarget.approvalLocked !== false;
  const slotEditable = !!sendTarget?.approvalSteps && sendTarget.approvalLocked === false;
  const partyIsManager = !!sendTarget && !sendTarget.externalName && employees.find(e => e.id === sendTarget.userId)?.role === "MANAGER";
  const slotKind = (i: number): StepKind => effectiveKind(slotSpecs[i]?.kind ?? "HQ", !!sendTarget?.externalName);
  const slotLabel = (i: number) => KIND_LABEL[slotKind(i)];
  const [approverSearch, setApproverSearch] = useState(""); // 승인자 검색 (발송 다이얼로그)
  const [updateApproverSearch, setUpdateApproverSearch] = useState(""); // 결재자 수정 검색

  const [signOpen, setSignOpen] = useState(false);
  const [signTarget, setSignTarget] = useState<Contract | null>(null);
  const sigRef = useRef<SignaturePadHandle>(null);
  // 저장된 결재 서명 — 있으면 원클릭 승인, 없으면 그린 서명을 저장해두고 다음부터 사용
  const [mySignatureUrl, setMySignatureUrl] = useState<string | null>(null);
  const [drawNewSig, setDrawNewSig] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(false); // 기본 해제 — 체크한 사람만 저장(#205-2, 2026-09-11)
  const [signZoom, setSignZoom] = useState(1); // 서명 모달 문서 확대·축소 0.75~2.0 (#160)
  // 문서 크게 보기 — 새 창 대신 그 자리에서 전체화면으로 (2026-09-02 이예지대리 재확인요청).
  // "새창으로 옮기는거 불편합니다" — 서명하다 창을 옮기면 하던 일이 끊긴다.
  const [bigDoc, setBigDoc] = useState<{ src: string; title: string } | null>(null);
  const [bigZoom, setBigZoom] = useState(1);
  const bigRef = useRef<HTMLDivElement>(null);
  // 문서를 그 자리에서 크게 연다. 주소를 받으므로 발송 미리보기.서명 문서.원본 PDF 모두 같은 창을 쓴다.
  const [bigLoading, setBigLoading] = useState(false);   // 큰 문서가 뜨기 전 돌아가는 표시(#217-1 — 멈춘 것처럼 보인다는 의견)
  const openBigDoc = (src: string, title: string) => { setBigZoom(1); setBigLoading(true); setBigDoc({ src, title }); };
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
    // 큰 화면이 떠 있는 동안 Tab 이 **뒤의 서명 모달**로 새지 않게 한다. 화면에는 안 보이는
    // "서명" 버튼으로 포커스가 가서 Enter 로 잘못 누르는 사고를 막는다.
    // 다이얼로그 라이브러리가 앱 루트에 aria-hidden 을 걸어 이 오버레이가 스크린리더에
    // 안 잡히던 것도 함께 푼다.
    const el = bigRef.current;
    const prevHidden = el?.closest("[aria-hidden='true']") as HTMLElement | null;
    if (prevHidden) prevHidden.removeAttribute("aria-hidden");
    el?.querySelector<HTMLElement>("button")?.focus();
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>("button, a[href]")].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onTab, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", onTab, true);
      if (prevHidden) prevHidden.setAttribute("aria-hidden", "true");
    };
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
  // 직원 서명 회수는 결재 단계가 없다 — step 은 결재 회수일 때만 있다(호출부가 type 으로 분기).
  const [revokeTarget, setRevokeTarget] = useState<{ contractId: string; step?: { id: string; order?: number } | null; type?: "approval" | "employee" } | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  // 계약서 삭제
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string; bundleId?: string | null } | null>(null);

  // 계약서 수정 (DRAFT 상태)
  const [editOpen, setEditOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<any>(null);
  const [editForm, setEditForm] = useState({ title: "", type: "", startDate: "", endDate: "", salary: "" });
  // 금액 칸은 "입력 중엔 숫자만, 벗어나면 콤마" — 매 글자마다 다시 포맷하면 커서가 끝으로 튄다(검증관 F4)
  const [salaryFocus, setSalaryFocus] = useState(false);
  const [editSalaryFocus, setEditSalaryFocus] = useState(false);
  const wonView = (v: string, focused: boolean) => (focused ? v : v ? Number(v).toLocaleString() : "");
  const [editExtraFields, setEditExtraFields] = useState<Record<string, string>>({}); // 템플릿 동적 필드 수정값
  // "2026년 8월 1일" → "2026-08-01" (수정 폼 date input용)
  // 값 **전체가** 한국어 날짜일 때만 바꾼다 — 종전엔 문장 속 날짜만 뽑아("2026년 9월 2일부터 3개월" → 2026-09-02) 나머지가 사라져,
  // 아무것도 안 고쳐도 서버가 "내용 바뀜"으로 보고 서명 초기화 경고를 띄웠다(#206 검증 F4)
  const koreanToIso = (v: string) => {
    const m = /^\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*$/.exec(v);
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
  // 문서함 검색(#79) — 기간 기준(작성일·완료일·마지막 활동일)·오래된 대기(7일 넘게 움직임 없음)
  const [filterDateField, setFilterDateField] = useState("created");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterStale, setFilterStale] = useState(false);
  const [showTest, setShowTest] = useState(false);       // 내 테스트 문서만(#67)
  const [testSending, setTestSending] = useState(false); // 나에게 테스트 발송 중(#67)

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
      dateField: filterDateField, from: filterFrom, to: filterTo, stale: filterStale,
      test: showTest,
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
    if (useFilters.from || useFilters.to) {
      params.append("dateField", useFilters.dateField || "created");
      if (useFilters.from) params.append("from", useFilters.from);
      if (useFilters.to) params.append("to", useFilters.to);
    }
    if (useFilters.stale) params.append("stale", "7");
    if (useFilters.test) params.append("test", "true");   // 내 테스트 문서만(#67)

    setListLoading(true);
    const res = await fetch(`/api/contracts?${params.toString()}`).finally(() => setListLoading(false));
    const data = await res.json();
    setContracts(data.contracts || []);

    if (role !== "EMPLOYEE") {
      const approvalRes = await fetch("/api/contracts/my-approvals");
      const approvalData = await approvalRes.json();
      setMyApprovals(approvalData.contracts || []);
    }
  }, [role, filterYear, filterMonth, filterStatus, filterUserId, filterBranch, filterSearchText, showHiddenRevoked, filterTemplateId, filterPkg, filterDateField, filterFrom, filterTo, filterStale, showTest]);

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
    // 결재 회수 전용 — 직원 서명 회수는 별도 경로(revoke-employee-signature)로 간다
    if (!revokeTarget.step) {
      toast.error("결재 단계를 찾을 수 없습니다.");
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
  // 발송 두 번 누름 방지 — 요청이 끝날 때까지 잠근다. 두 번 가면 결재선을 두 번 다시 만들고 알림도 두 번 간다(85c58dc 검증 1).
  // 화면 상태는 다음 그리기 전까지 옛 값이라, 아주 빠른 두 번째 클릭은 즉시 반영되는 ref 로 막는다.
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);

  // 패키지 직원전용 문서(비밀유지·개인정보동의서) 반려 뒤 [다시 보내기] — 서명자는 직원 본인 한 단계로 고정(#206 검증 F5, 9/12 디렉터).
  // 반려 기록은 서버가 지우기 전에 이력으로 남기고, 직원에게 서명 요청 봇 알림이 간다.
  const resendEmployeeOnly = async (c: Contract) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const send = (confirmDuplicate: boolean) => fetch(`/api/contracts/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "SENT", approverIds: [c.userId], ...(confirmDuplicate ? { confirmDuplicate: true } : {}) }),
      });
      let res = await send(false);
      let d = await res.json().catch(() => ({}));
      // 중복 발송 경고(#47) — 발송 창과 같은 확인을 거쳐 다시 보낸다(검증 F1: 확인 없이 409 로 영영 막혔다)
      if (res.status === 409 && d.code === "DUPLICATE") {
        if (!askDuplicate(d)) return;
        res = await send(true);
        d = await res.json().catch(() => ({}));
      }
      if (!res.ok) { toast.error(d.error || "다시 보내지 못했습니다."); return; }
      toast.success(c.status === "EXPIRED" ? "직원에게 다시 보냈습니다 — 서명 기한을 새로 정했습니다." : "직원에게 다시 보냈습니다 — 반려 기록은 이력에 남습니다.");
      fetchContracts();
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  // confirmReset — 서버가 "서명이 초기화됩니다"(409 RESET_CONFIRM)를 돌려주면 확인받고 이 표시를 달아 다시 보낸다(#206-1)
  const handleEditContract = async (e: React.FormEvent, confirmReset = false) => {
    e.preventDefault();
    if (!editingContract) return;
    // 임금이 들어 있던 계약을 빈칸으로 저장하면 문서 계산이 깨진다 — 막는다(2026-09-16 디렉터 지시)
    if (editingContract.extraFields?.["연봉"] && !String(editForm.salary || "").trim()) {
      toast.error("연봉을 입력해주세요. 비우고 저장할 수 없습니다.");
      return;
    }

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
        if (confirmReset) formData.append("confirmReset", "1");

        const res = await fetch(`/api/contracts/${editingContract.id}`, {
          method: "PATCH",
          body: formData,
        });

        if (!res.ok) {
          try {
            const data = await res.json();
            // 서명(또는 반려)이 있는 계약 — 저장하면 결재가 처음부터라 **확인받고** 다시 보낸다
            if (res.status === 409 && data.code === "RESET_CONFIRM" && !confirmReset) {
              setEditUploading(false);
              if (window.confirm(data.error)) await handleEditContract(e, true);
              return;
            }
            toast.error(data.error || "계약서 수정에 실패했습니다.");
          } catch {
            toast.error(`계약서 수정 실패 (${res.status})`);
          }
          setEditUploading(false);
          return;
        }

        try {
          const data = await res.json();
          toast.success(data.reset ? "수정했습니다 — 결재를 1단계부터 다시 받습니다." : "계약서가 수정되었습니다.");
          await fetchContracts().catch(() => {});   // 목록(결재 순서 포함)을 먼저 받고 닫는다 — 계약 구분을 바꾼 직후 옛 순서로 발송 창이 열리지 않게(검증 D2). 재조회 실패는 저장과 무관하니 창은 닫는다
          setEditOpen(false);
          setEditingContract(null);
          setEditForm({ title: "", type: "", startDate: "", endDate: "", salary: "" }); setEditExtraFields({});
          setEditFile(null);
          setEditUploading(false);
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
            ...(confirmReset ? { confirmReset: true } : {}),
          }),
        });

        if (!res.ok) {
          try {
            const data = await res.json();
            // 서명(또는 반려)이 있는 계약 — 저장하면 결재가 처음부터라 **확인받고** 다시 보낸다
            if (res.status === 409 && data.code === "RESET_CONFIRM" && !confirmReset) {
              setEditUploading(false);
              if (window.confirm(data.error)) await handleEditContract(e, true);
              return;
            }
            toast.error(data.error || "계약서 수정에 실패했습니다.");
          } catch {
            toast.error(`계약서 수정 실패 (${res.status})`);
          }
          setEditUploading(false);
          return;
        }

        try {
          const data = await res.json();
          toast.success(data.reset ? "수정했습니다 — 결재를 1단계부터 다시 받습니다." : "계약서가 수정되었습니다.");
          await fetchContracts().catch(() => {});   // 목록(결재 순서 포함)을 먼저 받고 닫는다 — 계약 구분을 바꾼 직후 옛 순서로 발송 창이 열리지 않게(검증 D2). 재조회 실패는 저장과 무관하니 창은 닫는다
          setEditOpen(false);
          setEditingContract(null);
          setEditForm({ title: "", type: "", startDate: "", endDate: "", salary: "" }); setEditExtraFields({});
          setEditFile(null);
          setEditUploading(false);
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
    "지점주소", // 지점 표의 주소 — 인사발령통지서 현 근무지(2026-10-13)
    "신규입사", "재계약"]; // 계약 구분 라디오가 담당 — 입력란으로 노출하지 않는다
  const FORM_FIELDS = ["제목", "계약시작일", "계약종료일", "연봉"];
  const [templateFields, setTemplateFields] = useState<string[]>([]);
  const [employeeFillFields, setEmployeeFillFields] = useState<string[]>([]); // 직원이 서명 시 직접 입력(퇴사일자 등)
  const [fieldSettings, setFieldSettings] = useState<FieldSettings>({}); // 양식 칸 설정(#22 1단계) — 보내기 전 수정·자동·필수
  const [fieldTypes, setFieldTypes] = useState<Record<string, { type: string; options?: string[] }>>({}); // PDF 칸 배치(#22 2단계)의 칸 종류 — 체크박스·드롭다운·날짜
  const [extraFields, setExtraFields] = useState<Record<string, string>>({});
  const [templateConditions, setTemplateConditions] = useState<string[]>([]); // 템플릿의 {#조건} 이름들
  const [fieldConditions, setFieldConditions] = useState<Record<string, string>>({}); // 필드 → 소속 조건
  const [contractKind, setContractKind] = useState("신규입사"); // 계약 구분
  // 외부 계약: 직원 정보가 없어 개인정보류 자동 필드도 관리자가 직접 입력
  const EXTERNAL_INPUT_FIELDS = ["지점", "직책", "직급", "연락처", "이메일", "생년월일", "주소", "입사일", "사원번호"];
  // 계약 구분에 해당하지 않는 조건 구간의 필드 + 직원 직접입력 필드는 관리자 입력란에서 숨김
  // 칸 설정(#22 1단계): 「보내기 전 수정」 칸은 자동 칸이라도 입력란에 보이고, 「자동 입력」으로 정한 칸은 숨긴다
  const dynamicFields = templateFields
    .filter(f => !FORM_FIELDS.includes(f) && f !== "계약구분" && fieldSettings[f]?.mode !== "auto"
      && (fieldSettings[f]?.mode === "edit" || fieldSettings[f]?.mode === "hq" || !AUTO_FIELDS.includes(f) || (externalMode && EXTERNAL_INPUT_FIELDS.includes(f))))
    .filter(f => !employeeFillFields.includes(f) || externalMode || (fieldSettings[f]?.mode !== undefined && fieldSettings[f]?.mode !== "sign")) // 외부인은 서명 화면 입력이 없어 전부 관리자 입력. 묶음에서 다른 문서가 「서명 때 직원 입력」이어도 이 문서 설정이 본부 입력이면 입력란을 둔다(10/13 3차 검증)
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

  // 패키지가 자동으로 고르는 문서는 **사본을 빼고 등록 순서(최근 먼저)로만** 고른다 — 목록의 「맨 위 고정」이나
  // 「사본 만들기」(#78)가 발송 문서를 몰래 바꾸지 않게(#78 검증 F1: 사직원 사본이 퇴사 패키지로 나갔다)
  const pkgTemplates = templates
    .filter(t => !/\(사본( \d+)?\)/.test(t.name))
    .sort((x, y) => (y.createdAt || "").localeCompare(x.createdAt || ""));
  // 신규입사 패키지에 함께 발송할 문서(비밀유지·개인정보동의서) 자동 탐색
  // 「[채용] …」(입사 전 지원자용, 2026-10-13 추가 8종)은 신규입사·코디·외부 패키지의 동반 문서가 아니다 — 이름 부분매치 탐색기에서 뺀다(등록만 하고 탐색기 점검을 빼먹어 패키지가 엉뚱한 양식으로 간 사고 3회)
  const ndaTemplate = pkgTemplates.find(t => t.name.includes("비밀유지") && !t.name.includes("퇴직") && !t.name.includes("[채용]"));
  const privacyTemplate = pkgTemplates.find(t => t.name.includes("개인정보") && !t.name.includes("[채용]"));
  // 신규입사 패키지의 근로계약서 — 에듀플렉스 명시 우선.
  // 코디·기타직무(외부용) 근로계약서는 제외 — 이름 부분매치로 새 템플릿이 끼어들면
  // "신규입사 체크 시 에듀플렉스 강제 전환"이 엉뚱한 계약서로 가는 사고 재발(코디 사고와 동일 패턴)
  const empTemplate = pkgTemplates.find(t => t.name.includes("에듀플렉스") && t.name.includes("근로계약"))
    || pkgTemplates.find(t => t.name.includes("근로계약") && !t.name.includes("코디") && !t.name.includes("기타직무"))
    || pkgTemplates.find(t => t.type === "EMPLOYMENT" && !t.name.includes("코디") && !t.name.includes("기타직무"));
  const canBundle = !!privacyTemplate && !!empTemplate;   // 신규입사 패키지 2종(#202) — 비밀유지서약서는 안 들어간다

  // 퇴사 패키지 5종 — 전부 결재라인(비밀유지서약서(퇴직시)도 결재표 신설로 결재라인, 2026-08-25)
  // 코디 채용 패키지 — 코디 계약서 4종(정규직 주40/주35·계약직 일반/단기) 중 선택 + 비밀유지·개인정보동의서
  const codiTemplates = pkgTemplates.filter(t => t.name.includes("코디") && t.name.includes("근로계약서"));
  const canCodiBundle = codiTemplates.length > 0 && !!ndaTemplate && !!privacyTemplate;

  // 외부 채용 패키지 — 기타직무 계약서(학습실장 등) + 비밀유지·개인정보동의서, 게스트 링크 하나로 함께 서명
  const extTemplate = pkgTemplates.find(t => t.name.includes("기타직무"));
  const canExtBundle = !!extTemplate && !!ndaTemplate && !!privacyTemplate;

  const resignTemplates = [
    pkgTemplates.find(t => t.name.includes("사직원")),
    pkgTemplates.find(t => t.name.includes("금품청산")),
    pkgTemplates.find(t => t.name.includes("퇴직금 정산")),
    pkgTemplates.find(t => t.name.includes("연차수당")),
    pkgTemplates.find(t => t.name.includes("비밀유지") && t.name.includes("퇴직")),
  ];
  const canResignBundle = resignTemplates.every(Boolean);
  // 근속 1년 미만이면 퇴직금 정산 신청서를 패키지에서 뺀다(#213-7, 퇴직급여보장법 — 계속근로기간 1년 미만은 퇴직금 없음).
  // 퇴사일자는 **마지막 근무일**(근무종료일과 같다)이라 계속근로기간은 그 다음 날까지로 센다 — 1/1 입사·12/31 마지막 근무 = 만 1년(a59a786 검증 F1).
  // null = 판정 불가(입사일·퇴사일자 없음, 또는 퇴사일자가 입사일보다 앞) → 5종 그대로. 판정이 틀렸을 때를 위해 「퇴직금 정산 신청서 포함」 토글을 둔다
  const [forceSeverance, setForceSeverance] = useState(false);
  const resignUnderOneYear: boolean | null = (() => {
    const emp = employees.find(e => e.id === createForm.userId);
    const hire = emp?.hireDate ? String(emp.hireDate).slice(0, 10) : "";
    const resign = (extraFields["퇴사일자"] || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hire) || !/^\d{4}-\d{2}-\d{2}$/.test(resign)) return null;
    const h = new Date(`${hire}T00:00:00Z`); const r = new Date(`${resign}T00:00:00Z`);
    if (isNaN(h.getTime()) || isNaN(r.getTime()) || r < h) return null;
    const end = new Date(r.getTime() + 86400000);   // 마지막 근무일 다음 날 = 퇴직일
    let months = (end.getUTCFullYear() - h.getUTCFullYear()) * 12 + (end.getUTCMonth() - h.getUTCMonth());
    if (end.getUTCDate() < h.getUTCDate()) months -= 1;
    return months < 12;
  })();
  const dropSeverance = resignUnderOneYear === true && !forceSeverance;   // 실제로 빼는가
  // 퇴사 패키지에 실제로 들어가는 문서(#203) — 사직원 고정, 나머지는 고른 것만, 퇴직금은 근속 1년 미만이면 자동 제외
  const resignIncluded = resignTemplates.map((t, i) => !!t && (i === 0 || resignPicks[i]) && !(i === 2 && dropSeverance));
  const resignCount = resignIncluded.filter(Boolean).length;

  // 선택 템플릿 + (패키지면) 묶음 문서들 필드까지 스캔해 입력란 합집합 구성
  // keepValues: 퇴사 패키지 「문서 고르기」처럼 입력 도중 문서 구성만 바뀔 때 — 입력값(퇴사일자 등)은 지우지 않고 칸 목록만 갈아끼운다(10/14 검증 1)
  const scanFields = async (templateId: string, includeBundle: boolean, resignScan = false, withNda = true, picks: boolean[] = resignPicks, keepValues = false) => {
    const seq = ++scanSeqRef.current;   // 연달아 바꾸면 마지막 호출만 반영(먼저 끝난 옛 스캔이 덮지 않게)
    if (!keepValues) {
      setDayHours(Array(7).fill("")); // 템플릿·모드가 바뀌면 요일별 계산 보조칸도 초기화 (잔존값 합산 사고 방지)
      lastAutoEnd.current = ""; // 종료일 자동값 추적도 리셋
      setExtraFields({}); setContractKind("신규입사"); setTransferCustom(false);
    }
    setTemplateFields([]); setTemplateConditions([]); setFieldConditions({}); setEmployeeFillFields([]); setFieldSettings({}); setFieldTypes({});
    const ids = [templateId];
    if (includeBundle) {
      if (ndaTemplate && withNda) ids.push(ndaTemplate.id);   // 신규입사 패키지(#202)는 비밀유지서약서를 넣지 않는다(코디·외부 패키지는 넣는다)
      if (privacyTemplate) ids.push(privacyTemplate.id);
    }
    if (resignScan) {
      resignTemplates.forEach((t, i) => { if (t && picks[i] && !ids.includes(t.id)) ids.push(t.id); });   // 고른 문서만(#203)
    }
    const results = await Promise.all(
      ids.map(id => fetch(`/api/contract-templates/${id}/fields${externalMode ? "?external=1" : ""}`).then(r => r.json()).catch(() => ({})))
    );
    if (seq !== scanSeqRef.current) return;   // 그 사이 다른 스캔이 시작됐다
    const fields: string[] = [];
    const conditions: string[] = [];
    const empFill: string[] = [];
    const fieldConds: Record<string, string> = {};
    const docsMap: Record<string, string> = {}; // 필드 → 출처 문서명 (#113)
    const settingsMap: FieldSettings = {};   // 칸 설정(#22 1단계) — 묶음이면 문서별 설정을 합친다
    const typesMap: Record<string, { type: string; options?: string[] }> = {};   // 칸 종류(#22 2단계, PDF 배치만)
    // 같은 칸을 문서마다 다르게 정했으면: 사람이 적는 방식(보내기 전 수정 > 본부 입력)이 이기고(입력란이 있어야 그 문서에 값이 간다), 필수는 하나라도 있으면 필수
    const RANK: Record<string, number> = { edit: 3, hq: 2, sign: 1, auto: 0 };
    results.forEach((d, i) => {
      for (const [k, s] of Object.entries((d.settings || {}) as FieldSettings)) {
        const cur = settingsMap[k];
        if (!cur) { settingsMap[k] = { ...s }; continue; }
        const win = (RANK[s.mode ?? ""] ?? -1) > (RANK[cur.mode ?? ""] ?? -1) ? s : cur;
        settingsMap[k] = { ...win, required: !!(cur.required || s.required) || undefined };
      }
      const docName = templates.find(t => t.id === ids[i])?.name || "";
      for (const f of d.fields || []) {
        if (!fields.includes(f)) fields.push(f);
        if (docName) docsMap[f] = docsMap[f] && docsMap[f] !== docName ? "여러 문서 공통" : (docsMap[f] || docName);
      }
      for (const c of d.conditions || []) if (!conditions.includes(c)) conditions.push(c);
      for (const f of d.employeeFields || []) if (!empFill.includes(f)) empFill.push(f);
      Object.assign(fieldConds, d.fieldConditions || {});
      Object.assign(typesMap, d.types || {});
    });
    setTemplateFields(fields); setTemplateConditions(conditions); setFieldConditions(fieldConds); setEmployeeFillFields(empFill); setFieldDocs(docsMap); setFieldSettings(settingsMap); setFieldTypes(typesMap);

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

  // 연봉 기본값 3,400만 원(#213-5, 2026-10-16 이예지 QA) — 에듀플렉스 근로계약서 신규입사를 한 명씩 작성할 때만, 연봉 칸이 비어 있으면 이 값으로 본다.
  // 여러 명 작성·재계약·코디·다른 양식엔 넣지 않는다 — 「연봉 꼭 입력」 막기(9/16)가 살아 있어야 하고, 연봉 칸 없는 양식으로 값이 새면 안 된다(검증 M3).
  // 10/16 이예지 재확인 「직원을 고르면 빈칸이 된다」 — 상태에 한 번 써 넣던 방식은 화면 갱신 순서에 따라 지워졌다. 이제 상태에 쓰지 않고
  // 화면 표시·검사·저장이 모두 effSalary 를 쓴다(조건이 풀리면 저절로 빈칸, 고친 값은 그대로)
  const SALARY_DEFAULT = "34000000";
  const salaryDefaultOn = useTemplate && !bulkMode && !!empTemplate && selectedTemplate === empTemplate.id && contractKind === "신규입사"
    && templateFields.some((f) => ["연봉", "연봉한글", "연봉총액", "월급여합계", "기본급", "연봉숫자"].includes(f));
  const effSalary = String(createForm.salary || "").trim() || (salaryDefaultOn ? SALARY_DEFAULT : "");

  // 작성 종류 고르기(#87) — 각 체크박스가 하던 일을 한 번에(입사=신규입사 패키지, 재계약=근로계약서+계약 구분 재계약, 퇴사=퇴사 패키지)
  const startKind = (k: "hire" | "renew" | "resign" | "other") => {
    setUseTemplate(true); setExternalMode(false); setExtBundleMode(false); setCodiBundleMode(false);
    if (k === "hire" && empTemplate) {
      const et = empTemplate;
      setResignBundleMode(false); setBundleMode(canBundle); setContractKind("신규입사");
      setSelectedTemplate(et.id);
      setCreateForm(f => ({ ...f, title: autoContractTitle(f.userId, et.id, canBundle), type: et.type }));
      scanFields(et.id, canBundle, false, false);
    } else if (k === "renew" && empTemplate) {
      const et = empTemplate;
      setBundleMode(false); setResignBundleMode(false);
      setSelectedTemplate(et.id);
      setCreateForm(f => ({ ...f, title: autoContractTitle(f.userId, et.id, false), type: et.type }));
      scanFields(et.id, false);
      setContractKind("재계약");   // scanFields 가 첫 await 전에 「신규입사」로 되돌리므로 반드시 그 뒤(검증 H1)
    } else if (k === "resign" && canResignBundle && resignTemplates[0]) {
      const sajik = resignTemplates[0];
      setBundleMode(false); setResignBundleMode(true); setForceSeverance(false); setResignPicks([...RESIGN_PICK_DEFAULT]);
      setBulkMode(false); setBulkUserIds([]);
      setSelectedTemplate(sajik.id);
      setCreateForm(f => ({ ...f, title: autoContractTitle(f.userId, sajik.id, false, true), type: sajik.type }));
      scanFields(sajik.id, false, true, true, [...RESIGN_PICK_DEFAULT]);
    } else {
      setBundleMode(false); setResignBundleMode(false); setContractKind("신규입사");
      setSelectedTemplate("");
      // 앞 양식의 칸·입력값·제목이 남지 않게(검증 L2) — 진행 중이던 칸 읽기도 버린다
      scanSeqRef.current++;
      setTemplateFields([]); setTemplateConditions([]); setFieldConditions({}); setEmployeeFillFields([]); setFieldSettings({}); setFieldTypes({});
      setExtraFields({});
      setCreateForm(f => ({ ...f, title: "" }));
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      setCreateForm(f => ({ ...f, title: autoContractTitle(f.userId, templateId, bundleMode, resignBundleMode), type: template.type }));
      scanFields(templateId, bundleMode || extBundleMode, resignBundleMode, !bundleMode);
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

  // 포털 인사카드가 채워 줄 빈 칸 이름(#25) — 직원을 고를 때마다 조회(값은 받지 않는다)
  useEffect(() => {
    const uid = createForm.userId;
    if (!uid) return;
    let stop = false;
    fetch(`/api/admin/hr-contact?userId=${encodeURIComponent(uid)}`).then(r => (r.ok ? r.json() : null)).then(d => { if (!stop && d) setPortalFill({ userId: uid, fields: d.fillable || [] }); }).catch(() => {});
    return () => { stop = true; };
  }, [createForm.userId]);

  // 「보내기 전 수정」 칸의 자동값(#22 1단계) — 직원 선택 효과와 일괄 작성 루프가 같이 쓴다
  const empAutoValues = (emp: Employee): Record<string, string> => ({
    직원명: emp.name, 이름: emp.name, 이메일: emp.email ?? "", 연락처: emp.phone ?? "", 지점: emp.branch ?? "", 직급: emp.position ?? "",
    입사일: emp.hireDate ? String(emp.hireDate).slice(0, 10) : "", 사원번호: emp.empNo != null ? String(emp.empNo).padStart(5, "0") : "",
    생년월일: emp.birthDate ? String(emp.birthDate).slice(0, 10) : "", 작성일: format(new Date(), "yyyy-MM-dd"),
  });
  // 추가 템플릿 8종(2026-10-13) 파생 칸 — 육아휴직원 복직예정일 = 휴직종료일 다음 날, 인사발령통지서 인수인계완료일 = 발령일 전날, 발령사유 기본 문구
  const autoDerived = useRef<Record<string, string>>({});
  useEffect(() => {
    const u: Record<string, string> = {};
    const nextDay = (ymd: string, delta: number) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ""; const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10); };
    const keep = (k: string) => { const cur = (extraFields[k] || "").trim(); return !cur || cur === autoDerived.current[k]; };   // 손으로 고친 값은 둔다
    if (templateFields.includes("복직예정일") && keep("복직예정일")) { const v = nextDay(extraFields["휴직종료일"] || "", 1); if (v !== (extraFields["복직예정일"] || "")) u["복직예정일"] = v; }
    if (templateFields.includes("인수인계완료일") && keep("인수인계완료일")) { const v = nextDay(extraFields["발령일"] || "", -1); if (v !== (extraFields["인수인계완료일"] || "")) u["인수인계완료일"] = v; }
    if (templateFields.includes("발령사유") && !(extraFields["발령사유"] || "").trim()) u["발령사유"] = "회사 경영상 필요에 따른 인력 재배치";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Object.keys(u).length) { Object.assign(autoDerived.current, u); setExtraFields(prev => ({ ...prev, ...u })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateFields, extraFields["휴직종료일"], extraFields["발령일"], extraFields["복직예정일"], extraFields["인수인계완료일"], extraFields["발령사유"]]);

  // 직원 선택 시 생년월일(프로필 있으면)·원장명(지점 메인 원장) 자동 채움.
  // 직원·지점 목록이 나중에 와도 다시 돈다 — 같은 직원이면 **빈칸만** 채워 직접 고친 값은 두고, 직원이 바뀌면 덮어쓴다(#213-4)
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
      // 근로계약 기간 시작(제1조 {근로시작일}) = 직원 관리 입사일(포털 인사카드와 대조한 값, 재입사자는 재입사일)(2026-10-16 이예지 QA 3순위)
      if (templateFields.includes("근로시작일")) updates["근로시작일"] = hire;
    } else {
      // 입사일이 없는 직원으로 바꾸면 앞 직원의 입사일(자동값)이 남지 않게 비운다(검증 M1 — 평가 기준일까지 따라갔다).
      // 같은 직원에서 손으로 적은 값은 아래 규칙(빈칸·자동값만 바꿈)대로 그대로 둔다
      for (const k of ["근무시작일", "연차시작일", "근로시작일"]) if (templateFields.includes(k)) updates[k] = "";
    }
    if (templateFields.includes("원장명") && emp.branch) {
      const n = branchManagerName(emp.branch);
      if (n) updates["원장명"] = n;
    }
    // 「보내기 전 수정」 칸(#22 1단계) — 직원 정보·오늘 날짜를 미리 채워 두고 본부가 고친다(직군·주소는 화면에 없어 서버가 문서 만들 때 채움)
    const empAuto = empAutoValues(emp);
    for (const f of templateFields) if (fieldSettings[f]?.mode === "edit" && empAuto[f]) updates[f] = empAuto[f];
    const sameUser = lastAutoFillUser.current === createForm.userId;
    lastAutoFillUser.current = createForm.userId;
    if (!sameUser) autoFilled.current = {};
    if (Object.keys(updates).length) setExtraFields(prev => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(updates)) {
        const cur = (prev[k] || "").trim();
        // 직원이 바뀌었거나, 빈칸이거나, 아직 자동값 그대로(예: 메인 원장 목록이 늦게 와서 임시로 넣은 다른 원장)면 바꾼다
        if (!sameUser || !cur || cur === autoFilled.current[k]) { next[k] = v; autoFilled.current[k] = v; }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createForm.userId, templateFields, employees, mainManagers, fieldSettings]);

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
        const weeklyRest = week >= 15 ? Math.min((week / 40) * 8, 8) : 0; // 주휴시간 (비례, 최대 8h) — 주 15시간 미만은 주휴 없음(근로기준법 제18조 3항)
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
  //  2026-10-16 B7(이예지 QA, 근로계약서 제3조 「입사일부터 영업일 기준 14일」): 교육평가 종료 = 입사일부터 영업일 14일째,
  //  실무평가 시작 = 그다음 날(달력 — 주말일 수 있다). 영업일 = 주말·공휴일 제외. 예) 10/14→11/02, 10/20→11/06·실무 11/07.
  //  (종전 「15번째 영업일 전날」은 사이에 주말이 끼면 교육평가 종료가 일요일로 밀렸다. 옛 확정례 7/6 입사→실무 7/27 은 새 규칙으로 7/25)
  //  실무평가 종료 = 입사일 + 3개월 - 1일
  const [holidaySet, setHolidaySet] = useState<Set<string>>(new Set());

  // 기준일 — 담당자가 문서의 {근로시작일}을 직접 넣었으면 그 값이 우선, 없으면 계약 시작일.
  // 재계약의 근로시작일은 "최초 입사일"이라 평가 단계 기준으로 쓰면 안 된다 (#175, 2026-08-31)
  const evalBaseDate =
    (contractKind === "신규입사" && (extraFields["근로시작일"] || "").trim()) || createForm.startDate;
  // 여러 명 작성 표의 사람별 회색 값(10/16 이예지 재확인 2) — 실제로 들어갈 값과 같은 규칙: 공통 칸에 손으로 적은 근로시작일이면 모두에게,
  // 아니면 각자 입사일(첫 직원 입사일이 자동으로 들어간 공통값은 손으로 적은 것으로 보지 않는다). 신규입사면 그 사람 기준 평가 기간도
  const bulkRowCommon: Record<string, Record<string, string>> = {};
  if (bulkMode && templateFields.includes("근로시작일")) {
    const hireOf = (uid: string) => { const e = employees.find(x => x.id === uid); return e?.hireDate ? String(e.hireDate).slice(0, 10) : ""; };
    const commonStart = (extraFields["근로시작일"] || "").trim();
    const manual = commonStart && commonStart !== hireOf(createForm.userId) ? commonStart : "";
    for (const uid of bulkUserIds) {
      const rowStart = normDate(bulkValues[uid]?.["계약시작일"] || "") || createForm.startDate;   // 그 사람 계약 시작일(표 값 우선)
      const start = manual || hireOf(uid);
      // 실제 저장: 근로시작일이 비면 서버가 계약 시작일로 채우고, 평가 기준일도 계약 시작일이 된다(검증 2)
      const base = normDate(bulkValues[uid]?.["근로시작일"] || "") || start || rowStart;
      const row: Record<string, string> = { 근로시작일: start || rowStart };
      // 기준일이 공통 기준일과 같으면 공통 평가값(손으로 고친 값 포함)이 그대로 들어간다 — 다를 때만 그 사람 기준으로 다시 센 값
      if (base && base !== evalBaseDate && contractKind === "신규입사" && templateFields.includes("교육평가시작")) Object.assign(row, evalPeriods(base, holidaySet) || {});
      bulkRowCommon[uid] = row;
    }
  }
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
    // 교육평가 종료 = 입사일부터 영업일 기준 14일째(근로계약서 제3조, 입사일이 영업일이면 1일째), 실무평가 시작 = 그다음 날.
    // 2026-10-16 이예지 QA B7: 종전엔 「15번째 영업일 전날」이라 사이에 주말이 끼면 종료일이 일요일로 밀렸다(10/20 → 11/08)
    const d = new Date(start + "T00:00:00Z");
    let count = 0;
    let guard = 0;
    while (count < 14 && guard++ < 60) {
      if (isBiz(d)) count++;
      if (count < 14) d.setUTCDate(d.getUTCDate() + 1);
    }
    const eduEnd = fmt(d);
    const pracStart = new Date(d);
    pracStart.setUTCDate(pracStart.getUTCDate() + 1);
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
    fetch("/api/branches").then(r => r.json()).then(d => {
      const m: Record<string, string> = {}; const ids: Record<string, string> = {};
      const addr: Record<string, string> = {};
      for (const b of (d.branches || []) as { name: string; address?: string | null; mainManager?: { id: string; name: string } | null }[]) {
        if (b.mainManager?.name) { m[b.name] = b.mainManager.name; ids[b.name] = b.mainManager.id; }
        if (b.address) addr[b.name] = b.address;
      }
      setBranchAddresses(addr);
      setMainManagers(m); setMainManagerIds(ids);
    }).catch(() => {});
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

  // 단건 작성에 보내는 동적 입력값 — 계약서 작성(handleCreate)과 나에게 테스트 발송(#67)이 같은 값을 쓴다
  function buildSingleExtra(): Record<string, string> {
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
    return allExtra;
  }

  // 나에게 테스트 발송(#67) — 지금 고른 양식·입력값으로 **관리자 본인이 서명자**인 시험 문서를 만들어 바로 보낸다.
  // 직원 선택은 쓰지 않는다(서명자가 나). 결재선은 본인 서명 한 단계라 다른 사람에게는 알림이 가지 않는다.
  // 시험 문서는 「내 계약서」에서 서명자 화면 그대로 보이고, 이 목록에서는 「내 테스트 문서만」을 켜면 보인다. 7일 뒤 자동 삭제
  async function handleTestSend() {
    if (!useTemplate && files.length === 0) { toast.error("파일을 선택하거나 템플릿을 고르세요."); return; }
    if (useTemplate && !selectedTemplate) { toast.error("템플릿을 선택해주세요."); return; }
    const needsSalary = useTemplate && templateFields.some((f) => ["연봉", "연봉한글", "연봉총액", "월급여합계", "기본급", "연봉숫자"].includes(f));
    if (needsSalary && !String(effSalary || "").trim()) { toast.error("연봉을 입력해주세요. 급여표와 연봉 한글 표기가 이 값으로 계산됩니다."); return; }
    if (testSending) return;
    setTestSending(true);
    try {
      const formData = new FormData();
      formData.append("testSend", "1");
      if (useTemplate && selectedTemplate) formData.append("templateId", selectedTemplate);
      else files.forEach((file) => formData.append("files", file));
      formData.append("title", createForm.title || templates.find(t => t.id === selectedTemplate)?.name || "테스트 문서");
      formData.append("type", createForm.type);
      formData.append("startDate", createForm.startDate);
      formData.append("endDate", createForm.endDate);
      formData.append("salary", effSalary);
      const allExtra = buildSingleExtra();
      if (Object.keys(allExtra).length > 0) formData.append("extraFields", JSON.stringify(allExtra));
      const res = await fetch("/api/contracts", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "테스트 발송에 실패했습니다."); return; }
      toast.success("테스트 문서를 나에게 보냈습니다. 「내 계약서」에서 서명자 화면을 확인하세요. 이 목록에서는 「내 테스트 문서만」을 켜면 보입니다(7일 뒤 자동 삭제).", {
        duration: 10000, action: { label: "내 계약서 열기", onClick: () => window.open("/contracts", "_blank") },
      });
      setCreateOpen(false);
      setFiles([]); setUseTemplate(false); setSelectedTemplate(""); setEmployeeSearchText("");
      setCreateForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "", salary: "" }); setTemplateFields([]); setExtraFields({}); setTemplateConditions([]); setFieldConditions({}); setContractKind("신규입사");
      fetchContracts();
    } finally {
      setTestSending(false);
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
    // 임금(연봉)은 기본급·월급여합계·연봉총액·연봉한글이 모두 여기서 계산된다 — 비우면 문서에 빈칸이 박힌다(2026-09-16 디렉터 지시)
    const needsSalary = useTemplate && templateFields.some((f) => ["연봉", "연봉한글", "연봉총액", "월급여합계", "기본급", "연봉숫자"].includes(f));
    // 여러 명 작성이면 개인별 표에 모두 연봉을 넣었을 때도 통과(#19)
    const allRowSalary = bulkMode && bulkUserIds.length > 0 && bulkUserIds.every(uid => (bulkValues[uid]?.["연봉"] || "").replace(/[^0-9]/g, ""));
    if (needsSalary && !String(effSalary || "").trim() && !allRowSalary) { toast.error("연봉을 입력해주세요. 급여표와 연봉 한글 표기가 이 값으로 계산됩니다."); return; }
    // 양식에서 필수로 정한 칸(#22 1단계) — 비면 보내지 않는다. 여러 명 작성은 공통값이나 개인별 표 둘 중 하나에 있으면 된다
    {
      const reqFields = dynamicFields.filter(f => fieldSettings[f]?.required);
      const has = (uid: string | null, f: string) => !!(extraFields[f] || "").trim() || (uid ? !!(bulkValues[uid]?.[f] || "").trim() : false);
      const missingReq = bulkMode && !externalMode
        ? bulkUserIds.flatMap(uid => reqFields.filter(f => !has(uid, f)).map(f => `${employees.find(e => e.id === uid)?.name ?? uid}: ${f}`))
        : reqFields.filter(f => !has(null, f));
      if (missingReq.length) { toast.error(`필수 칸을 입력해 주세요: ${[...new Set(missingReq)].slice(0, 6).join(", ")}${missingReq.length > 6 ? ` 외 ${missingReq.length - 6}` : ""}`); return; }
    }

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
      // 개인별 날짜(#19) — 못 읽는 날짜가 있으면 만들기 전에 멈춘다
      const rowDate = (uid: string, k: "계약시작일" | "계약종료일", fallback: string) => {
        const raw = bulkValues[uid]?.[k] || "";
        return raw.trim() ? normDate(raw) : fallback;
      };
      // 계약 기간 + 근로시작일·평가 기간(사람별 날짜 칸, 10/16) 모두 — 표에 적은 날짜를 못 읽으면 멈춘다
      const curCols = bulkColumns(templateFields, templateFields.some((f) => ["연봉", "연봉한글", "연봉총액", "월급여합계", "기본급", "연봉숫자"].includes(f))).filter((c) => !fieldConditions[c] || fieldConditions[c] === contractKind);
      const badDates = bulkUserIds.flatMap(uid => DATE_COLS
        .filter(k => curCols.includes(k))
        .filter(k => { const raw = bulkValues[uid]?.[k] || ""; return raw.trim() !== "" && normDate(raw) === null; })
        .map(k => `${employees.find(x => x.id === uid)?.name ?? "?"} ${k}`));
      if (badDates.length) { toast.error(`날짜를 읽지 못했습니다: ${badDates.join(", ")} — 2026-10-01 형식으로 고쳐 주세요.`); setUploading(false); return; }
      // 근로시작일 — 공통 칸에 손으로 적었으면(자동으로 넣은 첫 직원 입사일이 아니면) 모두에게, 아니면 각자 입사일(검증 M2)
      const commonStart = (extraFields["근로시작일"] || "").trim();
      const manualStart = commonStart && commonStart !== (autoFilled.current["근로시작일"] || "") ? commonStart : "";
      const startOf = (uid: string) => {
        const e = employees.find(x => x.id === uid);
        return normDate(bulkValues[uid]?.["근로시작일"] || "") || manualStart || (e?.hireDate ? String(e.hireDate).slice(0, 10) : "");
      };
      // 신규입사 평가 기간은 근로시작일부터라, 근로시작일이 계약 시작일보다 앞이면 평가 기간이 계약 기간 밖으로 나가 서버가 거절한다 — 미리 알린다
      if (contractKind === "신규입사" && templateFields.includes("근로시작일") && templateFields.includes("교육평가시작")) {
        const early = bulkUserIds
          .map(uid => ({ e: employees.find(x => x.id === uid), base: startOf(uid), st: rowDate(uid, "계약시작일", createForm.startDate) || "" }))
          .filter(x => x.base && x.st && x.base < x.st)
          .map(x => `${x.e?.name ?? "?"}(근로시작 ${x.base} / 계약시작 ${x.st})`);
        if (early.length) {
          toast.error(`근로시작일(입사일)이 계약 시작일보다 앞인 직원이 있습니다: ${early.join(", ")} — 신규입사 평가 기간은 근로시작일부터라 계약 기간 밖으로 나갑니다. 표의 계약시작일을 입사일로 맞추거나 근로시작일을 고쳐 주세요.`, { duration: 10000 });
          setUploading(false); return;
        }
      }
      // 계약시작일(사람별)과 입사일이 다르면 확인 — 신규입사 평가 단계는 각자 시작일로 다시 계산한다
      {
        const mismatch = bulkUserIds
          .map(uid => ({ e: employees.find(x => x.id === uid), start: rowDate(uid, "계약시작일", createForm.startDate) }))
          .filter(x => x.e?.hireDate && x.start && String(x.e.hireDate).slice(0, 10) !== x.start)
          .map(x => `${x.e!.name}(입사 ${String(x.e!.hireDate).slice(0, 10)} / 시작 ${x.start})`);
        if (mismatch.length && !confirm(`입사일과 계약시작일이 다른 직원이 있습니다: ${mismatch.join(", ")}\n계속할까요?`)) {
          setUploading(false); return;
        }
      }
      // 사람별 시작일이 공통과 다르면 평가 단계를 그 사람 시작일로 다시 센다 — 그해·다음 해 공휴일을 먼저 받는다(#19 검증 F1)
      const evalHolidays = new Set<string>(holidaySet);
      if (templateFields.includes("교육평가시작")) {
        const years = new Set<number>();
        for (const uid of bulkUserIds) {
          // 사람별 근로시작일이 다른 해일 수 있다 — 그해 공휴일도 받는다(10/16)
          for (const st of [rowDate(uid, "계약시작일", createForm.startDate) || "", startOf(uid)]) {
            const y = Number(st.slice(0, 4)); if (y > 2000) { years.add(y); years.add(y + 1); }
          }
        }
        const got = await Promise.all([...years].map(y => fetch(`/api/holidays?year=${y}`).then(r => r.json()).catch(() => ({ holidays: [] }))));
        for (const d of got) for (const h of (d.holidays || []) as { date: string }[]) evalHolidays.add(h.date);
      }
      const cols = bulkColumns(templateFields, templateFields.some((f) => ["연봉", "연봉한글", "연봉총액", "월급여합계", "기본급", "연봉숫자"].includes(f))).filter((c) => !fieldConditions[c] || fieldConditions[c] === contractKind);
      const common: Record<string, string> = {};
      for (const [k, v] of Object.entries(extraFields)) {
        if (fieldConditions[k] && fieldConditions[k] !== contractKind) continue;
        common[k] = v;
      }
      for (const f of templateFields) if (f.startsWith("체크_") && !(f in common)) common[f] = f.includes("기타") ? "□" : "☑";
      for (const f of templateFields) if (f.startsWith("선택_") && !(f in common)) common[f] = "□";
      if (templateConditions.includes("신규입사")) common["계약구분"] = contractKind;
      let ok = 0; const failed: string[] = []; const failedIds: string[] = [];
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
          // 근로시작일도 각자 입사일(10/16) — 공통값(첫 직원 것)이 새지 않게. 공통 칸에 손으로 적은 값은 모두에게(검증 M2).
          // 둘 다 없으면 비워 서버가 계약 시작일로 채운다. 표에 적으면 그 값이 우선(아래 개인별 값)
          if (templateFields.includes("근로시작일")) per["근로시작일"] = manualStart || hire;
        }
        if (templateFields.includes("원장명")) per["원장명"] = branchManagerName(emp.branch);   // 메인 원장 우선(#213-4)
        // 「보내기 전 수정」 직원 정보 칸은 **각자 값**으로 — 공통값은 첫 직원 것이라 전원에게 복사되던 것(10/13 검증 1). 작성일은 공통값 유지
        {
          const mine = empAutoValues(emp);
          for (const f of templateFields) {
            if (fieldSettings[f]?.mode !== "edit" || f === "작성일" || !(f in mine)) continue;
            if (mine[f]) per[f] = mine[f]; else delete per[f];   // 값이 없으면 서버가 프로필·포털로 채운다
          }
        }
        // 개인별 값(#19) — 표에 넣은 칸만, **지금 양식의 열**만 덮는다(양식을 바꾸기 전 값·다른 계약 구분 전용 칸은 넣지 않는다)
        const row = bulkValues[uid] || {};
        for (const [k, v] of Object.entries(row)) {
          if (!v.trim() || k === "연봉" || k === "계약시작일" || k === "계약종료일" || !cols.includes(k)) continue;
          if (fieldConditions[k] && fieldConditions[k] !== contractKind) continue;
          // 사람별 날짜 칸은 2026-10-01 꼴로 맞춘다(위에서 못 읽는 날짜는 이미 멈췄다) — 서버가 한국식 날짜로 바꾸려면 이 꼴이어야 한다
          per[k] = (PERSON_DATE_COLS as readonly string[]).includes(k) ? (normDate(v) || v.trim()) : v.trim();
        }
        // 출퇴근·휴게·주근무시간을 사람별로 넣었을 때만 일·월 근로시간을 그 사람 값으로 다시 센다(공통값을 손으로 고친 것은 둔다)
        if (["출근시각", "퇴근시각", "휴게시간", "주근무시간"].some(k => (row[k] || "").trim())) Object.assign(per, deriveHours(per, templateFields));
        const rowSalary = (cols.includes("연봉") ? (row["연봉"] || "").replace(/[^0-9]/g, "") : "") || effSalary;
        const rowStart = rowDate(uid, "계약시작일", createForm.startDate) || "";
        const rowEnd = rowDate(uid, "계약종료일", createForm.endDate) || "";
        // 신규입사 평가 단계 — 그 사람 기준일이 공통과 다르면 다시 계산(#19 검증 F1)
        if (templateFields.includes("교육평가시작")) {
          const base = (contractKind === "신규입사" && (per["근로시작일"] || "").trim()) || rowStart;
          if (base && base !== evalBaseDate) {
            const ev = evalPeriods(base, evalHolidays);
            // 표에 사람별로 적은 평가 날짜는 그대로 둔다 — 비운 칸만 그 사람 기준일로 계산(10/16)
            if (ev) for (const k of EVAL_COLS) if (!(row[k] || "").trim()) per[k] = ev[k];
          }
        }
        const title = autoContractTitle(uid, selectedTemplate, bundleMode, false) || createForm.title;
        try {
          let res: Response;
          if (bundleMode && privacyTemplate) {
            const items = [
              { templateId: selectedTemplate, title, type: "EMPLOYMENT",
                startDate: rowStart, endDate: rowEnd, salary: rowSalary,
                extraFields: per, employeeOnly: false },
              { templateId: privacyTemplate.id, title: `${titlePrefix(emp.id)} ${privacyTemplate.name}`, type: "OTHER",
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
            fd.append("startDate", rowStart);
            fd.append("endDate", rowEnd);
            fd.append("salary", rowSalary);
            fd.append("extraFields", JSON.stringify(per));
            res = await fetch("/api/contracts", { method: "POST", body: fd });
          }
          // 실패 이유(최저임금 미만 등)도 함께 보여 준다 — 이름만으로는 무엇을 고칠지 모른다
          if (res.ok) ok++; else { const d = await res.json().catch(() => ({})); failed.push(d.error ? `${emp.name}(${d.error})` : emp.name); failedIds.push(uid); }
        } catch { failed.push(emp.name); failedIds.push(uid); }
      }
      setUploading(false);
      if (failed.length) toast.error(`${ok}명 작성 완료, 실패: ${failed.join(", ")}`);
      else toast.success(`${ok}명에게 ${bundleMode ? "신규입사 패키지 2종이" : "계약서가"} 작성되었습니다. 목록에서 각각 발송해주세요.`);
      // 실패한 사람이 있으면 창을 닫지 않는다 — 개인별 값을 고쳐 그 사람만 다시 작성할 수 있게
      if (failed.length) {
        setBulkUserIds(ids => ids.filter(id => failedIds.includes(id)));   // 실패한 사람만(이름이 아니라 id 로 — 김철/김철수 혼동 방지)
        fetchContracts();
        return;
      }
      setCreateOpen(false);
      setBulkMode(false); setBulkUserIds([]); setBulkValues({});
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
          startDate: createForm.startDate, endDate: createForm.endDate, salary: effSalary,
          extraFields: allExtra, employeeOnly: false },
        { templateId: ndaTemplate.id, title: `${new Date().getFullYear()} ${extName} 비밀유지서약서(입사)`, type: "CONFIDENTIAL",
          extraFields: allExtra, employeeOnly: true },
        { templateId: privacyTemplate.id, title: `${new Date().getFullYear()} ${extName} ${privacyTemplate.name}`, type: "OTHER",
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
          startDate: createForm.startDate, endDate: createForm.endDate, salary: effSalary,
          extraFields: allExtra, employeeOnly: false },
        { templateId: ndaTemplate.id, title: `${titlePrefix(createForm.userId)} 비밀유지서약서(입사)`, type: "CONFIDENTIAL",
          extraFields: allExtra, employeeOnly: true },
        { templateId: privacyTemplate.id, title: `${titlePrefix(createForm.userId)} ${privacyTemplate.name}`, type: "OTHER",
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
      // 고른 문서만(#203, 이예지 답 10/14: 기본은 사직원·비밀유지서약서, 나머지는 필요할 때 체크). 퇴직금은 근속 1년 미만이면 자동 제외(#213-7)
      const items = [
        { templateId: rSajik.id, title: `${prefix} 사직원`, type: "OTHER", extraFields: allExtra, employeeOnly: false },
        ...(resignIncluded[1] ? [{ templateId: rGeum.id, title: `${prefix} 금품청산 지급기일연장 동의서`, type: "OTHER", extraFields: allExtra, employeeOnly: false }] : []),
        ...(resignIncluded[2] ? [{ templateId: rToejikgeum.id, title: `${prefix} 퇴직금 정산 신청서`, type: "OTHER", extraFields: allExtra, employeeOnly: false }] : []),
        ...(resignIncluded[3] ? [{ templateId: rYeoncha.id, title: `${prefix} 연차수당 정산 신청서`, type: "OTHER", extraFields: allExtra, employeeOnly: false }] : []),
        // 비밀유지서약서(퇴직시) — 결재표(원장·본부)가 서식에 추가되어 결재라인을 태운다 (QA 2026-08-25)
        ...(resignIncluded[4] ? [{ templateId: rNda.id, title: `${prefix} 비밀유지서약서(퇴직)`, type: "CONFIDENTIAL", extraFields: allExtra, employeeOnly: false }] : []),
      ];
      const res = await fetch("/api/contracts/bundle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: createForm.userId, items }),
      });
      const data = await res.json();
      setUploading(false);
      if (!res.ok) { toast.error(data.error || "퇴사 패키지 생성 실패"); return; }
      toast.success(items.length === 1
        ? "사직원만 작성되었습니다(고른 문서 없음). 사직원에서 발송해 주세요."
        : `퇴사 패키지 ${items.length}종이 작성되었습니다${resignPicks[2] && dropSeverance ? "(근속 1년 미만 — 퇴직금 정산 신청서 제외)" : ""}. 사직원에서 발송하면 함께 발송됩니다.`);
      setCreateOpen(false);
      setUseTemplate(false); setSelectedTemplate(""); setResignBundleMode(false); setForceSeverance(false); setResignPicks([...RESIGN_PICK_DEFAULT]); setEmployeeSearchText("");
      setCreateForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "", salary: "" });
      setTemplateFields([]); setExtraFields({}); setTemplateConditions([]); setFieldConditions({}); setContractKind("신규입사");
      fetchContracts();
      return;
    }

    // 신규입사 패키지: 근로계약서 + 비밀유지 + 개인정보동의서를 한 묶음으로 생성
    // 대표 문서는 반드시 에듀플렉스 근로계약서 (코디 계약서가 섞이지 않도록 서버 전송 직전 재확인)
    if (bundleMode && useTemplate && selectedTemplate && privacyTemplate) {
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
          startDate: createForm.startDate, endDate: createForm.endDate, salary: effSalary,
          extraFields: allExtra, employeeOnly: false },
        { templateId: privacyTemplate.id, title: `${titlePrefix(createForm.userId)} ${privacyTemplate.name}`, type: "OTHER",
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
      toast.success("신규입사 패키지 2종이 작성되었습니다. 근로계약서에서 발송하면 개인정보수집이용동의서가 함께 발송됩니다.");
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
    formData.append("salary", effSalary);
    {
      const allExtra = buildSingleExtra();
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

  // 한꺼번에 발송 대상 — 고른 것 중 지금도 초안인 것만(그 사이 단건으로 발송된 건 다시 보내 결재를 초기화하지 않게, #34 검증 F2)
  const pickedDrafts = contracts.filter(x => pickedIds.has(x.id) && x.status === "DRAFT" && !x.isTest);   // 시험 문서(#67)는 한꺼번에 발송에서 제외
  // 고른 것 전부(#46) — 지금 목록에 보이는 것만
  const pickedAll = contracts.filter(x => pickedIds.has(x.id));
  const [exporting, setExporting] = useState(false);
  async function exportPicked(kind: "zip" | "xlsx") {
    if (!pickedAll.length || exporting) return;
    if (pickedAll.length > 200) { toast.error(`한 번에 200건까지 받을 수 있습니다(고른 ${pickedAll.length}건). 나눠서 받아 주세요.`); return; }
    setExporting(true);
    try {
      const res = await fetch("/api/contracts/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: pickedAll.map(x => x.id), kind }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || "내려받지 못했습니다."); return; }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = m ? decodeURIComponent(m[1]) : kind === "zip" ? "계약_완료본.zip" : "계약_입력값.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch {
      toast.error("네트워크 오류로 내려받지 못했습니다.");
    } finally { setExporting(false); }
  }

  async function handleSend(id: string) {
    if (approverIds.length === 0) { toast.error("승인자를 선택해주세요."); return; }
    if (sendTarget?.externalName && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(sendExtEmail.trim())) {
      toast.error("외부 계약자가 계약서를 받을 이메일을 입력해주세요. 링크 본인 확인과 완료본 PDF 전달에 쓰입니다."); return;
    }
    const extEmailPart = sendTarget?.externalName ? { externalEmail: sendExtEmail.trim() } : {};
    if (sendingRef.current) return; // 두 번 누름 방지(요청이 끝날 때까지)
    sendingRef.current = true;
    setSending(true);
    try {

    // 패키지(묶음)면 3종을 함께 발송 — 근로계약서는 결재라인 전체, 나머지는 직원 서명만
    // 반려된 문서는 **그 문서만** 다시 보낸다(#206-4) — 패키지 발송은 반려 문서를 일부러 건너뛴다
    // 중복 발송 경고(#47) — 서버가 409 DUPLICATE 로 알려 주면 목록을 보여 주고, 확인하면 다시 보낸다
    const askDup = askDuplicate;
    const post = async (url: string, method: string, payload: Record<string, unknown>) => {
      let res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      let data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.code === "DUPLICATE") {
        if (!askDup(data)) return null;
        res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, confirmDuplicate: true }) });
        data = await res.json().catch(() => ({}));
      }
      return { res, data };
    };

    const bundleId = sendTarget?.bundleId;
    if (bundleId && sendTarget?.status !== "REJECTED") {
      // 서류별 순서 — 공통 순서와 다르게 바꾼 서류만(공통 결재자에서 빠진 사람은 뺀다)
      const docOrdersPayload: Record<string, string[]> = {};
      for (const [cid, ord] of Object.entries(docOrders)) {
        const o = ord.filter((x) => approverIds.includes(x));
        if (o.length > 0 && o.join(",") !== approverIds.join(",")) docOrdersPayload[cid] = o;
      }
      const r = await post(`/api/contracts/bundle/${bundleId}/send`, "POST", { approverIds, sendMessage: sendMsg, deadlineDays: Number(deadlineDays) || 14, ...extEmailPart, ...(Object.keys(docOrdersPayload).length ? { docOrders: docOrdersPayload } : {}) });
      if (!r) return;
      const { res, data } = r;
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

    const r = await post(`/api/contracts/${id}`, "PATCH", { status: "SENT", approverIds, sendMessage: sendMsg, deadlineDays: Number(deadlineDays) || 14, ...extEmailPart });
    if (!r) return;
    const { res, data } = r;
    if (!res.ok) { toast.error(data.error || "발송하지 못했습니다."); return; }
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
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  // ── 승인자 슬롯 조작 (#158·#159·#213-2) ──────────────────────────────
  // 당사자 지점의 원장 id — 메인 원장 우선, 없으면 그 지점 원장(겸직 포함). 당사자 본인이 원장이면 null(같은 사람이 두 번 결재하지 않게)
  const partyBranchManagerId = (c: Contract): string | null => {
    const emp = employees.find(e => e.id === c.userId);
    const b = emp?.branch; if (!b) return null;
    const id = mainManagerIds[b] ?? employees.find(e => e.role === "MANAGER" && (e.branch === b || (e.managerBranches || []).includes(b)))?.id ?? null;
    return id && id !== c.userId ? id : null;
  };
  // 양식 순서대로 칸을 미리 채운다 — 근로자·외부는 당사자, 원장은 자동, 본부는 직접 고른 값만 유지
  const prefillSlots = (c: Contract, specs: ApprovalStepSpec[], keep: ApproverSlots = []): ApproverSlots =>
    specs.map((s, i) => {
      const k = effectiveKind(s.kind, !!c.externalName);
      if (k === "EXTERNAL") return "EXTERNAL";
      if (k === "EMPLOYEE") return c.userId;
      if (k === "MANAGER") return partyBranchManagerId(c);
      return keep[i] ?? null;
    });
  function resetApproverSlots(c?: Contract) {
    const specs = c ? (parseApprovalSteps(c.approvalSteps) ?? DEFAULT_STEPS) : DEFAULT_STEPS;
    setSlotSpecs(specs);
    setApproverSlots(c ? prefillSlots(c, specs) : specs.map(() => null));
    setActiveSlot(null);
  }
  // 결재자 한 사람의 종류 — 칸 종류와 맞는 칸에만 넣는다(양식이 순서를 고정했을 때)
  const approverKind = (id: string) => sendTarget
    ? kindOfApprover(id, { contractUserId: sendTarget.userId, external: !!sendTarget.externalName }, (uid) => (employees.find(e => e.id === uid)?.role as "ADMIN" | "MANAGER" | "EMPLOYEE" | undefined) ?? null)
    : "OTHER";
  // 순서 변경이 허용된 양식에서만: 칸 옮기기·추가·삭제(칸의 종류와 사람이 함께 움직인다)
  function moveSlot(i: number, d: -1 | 1) {
    const j = i + d; if (j < 0 || j >= slotSpecs.length) return;
    setSlotSpecs(prev => { const n = [...prev]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setApproverSlots(prev => { const n = [...prev]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setActiveSlot(null);
  }
  function removeSlot(i: number) {
    if (slotSpecs.length <= 1) return;
    setSlotSpecs(prev => prev.filter((_, k) => k !== i));
    setApproverSlots(prev => prev.filter((_, k) => k !== i));
    setActiveSlot(null);
  }
  function addSlot(kind: StepKind) {
    if (slotSpecs.length >= 6 || !sendTarget) return;
    const c = sendTarget;
    setSlotSpecs(prev => [...prev, { kind }]);
    setApproverSlots(prev => [...prev, prefillSlots(c, [{ kind }])[0]]);
    setActiveSlot(null);
  }

  // 후보 클릭 → 지정한 슬롯(없으면 비어 있는 가장 앞 슬롯 — 고정 양식이면 종류가 맞는 칸)에 배정. 같은 사람 중복 배치는 방지
  function assignApprover(id: string) {
    const kind = approverKind(id);
    const idx = activeSlot !== null ? activeSlot : approverSlots.findIndex((x, i) => !x && (!slotLocked || slotKind(i) === kind));
    if (idx < 0) {
      toast.error(slotLocked
        ? `이 양식은 결재 순서가 고정이라 ${kind === "OTHER" ? "본부·원장·당사자만 결재자가 될 수 있습니다" : `${KIND_LABEL[kind]} 칸이 비어 있을 때만 넣을 수 있습니다`}. 칸을 먼저 누르면 바꿀 수 있습니다.`
        : "빈 칸이 없습니다. 바꿀 칸을 먼저 눌러 주세요.");
      return;
    }
    if (slotLocked && activeSlot !== null && kind !== slotKind(activeSlot)) {
      toast.error(`${activeSlot + 1}단계는 ${slotLabel(activeSlot)} 칸입니다 — ${kind === "OTHER" ? "본부·원장·당사자" : KIND_LABEL[kind]}은(는) 넣을 수 없습니다(양식 결재 순서 고정).`);
      return;
    }
    setApproverSlots(prev => {
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
  // 반려 — 결재자가 "거부"할 수단이 아예 없어서, 조건이 안 맞으면 그냥 안 누르고 버티는
  // 수밖에 없었다(이유가 어디에도 안 남는다). 반려는 **최종 상태**다(디렉터 결정 2026-09-04).
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);
  async function handleReject() {
    if (!signTarget) return;
    const reason = rejectReason.trim();
    if (!reason) { toast.error("반려 사유를 입력해주세요"); return; }
    setRejectBusy(true);
    try {
      const res = await fetch(`/api/contracts/${signTarget.id}/reject`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "반려에 실패했습니다"); return; }
      toast.success("반려했습니다. 작성자와 당사자에게 알림이 갑니다.");
      setRejectOpen(false); setRejectReason(""); setSignOpen(false); setSignTarget(null);
      fetchContracts();
    } catch {
      toast.error("오류가 발생했습니다");
    } finally {
      setRejectBusy(false);
    }
  }
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
      // 서명 창을 연 뒤 문서가 수정됐으면 서버가 거절한다(문서 버전 묶기, #206 검증 F2)
      headers: { "Content-Type": "application/json", ...(signTarget?.id === id ? (typeof (signTarget as { version?: number } | null)?.version === "number" ? { "x-doc-version": String((signTarget as { version?: number }).version) } : {}) : {}) },
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
                setForceSeverance(false);   // 「퇴직금 정산 신청서 포함」 선택이 다음 직원에게 넘어가지 않게(7b92cb9 검증)
                setEmployeeSearchText("");
                setCreateForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "", salary: "" }); setTemplateFields([]); setExtraFields({}); setTemplateConditions([]); setFieldConditions({}); setContractKind("신규입사"); setSalaryFocus(false);
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
              {/* 모두싸인 체결본 가져오기(#4) — 본부만 */}
              {role === "ADMIN" && <a href="/admin/contract-import"><Button variant="outline" className="gap-2"><Upload size={16} />체결본 가져오기</Button></a>}
              <Button className="gap-2" onClick={() => { setSalaryFocus(false); setCreateOpen(true); }}><Plus size={16} />계약서 작성</Button>
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
                {/* 작성 종류(#87, 2026-10-16 이예지 QA) — 처음에 입사·재계약·퇴사 중 고르면 양식·패키지·계약 구분이 한 번에 맞춰진다. 아래에서 그대로 바꿀 수도 있다 */}
                {templates.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-500">무엇을 작성하나요?</Label>
                    <div className="flex flex-wrap gap-2">
                      {([
                        ["hire", "신규 입사", canBundle ? "근로계약서 + 개인정보동의서" : "근로계약서"],
                        ["renew", "재계약", "근로계약서(기존 근로자)"],
                        ["resign", "퇴사", "사직원 + 퇴사 서류"],
                        ["other", "그 밖의 서류", "양식을 직접 고르기"],
                      ] as const).map(([k, label, sub]) => {
                        const isEmpDoc = !!empTemplate && selectedTemplate === empTemplate.id && !resignBundleMode;
                        const on = k === "hire" ? useTemplate && (bundleMode || (isEmpDoc && contractKind !== "재계약"))
                          : k === "renew" ? useTemplate && isEmpDoc && !bundleMode && contractKind === "재계약"
                          : k === "resign" ? useTemplate && resignBundleMode
                          : useTemplate && !bundleMode && !resignBundleMode && !isEmpDoc;
                        const disabled = (k === "hire" || k === "renew") ? !empTemplate : k === "resign" ? !canResignBundle : false;
                        return (
                          <button key={k} type="button" disabled={disabled} onClick={() => startKind(k)}
                            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-40 ${on ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-gray-200 hover:bg-gray-50"}`}>
                            <span className="block font-medium">{label}</span>
                            <span className="block text-[11px] text-gray-500">{sub}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
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
                      {/* 필수(디렉터 9/11) — 서명 링크를 연 사람이 본인인지 이 번호의 뒷자리 4자리로 확인한다 */}
                      <div className="space-y-1"><Label className="text-xs">휴대폰 번호 * <span className="text-gray-400 font-normal">(본인 확인·링크 전달용)</span></Label>
                        <Input placeholder="예: 010-1234-5678" inputMode="tel" value={externalForm.phone}
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
                                scanFields(et.id, true, false, false);
                              } else if (!checked && selectedTemplate) {
                                scanFields(selectedTemplate, false);
                              }
                            }} />
                          신규입사 패키지로 함께 발송 (2종)
                        </label>
                        {bundleMode && (
                          <p className="text-[11px] text-emerald-700 pl-6">
                            근로계약서 + <b>{privacyTemplate?.name}</b>를 한 번에 발송합니다.
                            개인정보동의서는 <b>직원 서명만</b> 받으며 해당 직원에게만 표시됩니다. 비밀유지서약서는 채용 단계 「[채용] 비밀유지서약서」로 따로 보냅니다(2026-10-14 본부 확인).
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
                              setResignBundleMode(checked); setForceSeverance(false); setResignPicks([...RESIGN_PICK_DEFAULT]);
                              if (checked) { setCodiBundleMode(false); setBulkMode(false); setBulkUserIds([]); } // 일괄과 병용 불가 (검증관 2026-08-26)
                              const sajik = resignTemplates[0];
                              if (checked && sajik) {
                                // 사직원을 대표 문서로 자동 선택 + 5종 필드 합집합 스캔
                                setSelectedTemplate(sajik.id);
                                setCreateForm(f => ({ ...f, title: autoContractTitle(f.userId, sajik.id, false, true), type: sajik.type }));
                                scanFields(sajik.id, false, true, true, [...RESIGN_PICK_DEFAULT]);
                              } else if (selectedTemplate) {
                                scanFields(selectedTemplate, false, false);
                              }
                            }} />
                          퇴사 패키지로 함께 발송 ({resignCount}종)
                        </label>
                        {resignBundleMode && (
                          <div className="pl-6 space-y-1">
                            <p className="text-[11px] text-rose-700">보낼 문서를 고르세요(#203). 사직원은 대표 문서라 항상 들어갑니다. 고른 문서는 <b>전부</b> 설정한 결재라인(원장·본부 등)으로 함께 진행됩니다.</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-rose-900">
                              {RESIGN_DOC_LABELS.map((label, i) => (
                                <label key={label} className={`inline-flex items-center gap-1 ${i === 0 ? "opacity-70" : "cursor-pointer"}`}>
                                  <input type="checkbox" checked={i === 0 ? true : resignPicks[i]} disabled={i === 0}
                                    onChange={e => {
                                      const next = resignPicks.map((v, j) => (j === i ? e.target.checked : v));
                                      setResignPicks(next);
                                      if (selectedTemplate) scanFields(selectedTemplate, false, true, true, next, true);   // 고른 문서의 입력란만 보이게(입력값은 유지)
                                    }} />
                                  {label}{i === 2 && dropSeverance && resignPicks[2] ? " (1년 미만 — 자동 제외)" : ""}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                        {resignBundleMode && resignPicks[2] && resignUnderOneYear !== false && (
                          <p className="text-[11px] text-rose-700 pl-6">
                            {resignUnderOneYear === true && (
                              <>
                                <b>근속 1년 미만</b>(입사일 ~ 퇴사일자 다음 날)이라 퇴직금 정산 신청서는 {forceSeverance ? "넣습니다(직접 포함)" : <>자동으로 뺍니다</>}.
                                <label className="ml-2 inline-flex items-center gap-1 cursor-pointer">
                                  <input type="checkbox" checked={forceSeverance} onChange={e => setForceSeverance(e.target.checked)} />
                                  그래도 퇴직금 정산 신청서 포함
                                </label>
                              </>
                            )}
                            {resignUnderOneYear === null && <>퇴사일자를 넣으면 근속 1년 미만 여부를 판정해 퇴직금 정산 신청서를 자동으로 뺍니다.</>}
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
                    <SelectTrigger><SelectValue>{typeLabel[createForm.type] ?? createForm.type}</SelectValue></SelectTrigger>
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
                            // 종료일 자동 채움 — 직영 연봉 주기에 맞춘다
                            // 규칙(2026-10-08 본부 박정인 #212·#201): 연봉 갱신 3·6·9·12월, 연봉 종료 2·5·8·11월 말.
                            // 종료일 = 다음 해 + (시작일 뒤 첫 갱신월 1일 − 1일). 예) 26-09-10 → 27-11-30, 26-07-01 → 27-08-31, 26-09-01 → 27-08-31
                            // (종전 「다음 해 분기 말일」 규칙은 폐기)
                            // Date 객체를 쓰지 않고 문자열 계산 — 시간대에 따른 하루 밀림 방지
                            // 종료일이 비었거나 "직전 자동값 그대로"면 재계산해 덮는다 —
                            // 시작일을 정정했는데 낡은 자동 종료일이 남는 사고 방지(검증관 지적).
                            // 사용자가 직접 고친 종료일은 건드리지 않는다.
                            let end = f.endDate;
                            if (v && (!f.endDate || f.endDate === lastAutoEnd.current)) {
                              const [y, m] = v.split("-").map(Number);
                              // date input 타이핑 중 "0002-.." 같은 중간값이 오면 자동 채움 보류
                              const d = Number(v.split("-")[2]);
                              if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1) {
                                // 시작일 뒤의 첫 갱신월(3·6·9·12). 갱신월 1일에 시작하면 그 달이 곧 주기 시작이라 다음 갱신월로
                                const RENEW = [3, 6, 9, 12];
                                const nextQ = RENEW.find((q) => q > m || (q === m && d === 1));
                                const endY = nextQ ? y + 1 : y + 2;                 // 12월 2일 이후 시작이면 다음 갱신월은 이듬해 3월
                                const endM = (nextQ ?? 3) - 1;                       // 종료월 = 갱신월 − 1
                                const lastDay = new Date(Date.UTC(endY, endM, 0)).getUTCDate();   // 그 달 말일
                                end = `${endY}-${String(endM).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
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
                      <label className="text-xs text-gray-600">종료일 <span className="text-gray-400">(자동: 다음 해의 연봉 종료월 말일 — 2·5·8·11월)</span></label>
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
                    type="text"
                    inputMode="numeric"
                    placeholder={salaryDefaultOn ? "34,000,000 (기본값 — 비워 두면 이 값)" : "예: 34,000,000"}
                    value={wonView(salaryFocus ? createForm.salary : effSalary, salaryFocus)}
                    onFocus={() => setSalaryFocus(true)}
                    onBlur={() => setSalaryFocus(false)}
                    onChange={e => setCreateForm(f => ({ ...f, salary: e.target.value.replace(/[^0-9]/g, "") }))}
                  />
                  {effSalary && (
                    <p className="text-xs text-gray-500">{Number(effSalary).toLocaleString()}원 · 문서 표기: <b>金 {koreanMoney(Number(effSalary))}</b></p>
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
                    <p className="text-[11px] text-gray-400">재계약을 선택하면 수습기간 조항이 &quot;해당없음&quot;으로 처리되고 관련 입력란이 숨겨집니다.{templates.find(x => x.id === selectedTemplate)?.approvalStepsRenewal ? " 이 양식은 재계약이면 결재 순서도 양식의 「재계약 순서」로 발송됩니다." : ""}</p>
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
                      <p className="text-xs font-semibold text-gray-600">자동 채움 <span className="font-normal text-gray-400">(직원 정보 · 수정 불가{portalFill?.userId === emp.id && portalFill.fields.includes("주소") ? " · 주소는 포털 인사카드에서 자동" : ""})</span></p>
                      <div className="grid grid-cols-2 gap-2">
                        {autoRows.map(r => (
                          <div key={r.field} className="text-sm">
                            <span className="text-gray-500 text-xs">{r.label}</span>
                            <p className={r.val ? "font-medium" : (portalFill?.userId === emp.id && portalFill.fields.includes(r.field) ? "text-emerald-700 text-xs" : "text-amber-600 text-xs")}>
                              {r.val || (portalFill?.userId === emp.id && portalFill.fields.includes(r.field)
                                ? "포털 인사카드에서 자동으로 채워집니다"
                                : (r as { profileFallback?: boolean }).profileFallback ? "정보 없음 → 직원이 서명 시 입력" : "직원 정보에 없음")}
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
                    f.startsWith("동의_") ? (
                      // 동의 선택 칸(추가 템플릿 8종) — 보통은 서명 때 직원이 고르지만 외부 계약·본부 입력으로 정한 칸은 여기서
                      <div key={f} className="space-y-1">
                        <Label className="text-sm flex-wrap gap-x-1.5 gap-y-0.5 leading-tight">{f.slice(3)}{required && " *"}{docHint(f)}</Label>
                        <div className="flex gap-3 text-sm">
                          {[["동의", "동의함"], ["미동의", "동의하지 않음"]].map(([v, l]) => (
                            <label key={v} className="flex items-center gap-1 cursor-pointer">
                              <input type="radio" checked={extraFields[f] === v} onChange={() => setExtraFields(prev => ({ ...prev, [f]: v }))} />{l}
                            </label>
                          ))}
                        </div>
                      </div>
                    ) :
                    f === "발령지점" ? (
                      // 인사발령통지서 — 지점을 고르면 발령 근무지 주소가 지점 표에서 채워진다(직접 입력도 가능)
                      <div key={f} className="space-y-1">
                        <Label className="text-sm flex-wrap gap-x-1.5 gap-y-0.5 leading-tight">{f}{required && " *"}{docHint(f)}</Label>
                        <select className="w-full h-9 rounded-md border px-2 text-sm bg-white" value={transferCustom ? "__custom" : branchAddresses[extraFields[f] || ""] ? extraFields[f] : (extraFields[f] ? "__custom" : "")}
                          onChange={e => {
                            const v = e.target.value;
                            // 「목록에 없음」: 자리표시 글자를 넣지 않는다(문서에 「(직접 입력)」이 찍히던 것, 10/13 검증 3). 비어 있으면 필수 검사가 막는다
                            if (v === "__custom") { setTransferCustom(true); setExtraFields(prev => ({ ...prev, [f]: branchAddresses[prev[f] || ""] ? "" : prev[f], 발령근무지주소: branchAddresses[prev[f] || ""] ? "" : prev["발령근무지주소"] })); return; }   // 지점에서 직접 입력으로 바꾸면 그 지점 주소도 비운다
                            setTransferCustom(false);
                            setExtraFields(prev => ({ ...prev, [f]: v, ...(v && branchAddresses[v] ? { 발령근무지주소: branchAddresses[v] } : {}) }));
                          }}>
                          <option value="">지점 선택</option>
                          {Object.keys(branchAddresses).sort().map(b => <option key={b} value={b}>{b}</option>)}
                          <option value="__custom">(목록에 없음 — 아래 주소를 직접 입력)</option>
                        </select>
                        {(transferCustom || (extraFields[f] && !branchAddresses[extraFields[f]])) && (
                          <Input value={extraFields[f] || ""} placeholder="발령 지점·장소 이름" onChange={e => setExtraFields(prev => ({ ...prev, [f]: e.target.value }))} />
                        )}
                      </div>
                    ) :
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
                      {fieldTypes[f]?.type === "checkbox" ? (   // PDF 칸 배치 체크박스(#22 2단계) — 체크하면 문서에 ✓
                        <label className="flex items-center gap-2 h-9 text-sm cursor-pointer">
                          <input type="checkbox" checked={extraFields[f] === "☑"} onChange={e => setExtraFields(prev => ({ ...prev, [f]: e.target.checked ? "☑" : "" }))} />해당
                        </label>
                      ) : fieldTypes[f]?.type === "select" ? (   // PDF 칸 배치 드롭다운
                        <select className="w-full h-9 rounded-md border px-2 text-sm bg-white" value={extraFields[f] || ""} onChange={e => setExtraFields(prev => ({ ...prev, [f]: e.target.value }))}>
                          <option value="">선택</option>
                          {(fieldTypes[f]?.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                      <Input
                        type={isTimeField(f) ? "time" : fieldTypes[f]?.type === "date" || isDateField(f) ? "date" : "text"}
                        value={extraFields[f] || ""}
                        onChange={e => setExtraFields(prev => ({ ...prev, [f]: e.target.value }))}
                      />
                      )}
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
                            {mainFields.map(f => renderDynField(f, !!fieldSettings[f]?.required))}
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

                {/* 여러 명 작성 — 개인별 값 표(#19 #34) */}
                {bulkMode && !externalMode && useTemplate && selectedTemplate && bulkUserIds.length > 0 && (
                  <BulkValuesTable
                    userIds={bulkUserIds}
                    employees={employees}
                    columns={bulkColumns(templateFields, templateFields.some((f) => ["연봉", "연봉한글", "연봉총액", "월급여합계", "기본급", "연봉숫자"].includes(f))).filter((c) => !fieldConditions[c] || fieldConditions[c] === contractKind)}
                    values={bulkValues}
                    onChange={setBulkValues}
                    common={{ ...extraFields, 연봉: effSalary, 계약시작일: createForm.startDate, 계약종료일: createForm.endDate }}
                    rowCommon={bulkRowCommon}
                  />
                )}
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
                            resignBundleMode && resignTemplates.every(Boolean) ? resignTemplates.filter((_, i) => resignIncluded[i]).map(t => t!.id)
                            : bundleMode && privacyTemplate ? [selectedTemplate, privacyTemplate.id]
                            : (extBundleMode || codiBundleMode) && ndaTemplate && privacyTemplate ? [selectedTemplate, ndaTemplate.id, privacyTemplate.id]
                            : [selectedTemplate];
                          const res = await fetch("/api/contracts/preview", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              items: pkgIds.map(tid => ({ templateId: tid })),
                              userId: externalMode ? undefined : (createForm.userId || bulkUserIds[0]),
                              externalName: externalMode ? externalForm.name.trim() : undefined,
                              externalPhone: externalMode ? externalForm.phone.trim() : undefined,
                              title: createForm.title, startDate: createForm.startDate, endDate: createForm.endDate,
                              salary: effSalary, extraFields: allExtra,
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
                  {/* 나에게 테스트 발송(#67) — 단건 작성에서만. 패키지·여러 명·외부 계약은 실제 발송 흐름이 달라 제외 */}
                  {role === "ADMIN" && !bulkMode && !externalMode && !bundleMode && !resignBundleMode && !codiBundleMode && !extBundleMode && (
                    <Button type="button" variant="outline" className="gap-1 text-amber-700 border-amber-300 hover:bg-amber-50" disabled={uploading || testSending}
                      title="실제로 보내기 전에 나에게 먼저 보내 서명자 화면·알림·완료본을 확인합니다. 직원 선택은 쓰지 않고, 다른 사람에게는 알림이 가지 않습니다."
                      onClick={handleTestSend}>
                      {testSending ? "보내는 중..." : "나에게 테스트 발송"}
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
                                setSalaryFocus(false); setCreateOpen(true);
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
                        setSalaryFocus(false); setCreateOpen(true);
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
            setEditForm({ title: "", type: "", startDate: "", endDate: "", salary: "" }); setEditExtraFields({}); setEditSalaryFocus(false);
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
                  <SelectTrigger><SelectValue>{typeLabel[editForm.type] ?? editForm.type}</SelectValue></SelectTrigger>
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
                  type="text"
                  inputMode="numeric"
                  placeholder="예: 36,000,000"
                  value={wonView(editForm.salary, editSalaryFocus)}
                  onFocus={() => setEditSalaryFocus(true)}
                  onBlur={() => setEditSalaryFocus(false)}
                  onChange={e => setEditForm(f => ({ ...f, salary: e.target.value.replace(/[^0-9]/g, "") }))}
                />
                {editForm.salary && (
                  <p className="text-xs text-gray-500">{Number(editForm.salary).toLocaleString()}원</p>
                )}
              </div>

              {/* 작성 시 입력한 템플릿 동적 필드 — 수정하면 계약서 문서도 새 값으로 다시 생성됨 */}
              {Object.keys(editExtraFields).length > 0 && (
                <div className="space-y-3 border rounded-lg p-3 bg-indigo-50/40">
                  <p className="text-xs font-semibold text-indigo-700">이 템플릿의 추가 입력 필드</p>
                  {Object.entries(editExtraFields)
                    // 재계약이면 평가 기간 칸은 문서에서 빠지므로 빈 칸은 숨긴다(10/16)
                    .filter(([k, v]) => !(editExtraFields["계약구분"] === "재계약" && (EVAL_COLS as readonly string[]).includes(k) && !v))
                    .map(([k, v]) => (
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
                          // 날짜 칸은 값이 비었거나 날짜 하나일 때만 — "2026-09-02 ~ 12-31" 같은 문장은 날짜 칸이 담지 못해 비어 보인다(#206 검증 F4)
                          // 칸 종류는 수정 창을 열 때의 값으로 한 번만 정한다 — 입력 도중 날짜↔글자로 바뀌지 않게(c911ba0 검증 F3)
                          type={(() => {
                            const opened = koreanToIso(String((editingContract?.extraFields as Record<string, unknown> | null | undefined)?.[k] ?? ""));
                            return isDateField(k) && (!opened || /^\d{4}-\d{2}-\d{2}$/.test(opened)) ? "date" : "text";
                          })()}
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
                  <SelectValue>{filterYear ? `${filterYear}년` : "연도"}</SelectValue>
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
                  <SelectItem value="REJECTED">반려</SelectItem>
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
            {/* 오래된 대기(#79) */}
            <label className="ml-4 flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={filterStale} onChange={e => setFilterStale(e.target.checked)} />
              오래된 대기만(7일 넘게 움직임 없음)
            </label>
            {/* 내 테스트 문서만(#67) — 나에게 테스트 발송한 시험 문서(7일 뒤 자동 삭제). 기본 목록에는 나오지 않는다 */}
            {role === "ADMIN" && (
              <label className="ml-4 flex items-center gap-1.5 text-xs cursor-pointer text-amber-700" title="나에게 테스트 발송한 시험 문서만 — 7일 뒤 자동 삭제">
                <input type="checkbox" checked={showTest} onChange={e => setShowTest(e.target.checked)} />
                내 테스트 문서만
              </label>
            )}
            {/* 기간 기준(#79) — 날짜를 넣으면 위 연·월 대신 이 기간으로 거른다 */}
            <div className="ml-4 flex items-center gap-1 text-xs">
              <select value={filterDateField} onChange={e => setFilterDateField(e.target.value)} className="h-7 rounded border px-1">
                <option value="created">작성일</option>
                <option value="signed">완료일(체결)</option>
                <option value="activity">마지막 활동일</option>
              </select>
              <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-7 rounded border px-1" />
              <span>~</span>
              <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-7 rounded border px-1" />
            </div>
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
                setFilterDateField("created"); setFilterFrom(""); setFilterTo(""); setFilterStale(false);
                fetchContracts({ year: new Date().getFullYear().toString(), month: "", status: "", userId: "", branch: "", searchText: "", showHiddenRevoked: false });
              }}
            >
              초기화
            </Button>
          </div>

          {/* 고른 계약(#34 #46) — 초안은 한꺼번에 발송, 고른 것 전부는 완료본 ZIP·입력값 엑셀 */}
          {pickedAll.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm">
              <span className="text-indigo-800">{pickedAll.length}건 선택{pickedDrafts.length ? ` (초안 ${pickedDrafts.length})` : ""}</span>
              {pickedDrafts.length > 0 && (
                <Button size="sm" className="h-7 gap-1" onClick={() => { setBulkSendKey(k => k + 1); setBulkSendOpen(true); }}><Send size={12} />초안 {pickedDrafts.length}건 한꺼번에 발송</Button>
              )}
              <Button size="sm" variant="outline" className="h-7 gap-1" disabled={exporting} onClick={() => exportPicked("zip")}><Download size={12} />완료본 ZIP</Button>
              <Button size="sm" variant="outline" className="h-7 gap-1" disabled={exporting} onClick={() => exportPicked("xlsx")}><Download size={12} />입력값 엑셀</Button>
              <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => setPickedIds(new Set())}>선택 해제</button>
            </div>
          )}
          <BulkSendDialog key={bulkSendKey} open={bulkSendOpen} onClose={() => setBulkSendOpen(false)}
            contracts={pickedDrafts} employees={employees}
            onDone={(keep) => { setPickedIds(new Set(keep)); fetchContracts(); }} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  {role === "ADMIN" && (
                    <th className="pb-3 w-8">
                      <input type="checkbox" title="목록 모두 선택"
                        checked={contracts.length > 0 && contracts.every(x => pickedIds.has(x.id))}
                        onChange={e => setPickedIds(e.target.checked ? new Set(contracts.map(x => x.id)) : new Set())} />
                    </th>
                  )}
                  {role !== "EMPLOYEE" && <th className="pb-3">직원</th>}
                  <th className="pb-3">제목</th>
                  <th className="pb-3">상태</th>
                  <th className="pb-3">결재 진행</th>
                  <th className="pb-3">처리</th>
                </tr>
              </thead>
              <tbody>
                {listLoading ? (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-400"><span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />목록을 불러오는 중…</span></td></tr>
                ) : contracts.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-400">없음</td></tr>
                ) : contracts.map(c => {
                  const s = statusConfig[c.status] || { label: "미정", variant: "default" };
                  return (
                    <tr key={c.id} className="border-b hover:bg-gray-50">
                      {role === "ADMIN" && (
                        <td className="py-3">
                          <input type="checkbox" checked={pickedIds.has(c.id)}
                            onChange={e => setPickedIds(prev => { const n = new Set(prev); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
                        </td>
                      )}
                      {role !== "EMPLOYEE" && <td className="py-3"><p className="font-medium">{c.externalName ? `[외부] ${c.externalName}` : `${c.user.branch ? `[${c.user.branch}] ` : ""}${c.user.name}`}</p></td>}
                      <td className="py-3 font-medium">
                        {c.title}
                        {/* 배지 앞 띄어쓰기 — 화면 글자를 그대로 읽으면 「근로계약서패키지」처럼 제목에 붙어 보였다(10/16 A3, 제목 자체는 정상) */}
                        {c.bundleId && <>{" "}<span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 align-middle">패키지</span></>}
                        {c.employeeOnly && <>{" "}<span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 align-middle">직원전용</span></>}
                        {c.isTest && <>{" "}<span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 align-middle" title="나에게 테스트 발송한 시험 문서 — 7일 뒤 자동 삭제">테스트</span></>}
                        {c.importBatch && <>{" "}<span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 align-middle" title={`모두싸인 이관본 (${c.importBatch})`}>이관</span></>}
                        {c.certificateUrl && <a href={c.certificateUrl} target="_blank" rel="noreferrer" className="ml-1 text-[10px] text-sky-700 underline align-middle" title="모두싸인 감사추적 인증서">인증서</a>}
                      </td>
                      <td className="py-3">
                        <Badge variant={s.variant}>{s.label}</Badge>
                        {/* 서명 기한(#45) — 진행 중이면 표시·변경 */}
                        {c.signDeadline && (c.status === "SENT" || c.status === "APPROVED") && (
                          <button type="button" className="block mt-0.5 text-[11px] text-gray-400 hover:text-indigo-600 hover:underline" title="기한 바꾸기"
                            onClick={async () => {
                              const cur = new Date(new Date(c.signDeadline!).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
                              const v = window.prompt("새 서명 기한(YYYY-MM-DD)", cur);
                              if (!v || v === cur) return;
                              const res = await fetch(`/api/contracts/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signDeadline: v.trim() }) });
                              const d = await res.json().catch(() => ({}));
                              if (!res.ok) { toast.error(d.error || "기한을 바꾸지 못했습니다."); return; }
                              toast.success(`기한을 ${v.trim()} 로 바꿨습니다.`);
                              fetchContracts();
                            }}>
                            기한 {new Date(new Date(c.signDeadline).getTime() + 9 * 3600 * 1000).toISOString().slice(5, 10).replace("-", "/")}
                          </button>
                        )}
                      </td>
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
                        <a href={c.status === "SIGNED" ? `/api/contracts/${c.id}/signed-document?pdf=1` : `/api/contracts/${c.id}/original-document`} target="_blank" rel="noreferrer" onClick={() => { if (c.status === "SIGNED") fetch(`/api/contracts/${c.id}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "DOWNLOADED" }) }).catch(() => {}); }} title={c.status === "SIGNED" ? "서명 완료본 다운로드 (PDF)" : "원본 다운로드 (PDF)"}><Button size="sm" variant="ghost" className="h-7"><Download size={12} /></Button></a>
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
                        {/* 초안 + 진행 중(회수 후 포함) + 반려(9/11 — 고쳐서 다시 보낼 수 있다, #206-4) 계약: 수정·재발송 가능,
                            삭제는 초안만 (직원전용 패키지 문서 제외) */}
                        {/* 패키지 직원전용 문서도 **반려**되면 [수정]·[다시 보내기] — 종전엔 버튼이 없어 패키지를 새로 만들어야 했다
                            (#206 검증 F5, 9/12 디렉터). 외부 계약자는 게스트 화면에 반려가 없어 해당 없음 */}
                        {/* 시험 문서(#67)는 지우는 것만 — 재발송·수정은 서버도 막는다(남에게 알림이 가고 접두어를 지울 수 있어서) */}
                        {c.isTest && role === "ADMIN" && (
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => { setDeleteTarget({ id: c.id, title: c.title, bundleId: c.bundleId }); setDeleteConfirmOpen(true); }}>
                            <Trash2 size={12} />삭제
                          </Button>
                        )}
                        {!c.isTest && role !== "EMPLOYEE" && (!(c.employeeOnly && c.bundleId) || ((c.status === "REJECTED" || c.status === "EXPIRED") && !c.externalName)) && (c.status === "DRAFT" || c.status === "SENT" || c.status === "APPROVED" || c.status === "REJECTED" || c.status === "EXPIRED") && (
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
                                  // 값이 비어 있는(null) 옛 데이터는 빈칸으로 — 글자 "null" 이 칸에 보이지 않게(칸 종류 판정과도 맞춤)
                                  if (k !== "연봉") extras[k] = koreanToIso(v == null ? "" : String(v));
                                });
                                if ("계약구분" in extras) for (const k of EVAL_COLS) if (!(k in extras)) extras[k] = "";
                                setEditExtraFields(extras);
                                setEditSalaryFocus(false); setEditOpen(true);
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
                            {c.employeeOnly && c.bundleId ? (
                              // 직원전용 문서는 서명자가 직원 본인으로 정해져 있다 — 결재선 고르는 창 없이 한 번에(F5)
                              <Button size="sm" variant="outline" className="h-7 gap-1" disabled={sending} onClick={() => resendEmployeeOnly(c)}>
                                <Send size={12} />다시 보내기
                              </Button>
                            ) : (
                            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => openSendDialog(c)}>
                              <Send size={12} />{c.status === "DRAFT" ? "발송" : "재발송"}
                            </Button>
                            )}
                            <Dialog open={sendOpen && sendTarget?.id === c.id} onOpenChange={setSendOpen}>
                              {/* 폭 — 안내 문구가 박스 밖으로 삐져나오던 것 (#178, 2026-08-31 이예지대리) */}
                              <DialogContent className="max-w-lg sm:max-w-lg">
                                <DialogHeader><DialogTitle>발송 전 승인자 설정</DialogTitle></DialogHeader>
                                {sendTarget && (
                                  <div className="space-y-3">
                                    <p className="text-sm text-gray-600">「{sendTarget.title}」의 결재자를 단계별로 지정하세요.</p>
                                    <p className="text-xs text-gray-500">
                                      결재 순서: <b>{stepsLabel(slotSpecs, !!sendTarget.externalName)}</b>
                                      {sendTarget.approvalSteps ? (slotLocked ? (sendTarget.approvalRenewal ? " · 양식에서 정한 재계약 순서(고정)" : " · 양식에서 정한 순서(고정)") : " · 이 양식은 발송 때 순서를 바꿀 수 있습니다") : " · 양식에 순서가 없어 기본값(템플릿 수정에서 지정할 수 있습니다)"}
                                    </p>
                                    {/* 발송 문서 실물 확인 (#100) + 원장·근로자 자동 채움 (#99·#159) */}
                                    {/* min-w-0 이 없으면 flex 항목이 글자 최소폭 밑으로 줄지 않아 모달 밖으로 밀려난다 (#178) */}
                                    <div className="flex gap-2">
                                      {/* 패키지면 포함 문서 전체를 한 PDF 로 (#124) */}
                                      <Button type="button" variant="outline" size="sm" className="flex-1 basis-0 min-w-0 w-full gap-1 h-8 whitespace-normal leading-tight"
                                        onClick={() => openBigDoc(`/api/contracts/${sendTarget.id}/bundle-preview?hl=1&as=send`, "발송 문서 미리보기")}>
                                        <Eye size={13} />발송 문서 미리보기{sendTarget.bundleId ? " (패키지 전체)" : ""}
                                      </Button>
                                      {!sendTarget.externalName && (
                                        <Button type="button" variant="outline" size="sm" className="flex-1 basis-0 min-w-0 gap-1 h-8 whitespace-normal leading-tight"
                                          onClick={() => {
                                            // 양식 순서대로 원장(메인 원장)·근로자(당사자)를 다시 채운다 — 본부 칸은 직접 고른 값 유지(#159·#213-2)
                                            const mgrId = partyBranchManagerId(sendTarget);
                                            setApproverSlots(prev => {
                                              const next = prefillSlots(sendTarget, slotSpecs, prev);
                                              // 본부 칸에 원장·당사자와 같은 사람이 들어가 있으면 비운다
                                              for (let i = 0; i < next.length; i++) if (slotKind(i) === "HQ" && next[i] && next.some((x, j) => j !== i && x === next[i])) next[i] = null;
                                              return next;
                                            });
                                            setActiveSlot(null);
                                            const hasMgrStep = slotSpecs.some(s => s.kind === "MANAGER");
                                            if (hasMgrStep && !mgrId) {
                                              const emp = employees.find(e => e.id === sendTarget.userId);
                                              const isMgr = emp?.role === "MANAGER";
                                              toast.error(isMgr ? "당사자가 원장이라 원장 단계를 비웠습니다(그대로 보내면 원장 단계 없이 진행)." : "담당 원장을 찾지 못했습니다 — 원장 칸은 직접 선택해주세요.");
                                            }
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
                                                {i + 1}단계 · {slotLabel(i)}
                                              </button>
                                              <span className="truncate">{approverLabel(id)}</span>
                                              <button type="button" onClick={() => clearApproverSlot(i)} className="text-gray-400 hover:text-red-500 shrink-0" title="비우기"><X size={14} /></button>
                                              {slotEditable && <SlotOrderButtons i={i} n={slotSpecs.length} onMove={moveSlot} onRemove={removeSlot} />}
                                            </span>
                                          ) : (
                                            <button type="button" onClick={() => setActiveSlot(activeSlot === i ? null : i)}
                                              className={`flex w-full items-center justify-between rounded-md border border-dashed px-2 py-1.5 text-xs ${activeSlot === i ? "border-indigo-400 bg-indigo-50 text-indigo-600" : "border-gray-300 text-gray-400 hover:border-gray-400"}`}>
                                              <span>{i + 1}단계 · {slotLabel(i)} — {slotKind(i) === "MANAGER" && partyIsManager ? "당사자가 원장이라 이 단계는 생략됩니다(비워 두세요)" : "선택 필요"}</span>
                                              <span className="flex items-center gap-1">
                                                {activeSlot === i && <span className="font-semibold">아래에서 고르세요</span>}
                                                {slotEditable && <SlotOrderButtons i={i} n={slotSpecs.length} onMove={moveSlot} onRemove={removeSlot} />}
                                              </span>
                                            </button>
                                          )}
                                        </div>
                                      ))}
                                      {slotEditable && slotSpecs.length < 6 && (
                                        <div className="flex items-center gap-1 text-[11px] text-gray-500">
                                          단계 추가:
                                          {STEP_KINDS.filter(k => k !== "EXTERNAL" || !!sendTarget.externalName).map(k => (
                                            <button key={k} type="button" onClick={() => addSlot(k)} className="rounded border px-1.5 py-0.5 hover:bg-gray-50">+ {KIND_LABEL[k]}</button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    {/* 받는 사람 확인(#26) — 순서·이름·지점·이메일·휴대폰 일부, 다른 지점 원장·퇴사 예정 경고 */}
                                    {approverSlots.some(Boolean) && (
                                      <div className="rounded-md border bg-gray-50 p-2 space-y-1">
                                        <p className="text-[11px] font-semibold text-gray-500">받는 사람 확인 (이 순서로 알림이 갑니다)</p>
                                        {approverSlots.map((sid, i) => {
                                          if (!sid) return null;
                                          if (sid === "EXTERNAL") return (
                                            <p key={i} className="text-xs text-gray-700">{i + 1}. {sendTarget.externalName || "외부 서명자"} · 외부{maskPhone(sendTarget.externalPhone) && ` · ${maskPhone(sendTarget.externalPhone)}`}</p>
                                          );
                                          const party = sid === sendTarget.userId && !sendTarget.externalName;
                                          const e = employees.find(x => x.id === sid);
                                          const partyEmp = employees.find(x => x.id === sendTarget.userId);
                                          const warns: string[] = [];
                                          if (e?.role === "MANAGER" && !party && partyEmp?.branch && !sendTarget.externalName
                                            && e.branch !== partyEmp.branch && !(e.managerBranches || []).includes(partyEmp.branch)) warns.push(`다른 지점 원장(${e.branch ?? "지점 없음"})`);
                                          if (e?.resignDate) warns.push(`퇴사 예정 ${e.resignDate.slice(0, 10)}`);
                                          return (
                                            <div key={i} className="text-xs text-gray-700">
                                              {i + 1}. {party ? `${sendTarget.user?.name || e?.name || "직원"} (당사자)` : e?.name || "?"}
                                              {e?.branch && ` · ${e.branch}`}{e?.email && ` · ${e.email}`}{maskPhone(e?.phone) && ` · ${maskPhone(e?.phone)}`}
                                              {warns.map(w => <span key={w} className="ml-1.5 rounded bg-amber-100 px-1 text-amber-700">⚠ {w}</span>)}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                    {/* 서류별 결재 순서(10/16 이예지 QA 5) — 퇴사 패키지처럼 서류마다 서명하는 사람이 다를 때. 고른 결재자 안에서 순서 바꾸기·빼기, 이 발송에만 */}
                                    {(() => {
                                      if (!sendTarget.bundleId || sendTarget.externalName || approverIds.length < 2) return null;
                                      const docs = contracts.filter(x => x.bundleId === sendTarget.bundleId && !x.employeeOnly && x.status !== "SIGNED" && x.status !== "REJECTED");
                                      if (docs.length < 2) return null;
                                      const orderOf = (cid: string) => (docOrders[cid] ?? approverIds).filter(x => approverIds.includes(x));
                                      const setOrder = (cid: string, next: string[]) => { setDocOrdersKey(approverIds.join(",")); setDocOrders(() => ({ ...docOrders, [cid]: next })); };
                                      return (
                                        <div className="rounded-md border p-2 space-y-2">
                                          <p className="text-[11px] font-semibold text-gray-500">서류별 결재 순서 <span className="font-normal text-gray-400">(◀▶로 옮기기·✕로 빼기 — 이 발송에만 적용, 바꾸면 변경 로그에 남음)</span></p>
                                          {docs.map(d => {
                                            const ord = orderOf(d.id);
                                            const removed = approverIds.filter(x => !ord.includes(x));
                                            const custom = ord.join(",") !== approverIds.join(",");
                                            return (
                                              <div key={d.id} className="text-xs">
                                                <div className="flex items-center justify-between gap-2">
                                                  <span className={`truncate ${custom ? "font-semibold text-indigo-700" : "text-gray-700"}`}>{d.title.replace(/^\d{4}\s+/, "")}</span>
                                                  {custom && (
                                                    <button type="button" className="shrink-0 text-[11px] text-indigo-600 hover:underline"
                                                      onClick={() => setDocOrders(() => { const n = { ...docOrders }; delete n[d.id]; return n; })}>기본 순서로</button>
                                                  )}
                                                </div>
                                                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                                  {ord.map((sid, i) => (
                                                    <span key={sid} className="inline-flex items-center gap-0.5 rounded border bg-white px-1 py-0.5">
                                                      <button type="button" aria-label="앞으로" disabled={i === 0} className="px-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                                                        onClick={() => { const n = [...ord]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setOrder(d.id, n); }}>◀</button>
                                                      <span>{i + 1}. {approverName(sid)}</span>
                                                      <button type="button" aria-label="뒤로" disabled={i === ord.length - 1} className="px-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                                                        onClick={() => { const n = [...ord]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setOrder(d.id, n); }}>▶</button>
                                                      <button type="button" aria-label="이 서류에서 빼기" disabled={ord.length <= 1 || sid === sendTarget.userId} title={sid === sendTarget.userId ? "근로자(계약 당사자) 서명은 뺄 수 없습니다" : undefined} className="px-0.5 text-red-400 hover:text-red-600 disabled:opacity-30"
                                                        onClick={() => setOrder(d.id, ord.filter(x => x !== sid))}>✕</button>
                                                    </span>
                                                  ))}
                                                  {removed.map(sid => (
                                                    <button key={sid} type="button" className="rounded border border-dashed px-1 py-0.5 text-gray-500 hover:bg-gray-50"
                                                      onClick={() => setOrder(d.id, [...ord, sid])}>+ {approverName(sid)}</button>
                                                  ))}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      );
                                    })()}
                                    {/* 외부 계약 받을 이메일(10/16 이예지 QA 7) — 필수. 링크를 열 때 이 이메일과 휴대폰 뒷자리를 함께 확인하고, 완료본 PDF 를 이 주소로 보낸다 */}
                                    {sendTarget.externalName && (
                                      <div className="space-y-1">
                                        <span className="text-xs font-medium text-gray-600">계약서 받을 이메일 <span className="text-red-500">*</span> <span className="font-normal text-gray-400">(링크 본인 확인·완료본 PDF 전달)</span></span>
                                        <input type="email" value={sendExtEmail} onChange={e => setSendExtEmail(e.target.value)}
                                          placeholder="예) hong@example.com"
                                          className={`w-full rounded-md border px-2 py-1.5 text-sm ${sendExtEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(sendExtEmail.trim()) ? "border-red-400" : ""}`} />
                                      </div>
                                    )}
                                    {/* 서명 기한(#45) — 기본 14일, 지나면 자동 만료·본부 알림. 미서명 알림은 3일마다 */}
                                    <div className="flex items-center gap-2 text-xs text-gray-600">
                                      <span className="font-medium">서명 기한</span>
                                      <input type="number" min={1} max={90} value={deadlineDays} onChange={e => setDeadlineDays(e.target.value)}
                                        className="w-16 rounded-md border px-2 py-1 text-sm" />일
                                      <span className="text-gray-400">· 지나면 자동 만료, 미서명 알림 3일마다</span>
                                    </div>
                                    {/* 발송 메시지(#65) — 알림·메일·서명 화면에 함께 보인다 */}
                                    <div className="space-y-1">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-gray-600">발송 메시지 <span className="font-normal text-gray-400">(선택 · 알림·메일·서명 화면에 표시)</span></span>
                                        <button type="button" className="text-[11px] text-indigo-600 hover:underline disabled:text-gray-300" disabled={savingMsg} onClick={saveDefaultMsg}>기본 메시지로 저장</button>
                                      </div>
                                      <textarea value={sendMsg} onChange={e => setSendMsg(e.target.value)} maxLength={500} rows={2}
                                        placeholder="예) 계약 내용을 확인하신 뒤 이번 주 안에 서명 부탁드립니다."
                                        className="w-full rounded-md border px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200" />
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
                                            !approverIds.includes("EXTERNAL") && (!slotLocked || activeSlot === null || slotKind(activeSlot) === "EXTERNAL") && (
                                              <button type="button" onClick={() => assignApprover("EXTERNAL")}
                                                className="w-full text-left px-2.5 py-1.5 text-sm text-emerald-700 font-semibold hover:bg-emerald-50">
                                                🔗 {sendTarget.externalName} (외부 · 링크로 서명)
                                              </button>
                                            )
                                          ) : (
                                          !approverIds.includes(sendTarget.userId) && (!slotLocked || activeSlot === null || slotKind(activeSlot) === "EMPLOYEE") && (
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
                                            // 고정 양식: 고른 칸이 본부면 관리자만, 원장이면 원장만(#213-2). 칸을 안 골랐으면 전부 보이되 맞는 칸에 들어간다
                                            .filter(e => !slotLocked || activeSlot === null || (slotKind(activeSlot) === "HQ" ? e.role === "ADMIN" : slotKind(activeSlot) === "MANAGER" ? e.role === "MANAGER" : false))
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
                                      <Button disabled={approverIds.length === 0 || sending} onClick={() => {
                                        // 어느 단계에 누가 들어갔는지 그대로 보여준다 (#158)
                                        const names = approverSlots
                                          .map((id, i) => (id ? `${i + 1}단계 ${slotLabel(i)} ${approverName(id)}` : null))
                                          .filter(Boolean)
                                          .join(" → ");
                                        const changedDocs = sendTarget.bundleId ? contracts.filter(x => x.bundleId === sendTarget.bundleId && docOrders[x.id]
                                          && docOrders[x.id].filter(i => approverIds.includes(i)).join(",") !== approverIds.join(","))
                                          .map(x => `· ${x.title.replace(/^\d{4}\s+/, "")}: ${docOrders[x.id].filter(i => approverIds.includes(i)).map(approverName).join(" → ")}`) : [];
                                        if (!confirm(`${names}${changedDocs.length ? `\n\n서류별로 바꾼 순서(이 발송에만):\n${changedDocs.join("\n")}` : ""}\n\n발송 후에는 문서를 수정할 수 없습니다. 발송할까요?`)) return;
                                        handleSend(sendTarget.id);
                                      }}>{sending ? "발송 중…" : "발송"}</Button>
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
        <DialogContent className="max-w-md max-h-[92vh] flex flex-col overflow-hidden">
          {/* 화면이 낮으면 모달 아래쪽이 잘려 **승인 버튼이 보이지도, 눌리지도 않았다**
              (2026-09-08 디렉터 보고). 높이를 화면에 맞추고 안쪽만 스크롤시키되,
              버튼 줄은 아래에 고정해 어떤 화면 크기에서도 항상 손이 닿게 한다. */}
          <DialogHeader className="shrink-0"><DialogTitle>서명</DialogTitle></DialogHeader>
          {signTarget && (
            <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1">
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <p className="text-sm font-medium">{signTarget.title}</p>
                <p className="text-xs text-gray-500">{signTarget.externalName ? `[외부] ${signTarget.externalName}` : `${signTarget.user.branch ? `[${signTarget.user.branch}] ` : ''}${signTarget.user.name}`}</p>
                {signTarget.sendMessage && (
                  <p className="text-xs text-indigo-800 bg-indigo-50 border border-indigo-100 rounded px-2 py-1.5 whitespace-pre-wrap">💬 본부 메시지 · {signTarget.sendMessage}</p>
                )}
                <button type="button" className="text-xs text-blue-600 underline text-left"
                  onClick={() => openBigDoc(`/api/docs/pdf?src=${encodeURIComponent(getFileUrl(signTarget.fileUrl))}&title=${encodeURIComponent(signTarget.title)}`, signTarget.title)}>
                  문서 보기 (PDF)
                </button>
                {/* 작성 시 입력값 요약 — 계약서를 열지 않아도 핵심 내용 확인 */}
                {/* 그 문서 템플릿의 필드만(#206-2) — 묶음 5종 공통값을 다 보여주면 무엇에 서명하는지 흐려진다 */}
                {Object.keys(signTarget.summaryFields ?? signTarget.extraFields ?? {}).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-200 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    {/* 내부 필드명(체크_·선택_) 그대로 노출 금지 — 사람 말로 (#125) */}
                    {Object.entries(signTarget.summaryFields ?? signTarget.extraFields ?? {})
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
              {/* 실제 서명할 문서 실물 — **이 문서 1건**(#206-2, 종전엔 패키지 전 문서가 이어진 PDF라 첫 쪽이 늘 사직원) + 확대·축소 (#160).
                  패키지 전체는 아래 [패키지 전체 보기]로 따로 본다. */}
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
                    onClick={() => openBigDoc(`/api/contracts/${signTarget.id}/bundle-preview?hl=1&only=1`, "서명할 문서")}
                  >
                    <Eye size={12} />크게 보기
                  </button>
                  <iframe
                    src={`/api/contracts/${signTarget.id}/bundle-preview?hl=1&only=1`}
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
              {/* 묶음이면 패키지 전체를 **따로** 본다 — 서명 대상 미리보기와 섞지 않는다(#206-2) */}
              <Button type="button" variant="outline" size="sm" className="w-full gap-1"
                onClick={() => openBigDoc(
                  `/api/contracts/${signTarget.id}/bundle-preview?hl=1${signTarget.bundleId ? "" : "&only=1"}`,
                  signTarget.bundleId ? "패키지 전체 문서" : "서명할 문서")}>
                <Eye size={13} />{signTarget.bundleId ? "패키지 전체 보기" : "크게 보기"}
              </Button>
              {/* 스크롤해도 항상 보이도록 하단에 붙인다 */}
              <div className="flex gap-2 justify-end sticky bottom-0 bg-white pt-3 pb-1 -mx-1 px-1 border-t">
                <Button variant="outline" onClick={() => setSignOpen(false)}>취소</Button>
                {/* 조건이 안 맞으면 버티는 대신 사유를 남긴다 (2026-09-04) */}
                <Button variant="ghost" className="text-red-600 hover:bg-red-50"
                        onClick={() => { setRejectReason(""); setRejectOpen(true); }}>반려</Button>
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
              {/* 발송 당시 양식 버전(#48) — 그 뒤 양식을 고쳐도 이 계약은 이 버전으로 보냈다 */}
              {versionsTarget.templateVersion != null && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1.5">발송 당시 양식 버전: <b>v{versionsTarget.templateVersion}</b></p>
              )}
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
                {role === "ADMIN" && approvalDetailsTarget && (approvalDetailsTarget.status !== "SIGNED" || approvalDetailsTarget.isTest) && (
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
                    <p className="text-sm font-medium">{approvalDetailsTarget.externalName ? "외부 서명" : "직원 서명"}</p>
                    <p className="text-xs text-gray-500">{approvalDetailsTarget.externalName ? `[외부] ${approvalDetailsTarget.externalName}` : approvalDetailsTarget.user.name}</p>
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
                      ) : step.status === "REJECTED" ? (
                        <Badge variant="destructive">반려</Badge>
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
                    <a href={`/api/contracts/${approvalDetailsTarget.id}/signed-document`} className="block" onClick={() => { fetch(`/api/contracts/${approvalDetailsTarget.id}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "DOWNLOADED" }) }).catch(() => {}); }}>
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
                    const actorId = log.rejectedBy ?? log.revokedBy;
                    const actor = employees.find(e => e.id === actorId);
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
                              {actor?.name || "알 수 없는 사용자"} · {when}
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

              {/* 감사 기록(#205-4) — 발송·열람·본인 확인·동의·서명·반려·회수·수정의 시각·IP·기기 */}
              <ContractEventsList contractId={approvalDetailsTarget.id} />
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
          ref={bigRef}
          className="fixed inset-0 z-[100] bg-black/70 flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="문서 크게 보기"
          onClick={() => setBigDoc(null)}   /* 바깥을 누르면 닫힌다 */
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-white shrink-0 flex-wrap" onClick={e => e.stopPropagation()}>
            <span className="text-sm truncate min-w-[6rem] flex-1">{bigDoc.title}</span>
            <div className="flex items-center gap-1 shrink-0">
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
          <div className="relative flex-1 min-h-0 mx-2 mb-2 overflow-auto rounded bg-white" onClick={e => e.stopPropagation()}>
            {bigLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-white/80 text-sm text-gray-600">
                <Loader2 size={18} className="animate-spin" />문서를 만드는 중입니다… (PDF 변환에 몇 초 걸립니다)
              </div>
            )}
            {/* scale 로 키우면 잘리므로 iframe 크기를 1/zoom 으로 역보정 (서명 모달과 같은 방식) */}
            <iframe
              src={bigDoc.src}
              title={bigDoc.title}
              onLoad={() => setBigLoading(false)}
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

// 발송 창 칸 순서 버튼(#213-2) — 양식이 순서 변경을 허용했을 때만 보인다
function SlotOrderButtons({ i, n, onMove, onRemove }: { i: number; n: number; onMove: (i: number, d: -1 | 1) => void; onRemove: (i: number) => void }) {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1 shrink-0">
      <button type="button" onClick={e => { e.stopPropagation(); onMove(i, -1); }} disabled={i === 0} className="text-gray-400 hover:text-gray-700 disabled:text-gray-200" title="위로">▲</button>
      <button type="button" onClick={e => { e.stopPropagation(); onMove(i, 1); }} disabled={i === n - 1} className="text-gray-400 hover:text-gray-700 disabled:text-gray-200" title="아래로">▼</button>
      <button type="button" onClick={e => { e.stopPropagation(); onRemove(i); }} disabled={n <= 1} className="text-gray-400 hover:text-red-500 disabled:text-gray-200" title="단계 삭제">－</button>
    </span>
  );
}

