"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Edit2, Trash2, Upload, Copy, History, Download, Pin, LayoutTemplate } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import ApprovalOrderEditor from "@/components/contracts/ApprovalOrderEditor";
import FieldSettingsEditor from "@/components/contracts/FieldSettingsEditor";
import { parseFieldSettings, type FieldSettings } from "@/lib/contract-field-settings";
import { parseApprovalSteps, stepsLabel, type ApprovalStepSpec } from "@/lib/approval-order";
import { TEMPLATE_CATEGORIES, templateCategoryOf, type TemplateCategory } from "@/lib/template-category";

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
    fieldSettings: {} as FieldSettings,   // 칸 설정(#22 1단계)
  });
  const emptyForm = () => ({ name: "", description: "", type: "EMPLOYMENT", postSignAccess: "full", file: null as File | null, labels: "", approvalSteps: null as ApprovalStepSpec[] | null, approvalLocked: true, fieldSettings: {} as FieldSettings });
  // 라벨 거르기·파일 이력(#78)
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<TemplateCategory | null>(null);   // 묶음으로 거르기(#214-5)
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

  // 템플릿 목록 조회
  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/contract-templates");
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (error) {
      console.error("템플릿 로드 실패:", error);
      toast.error("템플릿 로드 실패");
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
      toast.error("템플릿명을 입력해주세요");
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
      formData.append("approvalLocked", String(form.approvalLocked));

      const res = await fetch("/api/contract-templates", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "생성 실패");
      }

      toast.success("템플릿이 생성되었습니다");
      setForm(emptyForm());
      setCreateOpen(false);
      fetchTemplates();
    } catch (error) {
      console.error("템플릿 생성 실패:", error);
      toast.error(error instanceof Error ? error.message : "생성 실패");
    } finally {
      setUploading(false);
    }
  };

  // 템플릿 수정
  const handleUpdate = async () => {
    if (!editTarget) return;
    if (!form.name.trim()) {
      toast.error("템플릿명을 입력해주세요");
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

      toast.success("템플릿이 수정되었습니다");
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

      toast.success("템플릿이 삭제되었습니다");
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
      fieldSettings: parseFieldSettings(template.fieldSettings),
      file: null,
      labels: (template.labels || []).join(", "),
    });
    setEditOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-500">로드 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">계약서 템플릿</h1>
        <Button onClick={() => { setForm(emptyForm()); setCreateOpen(true); }} className="gap-2">
          <Plus size={16} />
          새 템플릿 만들기
        </Button>
      </div>

      {/* 편집기 입구 안내(10/14) — PDF 양식은 끌어다 놓는 편집기, 워드 양식은 {칸} 태그+칸 설정 */}
      <div className="rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2 text-xs text-violet-900 flex items-start gap-2">
        <LayoutTemplate size={14} className="mt-0.5 shrink-0" />
        <p>
          <b>PDF 양식</b>은 「새 템플릿 만들기」에서 PDF 를 올린 뒤, 카드의 <b>「칸 배치 편집기」</b>에서 입력칸·서명칸을 PDF 위에 끌어다 놓습니다(모두싸인 방식).
          <b> 워드(.docx) 양식</b>은 문서 안에 {"{직원명}"} 같은 {"{칸}"} 태그를 쓰고, 「수정 &gt; 칸 설정」에서 칸마다 채우는 방식·필수를 정합니다.
        </p>
      </div>

      {/* 묶음으로 거르기(#214-5) — 근로계약서 / 입사 서류 / 휴가·근태 신청서 / 퇴사 서류 / 기타(이름으로 자동 분류) */}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setCatFilter(null)}
          className={`px-2.5 py-1 rounded-full text-xs border ${!catFilter ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600"}`}>전체 묶음</button>
        {TEMPLATE_CATEGORIES.map(cat => {
          const n = templates.filter(t => templateCategoryOf(t.name) === cat).length;
          if (n === 0) return null;
          return (
            <button key={cat} type="button" onClick={() => setCatFilter(catFilter === cat ? null : cat)}
              className={`px-2.5 py-1 rounded-full text-xs border ${catFilter === cat ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600"}`}>{cat} {n}</button>
          );
        })}
      </div>

      {/* 라벨로 거르기(#78) */}
      {[...new Set(templates.flatMap(t => t.labels || []))].length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setLabelFilter(null)}
            className={`px-2.5 py-1 rounded-full text-xs border ${!activeLabel ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600"}`}>전체</button>
          {[...new Set(templates.flatMap(t => t.labels || []))].sort().map(l => (
            <button key={l} type="button" onClick={() => setLabelFilter(activeLabel === l ? null : l)}
              className={`px-2.5 py-1 rounded-full text-xs border ${activeLabel === l ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600"}`}>{l}</button>
          ))}
        </div>
      )}

      {/* 템플릿 목록 — 묶음별로 머리글을 두고 묶음 순서대로(#214-5). 묶음 안은 서버 순서(고정 → 최근 등록) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.length === 0 ? (
          <Card className="md:col-span-2">
            <CardContent className="pt-10">
              <p className="text-center text-gray-500">등록된 템플릿이 없습니다</p>
            </CardContent>
          </Card>
        ) : templates.every(t => (catFilter && templateCategoryOf(t.name) !== catFilter) || (activeLabel && !(t.labels || []).includes(activeLabel))) ? (
          <Card className="md:col-span-2">
            <CardContent className="pt-10">
              <p className="text-center text-gray-500">고른 묶음·라벨에 해당하는 템플릿이 없습니다. <button type="button" className="text-blue-600 hover:underline" onClick={() => { setCatFilter(null); setLabelFilter(null); }}>전체 보기</button></p>
            </CardContent>
          </Card>
        ) : (
          TEMPLATE_CATEGORIES.filter(cat => !catFilter || cat === catFilter).flatMap(cat => {
            const list = templates.filter(t => templateCategoryOf(t.name) === cat && (!activeLabel || (t.labels || []).includes(activeLabel)));
            if (list.length === 0) return [];
            return [
              <div key={`h-${cat}`} className="md:col-span-2 flex items-center gap-2 pt-2">
                <span className="text-sm font-semibold text-gray-700">{cat}</span>
                <span className="text-xs text-gray-400">{list.length}</span>
                <span className="flex-1 border-t" />
              </div>,
              ...list.map(template => (
            <Card key={template.id} className={`hover:shadow-md transition-shadow ${template.pinned ? "border-amber-300" : ""}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg flex items-center gap-1.5">
                      <button type="button" onClick={() => togglePin(template)} title={template.pinned ? "고정 풀기" : "맨 위에 고정"}
                        className={template.pinned ? "text-amber-500" : "text-gray-300 hover:text-amber-500"}><Pin size={15} /></button>
                      {template.name}
                    </CardTitle>
                    <p className="text-xs text-gray-500 mt-1">
                      {template.createdByUser.name} · {format(new Date(template.createdAt), "yyyy-MM-dd")}
                    </p>
                  </div>
                  <Badge variant="outline">{typeLabel[template.type] || template.type}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {template.description && (
                  <p className="text-sm text-gray-600">{template.description}</p>
                )}
                {(template.labels || []).length > 0 && (
                  <div className="flex flex-wrap gap-1">{(template.labels || []).map(l => <Badge key={l} variant="secondary" className="text-[11px]">{l}</Badge>)}</div>
                )}
                <p className="text-xs text-gray-500">
                  v{template.version} · 서명 완료 후 근로자 접근: {postSignAccessLabel[template.postSignAccess] || postSignAccessLabel.full}
                </p>
                <p className="text-xs text-gray-500">
                  결재 순서: {stepsLabel(parseApprovalSteps(template.approvalSteps))}{template.approvalSteps ? (template.approvalLocked === false ? " (발송 때 변경 가능)" : " (고정)") : " (기본값 — 수정에서 지정)"}
                </p>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <a href={template.fileUrl} download className="inline-flex items-center gap-1 text-blue-600 hover:underline"><Download size={12} />원본 내려받기</a>
                  <button type="button" onClick={() => openHistory(template)} className="inline-flex items-center gap-1 text-blue-600 hover:underline"><History size={12} />버전 이력</button>
                  <button type="button" onClick={() => copyTemplate(template)} className="inline-flex items-center gap-1 text-blue-600 hover:underline"><Copy size={12} />사본 만들기</button>
                  {/\.pdf$/i.test(template.fileUrl) ? (
                    <a href={`/admin/contract-templates/${template.id}/layout`} className="inline-flex items-center gap-1 text-violet-700 hover:underline" title="PDF 위에 입력칸·서명칸을 끌어다 놓습니다(#22)">
                      <LayoutTemplate size={12} />칸 배치 편집기{template.layout ? "" : " (아직 없음)"}
                    </a>
                  ) : (
                    // 워드 양식에도 자리를 보여 줘야 담당자가 편집기의 존재를 안다(10/14 디렉터 「어디에 있다는 거야?」)
                    <span className="inline-flex items-center gap-1 text-gray-400 cursor-help" title="끌어다 놓는 편집기는 PDF 양식에서 씁니다. 워드(.docx) 양식은 문서 안 {칸} 태그와 「수정 > 칸 설정」으로 정합니다.">
                      <LayoutTemplate size={12} />칸 배치 편집기 — PDF 양식에서
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1"
                    onClick={() => openEditDialog(template)}
                  >
                    <Edit2 size={14} />
                    수정
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => handleDelete(template.id)}
                  >
                    <Trash2 size={14} />
                    삭제
                  </Button>
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
              <div className="flex items-center justify-between rounded border border-blue-200 bg-blue-50 px-3 py-2">
                <span><b>v{history.current.version}</b> (지금) · 발송 {history.current.sent}건</span>
                <a href={history.current.fileUrl} download className="text-blue-600 hover:underline text-xs">내려받기</a>
              </div>
              {history.past.length === 0 ? (
                <p className="text-xs text-gray-400">이전 파일 기록이 없습니다(이 기능 이후 파일을 바꾸면 남습니다).</p>
              ) : history.past.map(p => (
                <div key={p.id} className="flex items-center justify-between rounded border px-3 py-2">
                  <span>v{p.version} · 발송 {p.sent}건<span className="block text-[11px] text-gray-400">{format(new Date(p.replacedAt), "yyyy-MM-dd HH:mm")} 교체{p.replacedBy ? ` · ${p.replacedBy}` : ""}</span></span>
                  <a href={p.fileUrl} download className="text-blue-600 hover:underline text-xs">내려받기</a>
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
          <DialogHeader><DialogTitle>새 템플릿 만들기</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>템플릿명 *</Label>
              <Input
                placeholder="예: 2026 신입사원 근로계약서"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>설명</Label>
              <Textarea
                placeholder="템플릿 설명 (선택사항)"
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
              <Label>결재 순서 <span className="text-xs text-gray-400 font-normal">(#213-2 — 이 양식으로 보낼 때의 서명·결재 차례)</span></Label>
              <ApprovalOrderEditor steps={form.approvalSteps} locked={form.approvalLocked} onChange={(approvalSteps, approvalLocked) => setForm(f => ({ ...f, approvalSteps, approvalLocked }))} />
            </div>

            <div className="rounded-md bg-gray-50 border px-3 py-2 text-xs text-gray-600">
              서명 완료 후 근로자 접근(기본값): <b>{isDeliverableTpl(form.name, form.type) ? postSignAccessLabel.full : postSignAccessLabel.none}</b>
              {" "}— 근로자가 볼 수 있는 문서는 근로계약서·비밀유지서약서·개인정보수집이용동의서·금품청산 지급기일연장 동의서 4종이고 그 외는 「접근 불가」입니다(#213-1).
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
                      <p className="text-sm font-medium">📄 {form.file.name}</p>
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

            {/* 워드 자동 입력 필드 안내 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">💡 워드(.docx) 템플릿은 자동 입력 필드를 지원합니다</p>
              <p>문서 안에 아래 필드를 넣어두면 계약서 작성 시 자동으로 채워집니다:</p>
              <p className="font-mono text-[11px] leading-relaxed">
                {"{직원명} {이메일} {연락처} {지점} {직책} {직급}"}<br />
                {"{입사일} {제목} {계약시작일} {계약종료일} {연봉} {작성일}"}
              </p>
              <p className="pt-1 border-t border-blue-200">📐 <b>PDF 템플릿</b>은 만든 뒤 목록의 「칸 배치 편집기」에서 입력칸·서명칸을 PDF 위에 끌어다 놓습니다(모두싸인 방식).</p>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>취소</Button>
              <Button onClick={handleCreate} disabled={uploading}>
                {uploading ? "업로드 중..." : "생성"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 수정 모달 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>템플릿 수정</DialogTitle></DialogHeader>
          {editTarget && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>템플릿명 *</Label>
                <Input
                  placeholder="예: 2026 신입사원 근로계약서"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>설명</Label>
                <Textarea
                  placeholder="템플릿 설명 (선택사항)"
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
                  <br />규칙(#213-1): 근로자가 볼 수 있는 문서는 <b>근로계약서·비밀유지서약서·개인정보수집이용동의서·금품청산 지급기일연장 동의서</b> 4종이며 그 외 양식은 「접근 불가」가 기본입니다. 근로계약서는 「접근 불가」로 둘 수 없습니다.
                </p>
              </div>

              <div className="space-y-2">
                <Label>라벨 <span className="text-gray-400 font-normal text-xs">(쉼표로 구분 · 예: 신규입사, 코디)</span></Label>
                <Input value={form.labels} onChange={e => setForm(f => ({ ...f, labels: e.target.value }))} placeholder="신규입사, 퇴사, 코디" />
              </div>
              <div className="space-y-2">
                <Label>결재 순서 <span className="text-xs text-gray-400 font-normal">(이 양식으로 보낼 때의 서명·결재 차례)</span></Label>
                <ApprovalOrderEditor steps={form.approvalSteps} locked={form.approvalLocked} onChange={(approvalSteps, approvalLocked) => setForm(f => ({ ...f, approvalSteps, approvalLocked }))} />
              </div>
              <div className="space-y-2">
                <Label>칸 설정 <span className="text-xs text-gray-400 font-normal">(칸마다 채우는 방식 · 자동 값 · 필수, #22)</span></Label>
                {/\.pdf$/i.test(editTarget.fileUrl) ? (
                  <p className="text-xs text-gray-600">PDF 양식의 칸은 <a href={`/admin/contract-templates/${editTarget.id}/layout`} className="text-violet-700 underline">칸 배치 편집기</a>에서 놓고, 담당·필수도 거기서 정합니다{editTarget.layout ? "" : " (아직 배치한 칸이 없습니다)"}.</p>
                ) : (
                  <FieldSettingsEditor templateId={editTarget.id} value={form.fieldSettings} onChange={(fieldSettings) => setForm(f => ({ ...f, fieldSettings }))} />
                )}
              </div>

              <div className="space-y-2">
                <Label>파일 교체 (선택사항)</Label>
                <p className="text-xs text-gray-500 mb-2">새 PDF 또는 워드(.docx) 파일을 선택하면 기존 파일이 교체됩니다 (버전 증가){editTarget.layout ? " — 칸 배치가 있는 양식이라 교체 뒤 편집기에서 칸 자리를 다시 확인해야 합니다" : ""}</p>
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
                        <p className="text-sm font-medium">📄 {form.file.name}</p>
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
                <Button variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
                <Button onClick={handleUpdate} disabled={uploading}>
                  {uploading ? "업로드 중..." : "저장"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
