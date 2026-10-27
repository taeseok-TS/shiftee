"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Upload, Pin } from "lucide-react";
import { PageHead, Btn, btnClass, Chip, MoreMenu } from "@/components/kit";
import { format } from "date-fns";
import { toast } from "sonner";
import ApprovalOrderEditor from "@/components/contracts/ApprovalOrderEditor";
import FieldSettingsEditor from "@/components/contracts/FieldSettingsEditor";
import { parseFieldSettings, type FieldSettings } from "@/lib/contract-field-settings";
import { parseApprovalSteps, stepsLabel, type ApprovalStepSpec } from "@/lib/approval-order";
import { DEFAULT_PURPOSE_ORDER } from "@/lib/contract-send-layout";
import { CONTRACT_PURPOSES, OTHER_PURPOSE, defaultPurposesOf, parsePurposeMap, purposeLabel, purposesOf, type ContractPurpose } from "@/lib/contract-purpose";

type ContractTemplate = {
  id: string;
  name: string;
  description?: string;
  type: string;
  fileUrl: string;
  version: number;
  isActive: boolean;
  createdBy: string;
  createdByUser: { id: string; name: string };
  approverIds: string[];
  postSignAccess: string; // 서명 완료 후 근로자 접근 (#129)
  approvalSteps?: { kind: string }[] | null; // 결재 순서(#213-2) — 없으면 본부→원장→근로자
  approvalLocked?: boolean;                  // 발송 때 순서 변경 불가(기본 true)
  approvalStepsRenewal?: { kind: string }[] | null; // 재계약일 때의 결재 순서(2026-10-15) — 없으면 위 순서
  fieldSettings?: unknown;                   // 칸 설정(#22 1단계)
  layout?: unknown;                          // PDF 칸 배치(#22 2단계)
  labels?: string[];       // 라벨(#78)
  pinned?: boolean;        // 맨 위 고정(#78)
  createdAt: string;
  updatedAt: string;
};

const typeLabel: Record<string, string> = {
  EMPLOYMENT: "근로계약서",
  PART_TIME: "단시간근로계약서",
  CONFIDENTIAL: "비밀유지계약",
  OTHER: "기타",
};

// 서명 완료 후 근로자 접근 (#129) — 템플릿별로 완료본을 근로자에게 어디까지 열어줄지
const postSignAccessLabel: Record<string, string> = {
  full: "열람 + 다운로드",
  view: "열람만 (다운로드 불가)",
  none: "접근 불가 (제출 완료만 표시)",
};
// 화면용 판정(lib/contract-access 와 같은 규칙 — 서버 모듈은 prisma 를 물고 있어 클라이언트에서 못 가져온다)
const isEmploymentTpl = (name: string, type: string) => type === "EMPLOYMENT" || type === "PART_TIME" || /근로\s*계약서|파트\s*타임\s*계약서/.test(name);
const isDeliverableTpl = (name: string, type: string) =>
  isEmploymentTpl(name, type) || type === "CONFIDENTIAL" || /비밀\s*유지\s*(서약서|계약서)|개인\s*정보\s*수집\s*(및|[·.,]|과)?\s*이용\s*동의서|금품\s*청산\s*지급\s*기일\s*연장\s*동의서/.test(name);
const isPdfTpl = (fileUrl: string) => /\.pdf$/i.test(fileUrl);
// 카드 「버전」 줄의 날짜 — 올해면 「10/21 (화)」, 다른 해면 「2025/7/22 (화)」(공통 규칙 ■4)
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
function shortDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const md = `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY[d.getDay()]})`;
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}/${md}`;
}
// 원본 내려받기(⋮ 안) — 링크 줄을 없앴으므로 임시 a 로 받는다
function downloadFile(url: string) {
  const a = document.createElement("a");
  a.href = url; a.download = ""; a.rel = "noreferrer";
  document.body.appendChild(a); a.click(); a.remove();
}

export default function ContractTemplatesPage() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ContractTemplate | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const [form, setForm] = useState({
    name: "",
    description: "",
    type: "EMPLOYMENT",
    postSignAccess: "full",
    file: null as File | null,
    labels: "",   // 쉼표 구분(#78)
    approvalSteps: null as ApprovalStepSpec[] | null,   // 결재 순서(#213-2) — null = 지정 안 함(기본 3칸·검사 없음)
    approvalLocked: true,
    approvalStepsRenewal: null as ApprovalStepSpec[] | null,   // 재계약 결재 순서(2026-10-15) — null = 기본 순서 그대로
    fieldSettings: {} as FieldSettings,   // 칸 설정(#22 1단계)
  });
  const emptyForm = () => ({ name: "", description: "", type: "EMPLOYMENT", postSignAccess: "full", file: null as File | null, labels: "", approvalSteps: null as ApprovalStepSpec[] | null, approvalLocked: true, approvalStepsRenewal: null as ApprovalStepSpec[] | null, fieldSettings: {} as FieldSettings });
  // 라벨 거르기·파일 이력(#78)
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  // 용도 탭(2026-10-21 본부 이예지 재요청 G) — 「계약서 보내기」와 같은 이름·순서(채용 · 입사 · 재계약·연봉 · 퇴사 · 휴가·근태 신청 · 기타). null = 전체
  const [catFilter, setCatFilter] = useState<string | null>(null);
  // 「양식 만드는 법」 안내 — 기본 접힘(2026-10-23 본부 ■3)
  const [helpOpen, setHelpOpen] = useState(false);
  // 고른 라벨이 어느 템플릿에도 없으면(라벨을 지움) 거르지 않는다 — 빈 목록에 갇히지 않게(#78 검증 F3)
  const activeLabel = labelFilter && templates.some(t => (t.labels || []).includes(labelFilter)) ? labelFilter : null;
  const [history, setHistory] = useState<{ name: string; unrecorded?: { version: number; sent: number }[]; current: { version: number; fileUrl: string; sent: number }; past: { id: string; version: number; fileUrl: string; replacedAt: string; replacedBy: string | null; sent: number }[] } | null>(null);
  const openHistory = async (t: ContractTemplate) => {
    const res = await fetch(`/api/contract-templates/${t.id}/versions`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "이력을 불러오지 못했습니다."); return; }
    setHistory(d);
  };
  const copyTemplate = async (t: ContractTemplate) => {
    if (!confirm(`「${t.name}」의 사본을 만들까요?`)) return;
    const res = await fetch(`/api/contract-templates/${t.id}/copy`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "사본을 만들지 못했습니다."); return; }
    toast.success(`「${d.template?.name}」을(를) 만들었습니다.`);
    fetchTemplates();
  };
  const togglePin = async (t: ContractTemplate) => {
    const res = await fetch(`/api/contract-templates/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: !t.pinned }) });
    if (!res.ok) { toast.error("고정을 바꾸지 못했습니다."); return; }
    fetchTemplates();
  };

  const [uploading, setUploading] = useState(false);
  // 양식 용도(2026-10-17 「계약서 보내기」 화면의 용도 카드) — 본부가 고친 값 맵. 수정 창에서 고친다(AppSetting 저장, lib/contract-purpose)
  const [purposeMap, setPurposeMap] = useState<Record<string, ContractPurpose[]>>({});
  // 맵을 다 받기 전(loading)·못 받으면(error) 수정 창의 용도 칸을 막는다 — 기본값으로 보이는 걸 그대로 저장해 본부가 정한 용도를 되돌리지 않게(검증 2)
  const [purposeState, setPurposeState] = useState<"loading" | "ok" | "error">("loading");
  // 수정 창에서 용도를 **실제로 바꿨을 때만** 값이 있다(null = 손대지 않음 → 저장 때 용도는 건드리지 않는다)
  const [editPurposes, setEditPurposes] = useState<ContractPurpose[] | null>(null);

  // 템플릿 목록 조회
  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/contract-templates");
      const data = await res.json();
      setTemplates(data.templates || []);
      // 용도는 못 받아도 목록은 보인다(이름 기준 기본 용도로)
      fetch("/api/admin/contract-purposes").then(r => (r.ok ? r.json() : null))
        .then(d => { if (d) { setPurposeMap(parsePurposeMap(d.purposes)); setPurposeState("ok"); } else setPurposeState(s => (s === "ok" ? s : "error")); })
        .catch(() => setPurposeState(s => (s === "ok" ? s : "error")));
    } catch (error) {
      console.error("템플릿 로드 실패:", error);
      toast.error("양식을 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // 템플릿 생성
  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error("양식 이름을 입력해 주세요");
      return;
    }
    if (!form.file) {
      toast.error("PDF 또는 워드(.docx) 파일을 선택해주세요");
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("name", form.name);
      formData.append("description", form.description || "");
      formData.append("type", form.type);
      formData.append("file", form.file);
      if (form.approvalSteps) formData.append("approvalSteps", JSON.stringify(form.approvalSteps)); // 결재 순서(#213-2) — 없으면 안 보냄(NULL)
      if (form.approvalSteps && form.approvalStepsRenewal) formData.append("approvalStepsRenewal", JSON.stringify(form.approvalStepsRenewal)); // 재계약 순서(2026-10-15)
      formData.append("approvalLocked", String(form.approvalLocked));

      const res = await fetch("/api/contract-templates", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "양식을 만들지 못했습니다");
      }

      toast.success("양식을 만들었습니다");
      setForm(emptyForm());
      setCreateOpen(false);
      fetchTemplates();
    } catch (error) {
      console.error("템플릿 생성 실패:", error);
      toast.error(error instanceof Error ? error.message : "양식을 만들지 못했습니다");
    } finally {
      setUploading(false);
    }
  };

  // 템플릿 수정
  const handleUpdate = async () => {
    if (!editTarget) return;
    if (!form.name.trim()) {
      toast.error("양식 이름을 입력해 주세요");
      return;
    }

    try {
      setUploading(true);
      // 파일 포함 여부와 무관하게 FormData로 전송 (서버가 multipart/JSON 둘 다 처리)
      const formData = new FormData();
      formData.append("name", form.name);
      formData.append("description", form.description || "");
      formData.append("type", form.type);
      formData.append("postSignAccess", form.postSignAccess); // 서명 완료 후 근로자 접근 (#129)
      formData.append("labels", form.labels); // 라벨(#78)
      formData.append("approvalSteps", form.approvalSteps ? JSON.stringify(form.approvalSteps) : ""); // 결재 순서(#213-2) — "" 면 지정 안 함(NULL)으로
      formData.append("approvalStepsRenewal", form.approvalSteps && form.approvalStepsRenewal ? JSON.stringify(form.approvalStepsRenewal) : ""); // 재계약 순서(2026-10-15) — 기본 순서가 없으면 같이 지운다
      formData.append("approvalLocked", String(form.approvalLocked));
      if (!/\.pdf$/i.test(editTarget.fileUrl)) formData.append("fieldSettings", JSON.stringify(form.fieldSettings)); // 칸 설정(#22 1단계) — PDF 양식은 칸 배치 편집기가 정한다(여기서 보내면 옛 값으로 덮는다)
      if (form.file) formData.append("file", form.file); // 있을 때만 교체

      const res = await fetch(`/api/contract-templates/${editTarget.id}`, {
        method: "PATCH",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "수정 실패");
      }
      const ok = await res.json().catch(() => ({}));
      if (ok?.warning) toast.warning(ok.warning, { duration: 8000 });   // 칸 배치가 있는 PDF 파일 교체(#22 2단계)
      // 용도(2026-10-17) — 바꿨을 때만 저장. 새 이름의 기본값과 같으면 「기본값」으로 둔다(이름을 또 바꾸면 기본 분류가 따라가게)
      const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
      // 사용자가 용도 칸을 건드렸을 때만 저장한다(같은 값이어도 — 「기본값으로」를 눌러 직접 정한 값을 지우는 경우, 재검증 10/17)
      if (editPurposes && purposeState === "ok") {
        const purposes = sameSet(editPurposes, defaultPurposesOf({ name: form.name, type: form.type })) ? null : editPurposes;
        const pr = await fetch("/api/admin/contract-purposes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId: editTarget.id, purposes }) });
        const pd = await pr.json().catch(() => ({}));
        if (!pr.ok) toast.error(pd.error || "용도를 저장하지 못했습니다(나머지는 저장됨).");
        else setPurposeMap(parsePurposeMap(pd.purposes));
      }

      toast.success("양식을 고쳤습니다");
      setForm(emptyForm());
      setEditOpen(false);
      setEditTarget(null);
      fetchTemplates();
    } catch (error) {
      console.error("템플릿 수정 실패:", error);
      toast.error(error instanceof Error ? error.message : "수정 실패");
    } finally {
      setUploading(false);
    }
  };

  // 템플릿 삭제
  const handleDelete = async (templateId: string) => {
    if (!confirm("정말로 삭제하시겠습니까?")) return;

    try {
      const res = await fetch(`/api/contract-templates/${templateId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("삭제 실패");
      }

      toast.success("양식을 지웠습니다");
      fetchTemplates();
    } catch (error) {
      console.error("템플릿 삭제 실패:", error);
      toast.error("삭제 실패");
    }
  };

  // 수정 모달 열기
  const openEditDialog = (template: ContractTemplate) => {
    setEditTarget(template);
    setForm({
      name: template.name,
      description: template.description || "",
      type: template.type,
      postSignAccess: template.postSignAccess || "full",
      approvalSteps: parseApprovalSteps(template.approvalSteps),   // 없으면 null(지정 안 함) 그대로 — 수정만 해도 순서가 생기지 않게(검증 F2)
      approvalLocked: template.approvalLocked !== false,
      approvalStepsRenewal: parseApprovalSteps(template.approvalStepsRenewal),
      fieldSettings: parseFieldSettings(template.fieldSettings),
      file: null,
      labels: (template.labels || []).join(", "),
    });
    setEditPurposes(null);   // 손대기 전에는 저장값(맵)을 그대로 보여 준다
    setEditOpen(true);
  };

  // 용도 — 저장값(본부가 고친 것)이 이기고 없으면 이름·종류로 정한 기본값. 아무 용도도 없으면 「기타」
  const inPurpose = (t: ContractTemplate, key: string) => { const ps = purposesOf(t, purposeMap); return key === "other" ? ps.length === 0 : ps.includes(key as ContractPurpose); };
  const primaryPurpose = (t: ContractTemplate) => DEFAULT_PURPOSE_ORDER.find(k => inPurpose(t, k)) ?? "other";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-500">로드 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 머리(시안 R6) — 다른 화면과 같은 kit 머리 + 오른쪽 인디고 실행 버튼 하나 */}
      <PageHead crumb="전자계약 › 양식 관리" title="양식 관리">
        <Btn kind="primary" onClick={() => { setForm(emptyForm()); setCreateOpen(true); }}><Plus size={15} />새 양식 만들기</Btn>
      </PageHead>

      {/* 「양식 만드는 법」 — 기본 접힘(2026-10-23 본부 ■3: {칸}태그 · 편집기 설명은 본부 직원도 어렵다). 누르면 펼쳐진다 */}
      <div className="-mt-2">
        <button type="button" onClick={() => setHelpOpen((v) => !v)} aria-expanded={helpOpen}
          className="text-[13px] font-semibold text-[#4f46e5] hover:underline">양식 만드는 법 {helpOpen ? "▾" : "›"}</button>
        {helpOpen && (
          <div className="mt-2 rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-[13px] leading-relaxed text-[#334155] space-y-1.5">
            <p><b>PDF 양식</b> — 「새 양식 만들기」에서 PDF 를 올린 뒤, 카드의 <b>「칸 배치」</b>에서 입력칸·서명칸을 문서 위에 끌어다 놓습니다. 칸마다 누가 채우는지(본부·근로자)와 필수 여부도 거기서 정합니다.</p>
            <p><b>워드(.docx) 양식</b> — 문서 안에 {"{직원명}"} {"{연봉}"} 같은 칸 이름을 중괄호로 적어 두면 보낼 때 자동으로 채워집니다. 「수정 › 칸 설정」에서 칸마다 채우는 방식·필수를 정합니다.</p>
            <p className="text-[#596578]">쓸 수 있는 칸 이름: {"{직원명} {이메일} {연락처} {지점} {직책} {직급} {입사일} {제목} {계약시작일} {계약종료일} {연봉} {작성일}"}</p>
          </div>
        )}
      </div>

      {/* 용도 탭(재요청 G) — 「계약서 보내기」의 용도와 같다. 한 양식이 여러 용도에 들 수 있다(에듀플렉스 근로계약서 = 입사 + 재계약·연봉) */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="용도">
        <button type="button" role="tab" aria-selected={!catFilter} onClick={() => setCatFilter(null)}
          className={`px-3 py-1 rounded-full text-sm border ${!catFilter ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>전체 {templates.length}</button>
        {DEFAULT_PURPOSE_ORDER.map(key => {
          const n = templates.filter(t => inPurpose(t, key)).length;
          if (n === 0) return null;
          return (
            <button key={key} type="button" role="tab" aria-selected={catFilter === key} onClick={() => setCatFilter(catFilter === key ? null : key)}
              className={`px-3 py-1 rounded-full text-sm border ${catFilter === key ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>{purposeLabel(key)} {n}</button>
          );
        })}
      </div>

      {/* 라벨로 거르기(#78) */}
      {[...new Set(templates.flatMap(t => t.labels || []))].length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Chip on={!activeLabel} onClick={() => setLabelFilter(null)}>전체</Chip>
          {[...new Set(templates.flatMap(t => t.labels || []))].sort().map(l => (
            <Chip key={l} on={activeLabel === l} onClick={() => setLabelFilter(activeLabel === l ? null : l)}>{l}</Chip>
          ))}
        </div>
      )}

      {/* 템플릿 목록 — 묶음별로 머리글을 두고 묶음 순서대로(#214-5). 묶음 안은 서버 순서(고정 → 최근 등록) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.length === 0 ? (
          <Card className="md:col-span-2">
            <CardContent className="pt-10 pb-8 flex flex-col items-center gap-3">
              <p className="text-center text-gray-500">등록된 양식이 없습니다</p>
              <Btn kind="primary" onClick={() => { setForm(emptyForm()); setCreateOpen(true); }}><Plus size={15} />새 양식 만들기</Btn>
            </CardContent>
          </Card>
        ) : templates.every(t => (catFilter && !inPurpose(t, catFilter)) || (activeLabel && !(t.labels || []).includes(activeLabel))) ? (
          <Card className="md:col-span-2">
            <CardContent className="pt-10">
              <p className="text-center text-gray-500">고른 용도·라벨에 해당하는 양식이 없습니다. <button type="button" className="text-[#4f46e5] hover:underline" onClick={() => { setCatFilter(null); setLabelFilter(null); }}>전체 보기</button></p>
            </CardContent>
          </Card>
        ) : (
          // 전체 = 양식마다 첫 용도(탭 순서) 머리글 아래 한 번씩, 용도 탭 = 그 용도에 드는 양식 모두
          DEFAULT_PURPOSE_ORDER.filter(key => !catFilter || key === catFilter).flatMap(key => {
            const list = templates.filter(t => (catFilter ? inPurpose(t, key) : primaryPurpose(t) === key) && (!activeLabel || (t.labels || []).includes(activeLabel)));
            if (list.length === 0) return [];
            return [
              <div key={`h-${key}`} className="md:col-span-2 flex items-center gap-2 pt-2">
                <span className="text-sm font-semibold text-gray-700">{purposeLabel(key)}</span>
                <span className="text-xs text-gray-400">{list.length}</span>
                <span className="flex-1 border-t" />
              </div>,
              ...list.map(template => (
            // 카드(시안 R6) — 이름 · 설명 한 줄 · 라벨-값 줄(쓰는 곳 · 결재 순서 · 근로자 · 버전) · 아래 「수정」(+PDF 「칸 배치」) · 오른쪽 위 ⋮
            <Card key={template.id} className={`hover:shadow-md transition-shadow ${template.pinned ? "border-amber-300" : ""}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-lg flex items-center gap-1.5">
                      <button type="button" onClick={() => togglePin(template)} title={template.pinned ? "고정 풀기" : "맨 위에 고정"}
                        className={template.pinned ? "text-amber-500" : "text-gray-300 hover:text-amber-500"}><Pin size={15} /></button>
                      <span className="truncate">{template.name}</span>
                    </CardTitle>
                    {template.description && <p className="mt-1 truncate text-[13px] text-[#596578]" title={template.description}>{template.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant="outline">{typeLabel[template.type] || template.type}</Badge>
                    {/* ⋮ — 미리보기 · 원본 내려받기 · 버전 이력 · 사본 만들기 · (구분선) · 삭제. 삭제는 「수정」 옆에 두지 않는다(잘못 누름) */}
                    <MoreMenu items={[
                      { label: "미리보기", onClick: () => window.open(template.fileUrl, "_blank", "noreferrer") },
                      { label: "원본 내려받기", onClick: () => downloadFile(template.fileUrl) },
                      { label: "버전 이력", onClick: () => openHistory(template) },
                      { label: "사본 만들기", onClick: () => copyTemplate(template) },
                      { label: "삭제", danger: true, onClick: () => handleDelete(template.id) },
                    ]} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {(template.labels || []).length > 0 && (
                  <div className="flex flex-wrap gap-1">{(template.labels || []).map(l => <Badge key={l} variant="secondary" className="text-[11px]">{l}</Badge>)}</div>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                  <dt className="text-[#596578]">쓰는 곳</dt>
                  <dd className="text-[#0f172a]">
                    {(() => { const ps = purposesOf(template, purposeMap); return ps.length ? ps.map(purposeLabel).join(" · ") : OTHER_PURPOSE.label; })()}
                    {Object.prototype.hasOwnProperty.call(purposeMap, template.id) ? <span className="text-[#94a3b8]"> (직접 정함)</span> : null}
                  </dd>
                  <dt className="text-[#596578]">결재 순서</dt>
                  <dd className="text-[#0f172a]">
                    {stepsLabel(parseApprovalSteps(template.approvalSteps))}
                    <span className="text-[#94a3b8]">{template.approvalSteps && template.approvalLocked === false ? " (발송 때 변경 가능)" : ""}</span>
                    {template.approvalSteps && template.approvalStepsRenewal ? <span className="block">재계약 {stepsLabel(parseApprovalSteps(template.approvalStepsRenewal))}</span> : null}
                  </dd>
                  {/* 근로자 접근 — 기본값(열람 + 다운로드)이면 줄을 생략, 열람만·접근 불가일 때만 */}
                  {template.postSignAccess && template.postSignAccess !== "full" && (<>
                    <dt className="text-[#596578]">근로자</dt>
                    <dd className="text-[#0f172a]">{postSignAccessLabel[template.postSignAccess] || template.postSignAccess}</dd>
                  </>)}
                  <dt className="text-[#596578]">버전</dt>
                  <dd className="text-[#0f172a]">v{template.version} · 마지막 수정 {shortDay(template.updatedAt || template.createdAt)} · {template.createdByUser.name}</dd>
                </dl>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => openEditDialog(template)}
                    className={btnClass("secondary", "flex-1 border-[#c7d2fe] text-[#4f46e5] hover:bg-[#eef2ff]")}>수정</button>
                  {/* 칸 배치 — PDF 양식에서만(워드 양식은 「수정 › 칸 설정」) */}
                  {isPdfTpl(template.fileUrl) && (
                    <Btn href={`/admin/contract-templates/${template.id}/layout`} className="flex-1" title={template.layout ? "입력칸·서명칸 자리를 고칩니다" : "아직 배치한 칸이 없습니다"}>
                      칸 배치{template.layout ? "" : " (아직 없음)"}
                    </Btn>
                  )}
                </div>
              </CardContent>
            </Card>
              )),
            ];
          })
        )}
      </div>

      {/* 버전 이력(#78) — 지금 파일 + 바뀌기 전 파일, 버전별 발송 건수 */}
      <Dialog open={!!history} onOpenChange={o => { if (!o) setHistory(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>버전 이력{history ? ` — ${history.name}` : ""}</DialogTitle></DialogHeader>
          {history && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between rounded border border-[#c7d2fe] bg-[#eef2ff] px-3 py-2">
                <span><b>v{history.current.version}</b> (지금) · 발송 {history.current.sent}건</span>
                <a href={history.current.fileUrl} download className="text-[#4f46e5] hover:underline text-xs">내려받기</a>
              </div>
              {history.past.length === 0 ? (
                <p className="text-xs text-gray-400">이전 파일 기록이 없습니다(이 기능 이후 파일을 바꾸면 남습니다).</p>
              ) : history.past.map(p => (
                <div key={p.id} className="flex items-center justify-between rounded border px-3 py-2">
                  <span>v{p.version} · 발송 {p.sent}건<span className="block text-[11px] text-gray-400">{format(new Date(p.replacedAt), "yyyy-MM-dd HH:mm")} 교체{p.replacedBy ? ` · ${p.replacedBy}` : ""}</span></span>
                  <a href={p.fileUrl} download className="text-[#4f46e5] hover:underline text-xs">내려받기</a>
                </div>
              ))}
              {(history.unrecorded || []).map(u => (
                <div key={`u${u.version}`} className="rounded border border-dashed px-3 py-2 text-gray-500">v{u.version} · 발송 {u.sent}건 <span className="text-[11px]">(파일 기록 없음 — 이력 기능 이전 버전)</span></div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 생성 모달 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>새 양식 만들기</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>양식 이름 *</Label>
              <Input
                placeholder="예: 2026 신입사원 근로계약서"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>설명</Label>
              <Textarea
                placeholder="양식 설명 (선택)"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="h-20"
              />
            </div>

            <div className="space-y-2">
              <Label>계약서 유형 *</Label>
              <Select value={form.type} onValueChange={type => setForm(f => ({ ...f, type }))}>
                <SelectTrigger>
                  <SelectValue>{typeLabel[form.type] ?? form.type}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(typeLabel).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>결재 순서 <span className="text-xs text-gray-400 font-normal">(이 양식으로 보낼 때의 서명·결재 차례)</span></Label>
              <ApprovalOrderEditor steps={form.approvalSteps} locked={form.approvalLocked} onChange={(approvalSteps, approvalLocked) => setForm(f => ({ ...f, approvalSteps, approvalLocked, approvalStepsRenewal: approvalSteps ? f.approvalStepsRenewal : null }))} />
              {form.approvalSteps && (
                <div className="rounded-md border border-dashed px-3 py-2">
                  <ApprovalOrderEditor renewal steps={form.approvalStepsRenewal} locked={form.approvalLocked} onChange={(approvalStepsRenewal) => setForm(f => ({ ...f, approvalStepsRenewal }))} />
                </div>
              )}
            </div>

            <div className="rounded-md bg-gray-50 border px-3 py-2 text-xs text-gray-600">
              서명 완료 후 근로자 접근(기본값): <b>{isDeliverableTpl(form.name, form.type) ? postSignAccessLabel.full : postSignAccessLabel.none}</b>
              {" "}— 근로자가 볼 수 있는 문서는 근로계약서·비밀유지서약서·개인정보수집이용동의서·금품청산 지급기일연장 동의서 4종이고 그 외는 「접근 불가」입니다.
              같은 이름의 이전 양식이 있으면 그 설정을 이어받습니다. 등록 뒤 「수정」에서 바꿀 수 있습니다.
            </div>

            <div className="space-y-2">
              <Label>파일 (PDF 또는 워드) *</Label>
              <div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-gray-50">
                <input
                  type="file"
                  accept=".pdf,.docx"
                  onChange={e => setForm(f => ({ ...f, file: e.target.files?.[0] || null }))}
                  className="hidden"
                  id="file-input-create"
                />
                <label htmlFor="file-input-create" className="cursor-pointer block">
                  {form.file ? (
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{form.file.name}</p>
                      <p className="text-xs text-gray-500">{(form.file.size / 1024 / 1024).toFixed(2)}MB</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload size={24} className="mx-auto text-gray-400" />
                      <p className="text-sm font-medium">PDF 또는 워드(.docx) 파일 선택</p>
                      <p className="text-xs text-gray-500">또는 여기에 드래그</p>
                    </div>
                  )}
                </label>
              </div>
            </div>

            {/* 워드 자동 입력 칸 안내 */}
            <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3 text-xs text-[#334155] space-y-1">
              <p className="font-semibold">워드(.docx) 양식은 칸 이름을 적어 두면 자동으로 채워집니다</p>
              <p>문서 안에 아래 칸 이름을 중괄호째 넣어 두면 계약서를 만들 때 자동으로 채워집니다:</p>
              <p className="font-mono text-[11px] leading-relaxed">
                {"{직원명} {이메일} {연락처} {지점} {직책} {직급}"}<br />
                {"{입사일} {제목} {계약시작일} {계약종료일} {연봉} {작성일}"}
              </p>
              <p className="pt-1 border-t border-[#e2e8f0]"><b>PDF 양식</b>은 만든 뒤 카드의 「칸 배치」에서 입력칸·서명칸을 문서 위에 끌어다 놓습니다.</p>
            </div>

            <div className="flex gap-2 justify-end">
              <Btn onClick={() => setCreateOpen(false)}>취소</Btn>
              <Btn kind="primary" onClick={handleCreate} disabled={uploading}>
                {uploading ? "올리는 중..." : "만들기"}
              </Btn>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 수정 모달 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>양식 수정</DialogTitle></DialogHeader>
          {editTarget && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>양식 이름 *</Label>
                <Input
                  placeholder="예: 2026 신입사원 근로계약서"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>설명</Label>
                <Textarea
                  placeholder="양식 설명 (선택)"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="h-20"
                />
              </div>

              <div className="space-y-2">
                <Label>계약서 유형 (읽기 전용)</Label>
                <Input value={typeLabel[editTarget.type] || editTarget.type} disabled />
              </div>

              <div className="space-y-2">
                <Label>서명 완료 후 근로자 접근</Label>
                <Select value={form.postSignAccess} onValueChange={postSignAccess => setForm(f => ({ ...f, postSignAccess }))}>
                  <SelectTrigger>
                    <SelectValue>{postSignAccessLabel[form.postSignAccess] ?? form.postSignAccess}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(postSignAccessLabel).map(([key, label]) => (
                      <SelectItem key={key} value={key} disabled={key === "none" && isEmploymentTpl(form.name, editTarget.type)}>{label}{key === "none" && isEmploymentTpl(form.name, editTarget.type) ? " — 근로계약서는 불가(교부 의무)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">
                  서명 완료 후 근로자(계약 당사자)에게 완료본을 어디까지 열어줄지 정합니다.
                  &quot;접근 불가&quot;는 근로자 화면에 &quot;제출 완료&quot;만 표시됩니다. 관리자는 항상 무제한입니다.
                  <br />규칙: 근로자가 볼 수 있는 문서는 <b>근로계약서·비밀유지서약서·개인정보수집이용동의서·금품청산 지급기일연장 동의서</b> 4종이며 그 외 양식은 「접근 불가」가 기본입니다. 근로계약서는 「접근 불가」로 둘 수 없습니다.
                </p>
              </div>

              {/* 보내기 용도(2026-10-17) — 「계약서 보내기」 화면에서 이 양식이 어느 용도 카드에 나오는지. 여러 개 가능, 하나도 안 고르면 「기타」 */}
              <div className="space-y-2">
                <Label>보내기 용도 <span className="text-xs text-gray-400 font-normal">(계약서 보내기 화면의 용도 카드 · 여러 개 가능)</span></Label>
                <div className="flex flex-wrap gap-2">
                  {purposeState !== "ok" && <p className="text-xs text-gray-500">{purposeState === "loading" ? "용도를 불러오는 중…" : "용도를 불러오지 못했습니다 — 이번 저장에서는 용도를 바꾸지 않습니다."}</p>}
                  {purposeState === "ok" && CONTRACT_PURPOSES.map(p => {
                    // 손대기 전 표시도 저장 뒤와 같게 — 직접 정한 값이 없으면 **바뀐 이름·종류** 기준 기본값(재검증 10/17)
                    const shown = editPurposes ?? purposesOf({ ...editTarget, name: form.name, type: form.type }, purposeMap);
                    const on = shown.includes(p.key);
                    return (
                      <label key={p.key} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm cursor-pointer ${on ? "border-[#4f46e5] bg-[#eef2ff] text-[#3730a3]" : "bg-white text-gray-600"}`}>
                        <input type="checkbox" checked={on} onChange={e => setEditPurposes(e.target.checked ? [...shown.filter(x => x !== p.key), p.key] : shown.filter(x => x !== p.key))} />
                        {p.label}
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500">
                  하나도 고르지 않으면 「기타」 카드에 나옵니다. 이름 기준 기본값: {(() => { const d = defaultPurposesOf({ name: form.name, type: form.type }); return d.length ? d.map(purposeLabel).join(" · ") : OTHER_PURPOSE.label; })()}
                  {purposeState === "ok" && <button type="button" className="ml-2 text-[#4f46e5] hover:underline" onClick={() => setEditPurposes(defaultPurposesOf({ name: form.name, type: form.type }))}>기본값으로</button>}
                </p>
              </div>

              <div className="space-y-2">
                <Label>라벨 <span className="text-gray-400 font-normal text-xs">(쉼표로 구분 · 예: 신규입사, 코디)</span></Label>
                <Input value={form.labels} onChange={e => setForm(f => ({ ...f, labels: e.target.value }))} placeholder="신규입사, 퇴사, 코디" />
              </div>
              <div className="space-y-2">
                <Label>결재 순서 <span className="text-xs text-gray-400 font-normal">(이 양식으로 보낼 때의 서명·결재 차례)</span></Label>
                <ApprovalOrderEditor steps={form.approvalSteps} locked={form.approvalLocked} onChange={(approvalSteps, approvalLocked) => setForm(f => ({ ...f, approvalSteps, approvalLocked, approvalStepsRenewal: approvalSteps ? f.approvalStepsRenewal : null }))} />
                {form.approvalSteps && (
                  <div className="rounded-md border border-dashed px-3 py-2">
                    <ApprovalOrderEditor renewal steps={form.approvalStepsRenewal} locked={form.approvalLocked} onChange={(approvalStepsRenewal) => setForm(f => ({ ...f, approvalStepsRenewal }))} />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>칸 설정 <span className="text-xs text-gray-400 font-normal">(칸마다 채우는 방식 · 자동 값 · 필수)</span></Label>
                {isPdfTpl(editTarget.fileUrl) ? (
                  <p className="text-xs text-gray-600">PDF 양식의 칸은 <a href={`/admin/contract-templates/${editTarget.id}/layout`} className="text-[#4f46e5] underline">칸 배치</a>에서 놓고, 담당·필수도 거기서 정합니다{editTarget.layout ? "" : " (아직 배치한 칸이 없습니다)"}.</p>
                ) : (
                  <FieldSettingsEditor templateId={editTarget.id} value={form.fieldSettings} onChange={(fieldSettings) => setForm(f => ({ ...f, fieldSettings }))} />
                )}
              </div>

              <div className="space-y-2">
                <Label>파일 교체 (선택사항)</Label>
                <p className="text-xs text-gray-500 mb-2">새 PDF 또는 워드(.docx) 파일을 선택하면 기존 파일이 교체됩니다 (버전 증가){editTarget.layout ? " — 칸 배치가 있는 양식이라 교체 뒤 「칸 배치」에서 칸 자리를 다시 확인해야 합니다" : ""}</p>
                <div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-gray-50">
                  <input
                    type="file"
                    accept=".pdf,.docx"
                    onChange={e => setForm(f => ({ ...f, file: e.target.files?.[0] || null }))}
                    className="hidden"
                    id="file-input-edit"
                  />
                  <label htmlFor="file-input-edit" className="cursor-pointer block">
                    {form.file ? (
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{form.file.name}</p>
                        <p className="text-xs text-gray-500">{(form.file.size / 1024 / 1024).toFixed(2)}MB</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload size={24} className="mx-auto text-gray-400" />
                        <p className="text-sm font-medium">새 PDF·워드 파일 선택</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Btn onClick={() => setEditOpen(false)}>취소</Btn>
                <Btn kind="primary" onClick={handleUpdate} disabled={uploading}>
                  {uploading ? "올리는 중..." : "저장"}
                </Btn>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
