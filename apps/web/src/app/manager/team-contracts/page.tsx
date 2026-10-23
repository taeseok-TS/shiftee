"use client";
// 원장 「전자계약 › 지점 계약서」 — 본부 시안 R12(보낸 계약서)와 같은 숫자 칸 · 알약 탭 · 표(2026-10-21 「디자인 통일」, 범위만 우리 지점).
//  · 옛 주황 「내 결재 대기」 판 대신 숫자 칸 「결재 대기」(1 이상 빨강, 누르면 아래 표가 내가 승인할 것만)
//  · 원장 차례인 줄 = 인디고 「열기」(승인 전체 창), 나머지 = 흰 「보기」(열람만 — 원장에게 내려받기는 두지 않는다)
//  · 주소 ?id=<계약 id> 로 들어오면 한 번만: 원장 차례면 승인 전체 창, 아니면 그 줄 강조 · 스크롤 — 그 뒤 주소에서 id 를 지운다
import { PageHead, Btn, btnClass, Box, Tiles, Tile, PillTabs, FilterRow, inputClass, tableClass, Cell2, Chip, StatusPill, FlowDots, MoreMenu, type PillTone, type FlowStep } from "@/components/kit";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileSignature, Search } from "lucide-react";
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
  importBatch?: string | null; // 모두싸인 이관본 — 「지난 서류」(2026-10-23 본부 ■2)
  startDate: string | null;
  endDate: string | null;
  signDeadline?: string | null; // 서명 기한(표 「기한」 칸 — 보기만)
  extraFields?: Record<string, string> | null; // 작성 시 입력값 요약 (연봉·수습 기간 등)
  summaryFields?: Record<string, string> | null; // 서명 창 요약 — 그 문서 템플릿 필드만(서버 계산, #206-2)
  createdAt: string;
  user: { id: string; name: string; department: string | null; branch: string | null; empNo?: number | null; employmentStatus?: string | null; resignDate?: string | null };
  approvalLine?: { steps: Step[] } | null;
};

const typeLabel: Record<string, string> = {
  EMPLOYMENT: "근로계약서", PART_TIME: "단시간근로계약서", CONFIDENTIAL: "비밀유지계약", OTHER: "기타",
};
// 상태 알약 — 보낸 계약서(R12)와 같은 이름 · 색(대기 주황 · 체결 파랑 · 반려 분홍 · 초안 · 만료 회색)
const STATUS_PILL: Record<string, { tone: PillTone; label: string }> = {
  DRAFT: { tone: "gray", label: "초안" }, SENT: { tone: "wait", label: "서명 대기" }, APPROVED: { tone: "wait", label: "결재 중" },
  SIGNED: { tone: "done", label: "체결 완료" }, REJECTED: { tone: "rej", label: "반려" }, EXPIRED: { tone: "gray", label: "만료" },
};
// 알약 탭(R12 — 전체 · 서명 대기 · 체결 완료 · 반려 · 만료, 초안은 있을 때만). 「mine」 = 숫자 칸 「결재 대기」를 눌렀을 때(내가 승인할 것만)
type ListTab = "all" | "waiting" | "signed" | "rejected" | "expired" | "draft" | "mine";
const TAB_STATUS: Record<Exclude<ListTab, "all" | "mine">, string[]> = {
  waiting: ["SENT", "APPROVED"], signed: ["SIGNED"], rejected: ["REJECTED"], expired: ["EXPIRED"], draft: ["DRAFT"],
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

// 결재 진행 = 사람마다 점 + 이름(R12 — 끝남 파랑 · 지금 차례 주황 · 남음 회색, 초록 체크 아이콘 없음)
function ApprovalChain({ steps, userId }: { steps?: Step[]; userId?: string }) {
  // 단계가 없으면(이관본 등) 회색 「—」만(2026-10-23 본부 ■2)
  if (!steps || steps.length === 0) return <span className="text-[13px] text-[#94a3b8]">—</span>;
  const dots: FlowStep[] = steps.map((step) => ({
    label: step.approver?.name || (step.approverId === userId ? "직원" : step.externalName || "외부 서명자"),
    state: step.status === "APPROVED" ? "done" : step.status === "PENDING" ? "now" : "todo",
  }));
  return <FlowDots steps={dots} />;
}

const KST_MS = 9 * 3600 * 1000;
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
// 기한 「10월 31일 (토)」(KST, 공통 규칙 ■4 — 카드 · 표 같은 형식) — 진행 중(서명 대기 · 결재 중)일 때만
function deadlineOf(c: Contract): string | null {
  if (!c.signDeadline || !(c.status === "SENT" || c.status === "APPROVED")) return null;
  const d = new Date(new Date(c.signDeadline).getTime() + KST_MS);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEKDAY[d.getUTCDay()]})`;
}

// 당사자 퇴사 — 퇴직 상태이거나 퇴사일이 오늘(KST) 이전
function isResigned(u: Contract["user"]): boolean {
  if (u.employmentStatus === "RESIGNED") return true;
  if (!u.resignDate) return false;
  const t = new Date(u.resignDate).getTime();
  if (isNaN(t)) return false;
  const day = new Date(t + KST_MS).toISOString().slice(0, 10);
  return day < new Date(Date.now() + KST_MS).toISOString().slice(0, 10);
}
// 「지난 서류」(2026-10-23 본부 ■2) — 모두싸인 이관본, 또는 당사자가 퇴사한 끝난 계약(체결 · 반려 · 만료).
// 기본 목록 · 숫자 칸 · 탭 건수에서 빼고 「지난 서류 보기」를 켜면 함께 센다
const ENDED = ["SIGNED", "REJECTED", "EXPIRED"];
function isPastDoc(c: Contract): boolean {
  return !!c.importBatch || (!c.externalName && ENDED.includes(c.status) && isResigned(c.user));
}
// 정렬 — 진행 중(서명 대기 · 결재 중) 먼저, 그다음 나머지. 각각 만든 날 내림차순
const ACTIVE = ["SENT", "APPROVED"];
function sortContracts(list: Contract[]): Contract[] {
  return [...list].sort((a, b) => {
    const pa = ACTIVE.includes(a.status) ? 0 : 1, pb = ACTIVE.includes(b.status) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
}

export default function ManagerContractsPage() {
  const [branch, setBranch] = useState("");
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [myApprovals, setMyApprovals] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [listTab, setListTab] = useState<ListTab>("all");
  const [search, setSearch] = useState("");
  const [showPast, setShowPast] = useState(false);   // 「지난 서류 보기」(이관본 · 퇴사자의 끝난 계약) — 기본 끔

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
  // 주소 ?id= — 처음 한 번만 읽어 둔다(목록이 오면 열기 · 강조, 주소에서는 바로 지운다)
  const [openId, setOpenId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const openDone = useRef(false);   // ?id= 는 한 번만(개발 모드 이중 실행 · 목록 다시 받기에 다시 열리지 않게)

  const [myId, setMyId] = useState("");
  const [myRole, setMyRole] = useState("");   // 승인 창 제목·내 단계 이름 — 본부(관리자)가 열면 「본부」(2026-10-21 디렉터 지적)
  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      setMyId(d.user?.id || "");
      setMyRole(d.user?.role || "");
      setBranch(d.user?.branch || d.branch || "");
      setMySignatureUrl(d.user?.signatureUrl || null);
    }).catch(() => {});
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) {
      window.history.replaceState(null, "", window.location.pathname);   // 한 번만 — 새로고침 · 뒤로 가기에 다시 열리지 않게
      Promise.resolve().then(() => setOpenId(id));
    }
  }, []);

  // 상태는 화면에서 거른다(알약 탭 · 숫자 칸이 같은 목록을 센다). 찾기는 서버가(이름 · 서류 이름)
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
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
  }, [search]);

  useEffect(() => { void Promise.resolve().then(fetchData); }, [fetchData]);

  // ?id= 처리 — 목록이 처음 온 뒤 한 번. 원장 차례면 승인 전체 창, 지점 목록에 있으면 그 줄 강조 · 스크롤
  useEffect(() => {
    if (!openId || loading || openDone.current) return;
    openDone.current = true;
    const id = openId;
    Promise.resolve().then(() => {
      setOpenId(null);
      const mine = myApprovals.find((c) => c.id === id);
      if (mine) { setSignTarget(mine); setSignOpen(true); return; }
      const found = contracts.find((c) => c.id === id);
      if (found) { setListTab("all"); if (isPastDoc(found)) setShowPast(true); setHighlightId(id); return; }   // 지난 서류면 보기를 켜야 그 줄이 표에 있다
      toast.info("이 계약서는 지점 목록에 없습니다(이미 처리됐거나 볼 수 없는 문서).");
    });
  }, [openId, loading, myApprovals, contracts]);
  useEffect(() => {
    if (!highlightId) return;
    // 같은 계약이 폰 카드 · PC 표 둘 다에 있다 — 지금 화면에 보이는 쪽(display:none 이 아닌 쪽)으로 스크롤
    const el = [document.getElementById("contract-" + highlightId), document.getElementById("contract-m-" + highlightId)].find((e) => e && e.offsetParent !== null);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, listTab, contracts]);

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

  // 표 · 숫자 칸 · 탭 건수가 같은 목록을 센다 — 지점 목록 + 원장 차례인데 지점 목록에 안 나오는 것(직원전용 · 외부 계약, 맨 위).
  //   결재 대기 목록은 찾기 없이 받아 오므로 찾기 글자로 여기서 거른다(최종 검증 A · B)
  const matchSearch = useCallback((c: Contract) => {
    const q = search.trim().toLowerCase();
    return !q || c.title.toLowerCase().includes(q) || (c.externalName || c.user.name).toLowerCase().includes(q);
  }, [search]);
  const all = useMemo(() => [...myApprovals.filter((a) => !contracts.some((c) => c.id === a.id) && matchSearch(a)), ...contracts], [myApprovals, contracts, matchSearch]);
  // 지난 서류(이관본 · 퇴사자의 끝난 계약)는 기본으로 빼고 센다 — 「지난 서류 보기」를 켜면 포함(2026-10-23 본부 ■2)
  const pastCount = useMemo(() => all.filter(isPastDoc).length, [all]);
  const merged = useMemo(() => (showPast ? all : all.filter((c) => !isPastDoc(c))), [all, showPast]);
  const countOf = (statuses: string[]) => merged.filter((c) => statuses.includes(c.status)).length;
  const draftCount = countOf(TAB_STATUS.draft);
  // 「결재 대기」(mine)는 결재 대기 목록 그대로(직원전용 · 외부 계약처럼 지점 목록에 안 나오는 것도 보인다). 찾기 글자로 한 번 더 거른다
  const shownContracts = useMemo(() => {
    if (listTab === "mine") return sortContracts(myApprovals.filter(matchSearch));
    if (listTab === "all") return sortContracts(merged);
    return sortContracts(merged.filter((c) => TAB_STATUS[listTab].includes(c.status)));
  }, [listTab, merged, myApprovals, matchSearch]);

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

  // 문서 보기 링크 — 서명이 있으면 지금까지의 서명 반영본(진행본)·완료본으로(원본을 열면 원장이 서명한 뒤에도 서명이 안 보였다, 2026-10-17).
  // 원장은 열람만(서버가 inline·PDF 로만 준다) — 내려받기 버튼은 두지 않는다(개인정보 보관 방지)
  const docLinkOf = (c: Contract) => progressHref(c) || (getFileUrl(c.fileUrl) ? viewHref(getFileUrl(c.fileUrl)) : null);
  const openDoc = (c: Contract) => {
    const href = docLinkOf(c);
    if (!href) return;
    if (progressHref(c)) recordViewed(c.id);
    window.open(href, "_blank", "noreferrer");
  };

  // 한 줄(표) · 한 장(폰 카드)의 판정을 한 곳에서 — 알약 · 원장 차례 · 보기 링크 · 기한 · 열람 기록. 둘이 같은 값을 쓴다(2026-10-23 ■4 「폰에서 표는 카드로」)
  const rowOf = (c: Contract) => {
    const pill = STATUS_PILL[c.status] || { tone: "gray" as PillTone, label: c.status };
    const mine = myApprovals.find((a) => a.id === c.id);   // 원장 결재 차례 = 인디고 「열기」 — 결재 대기 쪽 항목(문서 버전 · 요약 칸)으로 연다
    const link = docLinkOf(c);
    const prog = progressHref(c);
    const resigned = !c.externalName && isResigned(c.user);
    return {
      pill, mine, link, resigned,
      due: deadlineOf(c),
      viewTitle: prog ? (c.status === "SIGNED" ? "완료본 보기" : "서명 진행본 보기") : "원본 보기",
      onView: () => { if (prog) recordViewed(c.id); },   // 열람 기록(#205-4) — 진행본 · 완료본을 열 때만
      openMine: () => { setSignTarget(mine ?? c); setSignOpen(true); },
      party: c.externalName ? `[외부] ${c.externalName}` : c.user.name,
      // 둘째 줄 — 지점(퇴사면 「퇴사」 붙임) · 외부 계약자면 「외부 계약자」
      partySub: c.externalName ? "외부 계약자" : (c.user.branch || resigned) ? <>{c.user.branch}{resigned && <span className="ml-1 text-[11.5px] text-[#94a3b8]">퇴사</span>}</> : undefined,
    };
  };

  return (
    <div>
      <PageHead crumb="전자계약 › 지점 계약서" title="지점 계약서" note={`${branch ? `${branch} · ` : ""}지점 직원 계약서 조회 및 결재`} />

      {/* 숫자 칸(R12) — 옛 주황 「내 결재 대기」 판 대신. 칸을 누르면 아래 표가 그 상태로 걸러진다 */}
      <Box icon={<FileSignature />} title="계약 현황" sub={search.trim() ? `찾기 「${search.trim()}」 기준` : "전체 기간"}>
        <Tiles cols={5}>
          <Tile label="결재 대기" value={loading ? null : myApprovals.length} unit="건" note="내 결재 차례" alert active={listTab === "mine"} onClick={() => setListTab("mine")} />
          <Tile label="서명 대기" value={loading ? null : countOf(TAB_STATUS.waiting)} unit="건" note="서명 · 결재 진행 중" active={listTab === "waiting"} onClick={() => setListTab("waiting")} />
          <Tile label="체결 완료" value={loading ? null : countOf(TAB_STATUS.signed)} unit="건" active={listTab === "signed"} onClick={() => setListTab("signed")} />
          <Tile label="반려" value={loading ? null : countOf(TAB_STATUS.rejected)} unit="건" active={listTab === "rejected"} onClick={() => setListTab("rejected")} />
          <Tile label="지점 계약서" value={loading ? null : merged.length} unit="건" note="우리 지점 전체" hl active={listTab === "all"} onClick={() => setListTab("all")} />
        </Tiles>
      </Box>

      <PillTabs value={listTab === "mine" ? "" : listTab} onChange={(k) => setListTab(k as ListTab)} tabs={[
        { key: "all", label: "전체" },
        { key: "waiting", label: "서명 대기", count: countOf(TAB_STATUS.waiting) },
        { key: "signed", label: "체결 완료" },
        { key: "rejected", label: "반려", count: countOf(TAB_STATUS.rejected) },
        { key: "expired", label: "만료" },
        // 초안은 원장이 직접 만든 것만 보인다 — 있을 때만 탭을 둔다
        ...(draftCount > 0 || listTab === "draft" ? [{ key: "draft", label: "초안", count: draftCount }] : []),
      ]} />

      {/* 계약서 목록(R12) — 처리: 원장 차례 = 인디고 「열기」(승인 전체 창), 나머지 = 흰 「보기」(열람만) */}
      <Box icon={<FileSignature />} tone="sky" title="계약서 목록"
        sub={loading ? "불러오는 중…" : `${listTab === "mine" ? "내 결재 차례만 · " : ""}${shownContracts.length}건`}
        right={<>
          {listTab === "mine" && <Btn kind="text" onClick={() => setListTab("all")}>전체 보기</Btn>}
          {/* 지난 서류(모두싸인 이관본 · 퇴사자의 끝난 계약) — 켜면 표 · 숫자 칸 · 탭 건수에 함께 센다 */}
          {(pastCount > 0 || showPast) && <Chip on={showPast} onClick={() => setShowPast((v) => !v)}>지난 서류 보기 ({pastCount})</Chip>}
        </>}>
        <FilterRow>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="이름 · 서류 이름으로 찾기" aria-label="찾기"
              className={`${inputClass} w-64 pl-8`} />
          </div>
        </FilterRow>

        {loading ? (
          <p className="px-6 py-10 text-center text-[14px] text-[#596578]">불러오는 중…</p>
        ) : shownContracts.length === 0 ? (
          <p className="px-6 py-10 text-center text-[14px] text-[#596578]">{listTab === "mine" ? "내 결재 차례인 계약서가 없습니다" : "계약서가 없습니다"}</p>
        ) : (<>
          {/* 폰(md 미만) 카드 — 오른쪽 위 기한 · 서류 이름 · 「이름 · 지점」 · 상태 알약 + 결재 진행 · 아래 가로로 꽉 찬 버튼(표와 같은 판정 rowOf) */}
          <div className="divide-y divide-[#f1f5f9] md:hidden">
            {shownContracts.map((c) => {
              const r = rowOf(c);
              return (
                <div key={c.id} id={"contract-m-" + c.id} className={`space-y-2 px-4 py-4 ${highlightId === c.id ? "bg-[#eef2ff]" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 leading-snug">
                      <b className="text-[16px] font-bold text-[#0f172a]">{c.title}</b>
                      <span className="ml-1.5 text-[12.5px] text-[#596578]">{typeLabel[c.type] || c.type}</span>
                    </p>
                    {r.due && <span className="shrink-0 whitespace-nowrap pt-0.5 text-[12.5px] text-[#596578]">기한 {r.due}</span>}
                  </div>
                  <p className="text-[13.5px] text-[#475569]">
                    <span className="font-semibold text-[#0f172a]">{r.party}</span>
                    {r.partySub && <> <span className="text-[#cbd5e1]">·</span> {r.partySub}</>}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <StatusPill tone={r.pill.tone}>{r.pill.label}</StatusPill>
                    <ApprovalChain steps={c.approvalLine?.steps} userId={c.externalName ? undefined : c.userId} />
                  </div>
                  {(r.mine || r.link) && (
                    <div className="flex items-center gap-2 pt-0.5">
                      {r.mine ? (
                        <Btn kind="primary" className="flex-1 py-2.5" onClick={r.openMine}>열기</Btn>
                      ) : r.link ? (
                        <a href={r.link} target="_blank" rel="noreferrer" className={btnClass("secondary", "flex-1 py-2.5")} title={r.viewTitle} onClick={r.onView}>보기</a>
                      ) : null}
                      {/* 원장 차례인 카드 — 승인 창 밖에서 문서만 먼저 볼 때(표의 ⋮ 와 같다) */}
                      {r.mine && r.link && <MoreMenu big items={[{ label: "문서 보기", onClick: () => openDoc(c) }]} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>직원</th>
                  <th>서류</th>
                  <th>상태</th>
                  <th>결재 진행</th>
                  <th>기한</th>
                  <th className="text-right">처리</th>
                </tr>
              </thead>
              <tbody>
                {shownContracts.map(c => {
                  const r = rowOf(c);
                  return (
                    <tr key={c.id} id={"contract-" + c.id} className={highlightId === c.id ? "bg-[#eef2ff]" : "hover:bg-[#fafbfd]"}>
                      <td><Cell2 main={r.party} sub={r.partySub} /></td>
                      <td>
                        <span className="text-[#0f172a]">{c.title}</span>
                        <span className="block text-[12.5px] text-[#596578]">{typeLabel[c.type] || c.type}</span>
                      </td>
                      <td><StatusPill tone={r.pill.tone}>{r.pill.label}</StatusPill></td>
                      <td><ApprovalChain steps={c.approvalLine?.steps} userId={c.externalName ? undefined : c.userId} /></td>
                      <td className="whitespace-nowrap">{r.due ? <span className="text-[#475569]">{r.due}</span> : <span className="text-[#94a3b8]">—</span>}</td>
                      <td className="whitespace-nowrap text-right">
                        <span className="inline-flex items-center gap-1">
                          {r.mine ? (
                            <Btn kind="primary" className="px-3.5 py-1.5" onClick={r.openMine}>열기</Btn>
                          ) : r.link ? (
                            <a href={r.link} target="_blank" rel="noreferrer" className={btnClass("secondary", "px-3.5 py-1.5")} title={r.viewTitle} onClick={r.onView}>보기</a>
                          ) : null}
                          {/* 원장 차례인 줄 — 승인 창 밖에서 문서만 먼저 볼 때(옛 「내 결재 대기」 판의 「보기」) */}
                          <MoreMenu items={[{ label: "문서 보기", hidden: !r.mine || !r.link, onClick: () => openDoc(c) }]} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>)}
      </Box>

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
              <p className="mt-2 text-[#be123c]">
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
            <Btn onClick={() => setRejectOpen(false)}>닫기</Btn>
            <Btn kind="primary" disabled={!rejectReason.trim() || rejectBusy} onClick={handleReject}>
              {rejectBusy ? "처리 중..." : "반려하기"}
            </Btn>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
