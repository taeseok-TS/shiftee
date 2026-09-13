"use client";

// 큐브티워크 자료제출 (2026-09-13 디렉터 승인 기획 1단계)
//  직원·원장: 내야 할 것 / 내 제출 / 공유 자료 (원장은 + 우리 지점 · 요청 현황)
//  본부:      요청 관리 / 전체 제출 / 공유 자료 / 분류 관리
// 드롭다운은 기본 <select> 를 쓴다 — 이 화면은 값 고르기가 전부라 부품이 더 필요 없다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileUp, Plus, Bell, X, Paperclip, Eye, Trash2, Lock, Unlock, Share2, Check, Pencil, Loader2, FolderArchive } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  ALLOWED_EXT, CATEGORY_GROUP_LABEL, IMAGE_EXT, JOB_GROUPS, MAX_FILES, MAX_FILE_BYTES, PREVIEW_EXT, SHARE_ALL,
  currentYearMonthKST, extOf, type SubmissionFile,
} from "@/lib/submissions";

type Me = { id: string; name: string; role: "ADMIN" | "MANAGER" | "EMPLOYEE"; branch: string | null; jobGroup: string | null; position: string | null };
type Category = { id: string; group: "EDU" | "PROMO" | "EVENT"; name: string; sortOrder: number; active: boolean };
type Req = {
  id: string; title: string; description: string | null; categoryId: string; category?: { id: string; group: string; name: string };
  targetJobGroups: string[]; targetBranches: string[]; dueDate: string | null; createdByName: string; closedAt: string | null; createdAt: string;
  mySubmissionId?: string | null; mySubmittedAt?: string | null; targetCount?: number; submittedCount?: number;
};
type Sub = {
  id: string; requestId: string | null; request: { id: string; title: string; dueDate: string | null } | null;
  categoryId: string; category?: { id: string; group: string; name: string };
  userId: string; userName: string; userBranch: string | null; userJobGroup: string | null; userPosition: string | null;
  yearMonth: string; title: string; memo: string | null; files: SubmissionFile[]; status: "SUBMITTED" | "CHECKED";
  checkedAt: string | null; shared: boolean; shareJobGroups: string[]; sharedAt: string | null; createdAt: string;
};
type ReqDetail = {
  request: Req;
  summary: { targets: number; submitted: number; extra: number };
  branches: { branch: string; targets: number; submitted: number; missing: { id: string; name: string; jobGroup: string | null }[] }[];
  submissions: Sub[];
};

const todayStr = () => format(new Date(), "yyyy-MM-dd");
function dday(due: string | null): { label: string; tone: "due" | "late" | "none" } {
  if (!due) return { label: "마감 없음", tone: "none" };
  const t = todayStr();
  if (due < t) return { label: `${due} 마감 지남`, tone: "late" };
  const diff = Math.round((new Date(due + "T00:00:00").getTime() - new Date(t + "T00:00:00").getTime()) / 86400000);
  return { label: diff === 0 ? `오늘 마감` : `${due} 까지 · D-${diff}`, tone: "due" };
}
const chipTone: Record<string, string> = {
  due: "bg-amber-50 text-amber-700 border-amber-200", late: "bg-red-50 text-red-700 border-red-200", none: "bg-gray-100 text-gray-600 border-gray-200",
  done: "bg-green-50 text-green-700 border-green-200", shared: "bg-indigo-50 text-indigo-700 border-indigo-200", grey: "bg-gray-100 text-gray-600 border-gray-200",
};
function Chip({ tone, children }: { tone: keyof typeof chipTone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${chipTone[tone]}`}>{children}</span>;
}
function fmtBytes(n: number) { return n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`; }
const typeBadge: Record<string, string> = { word: "bg-[#2b579a]", excel: "bg-[#217346]", ppt: "bg-[#d24726]", pdf: "bg-red-700", hwp: "bg-sky-700", image: "bg-gray-500", zip: "bg-gray-700", file: "bg-gray-500" };
const typeLabel: Record<string, string> = { word: "W", excel: "X", ppt: "P", pdf: "PDF", hwp: "한", image: "IMG", zip: "ZIP", file: "F" };

// 첨부 열기 — 워드·PPT·엑셀·PDF 는 변환 뷰어, 이미지는 그대로, 나머지(한글·ZIP)는 내려받기
function openFile(f: SubmissionFile) {
  const ext = extOf(f.name);
  if (PREVIEW_EXT.has(ext)) window.open(`/docs/viewer?src=${encodeURIComponent(f.url)}&title=${encodeURIComponent(f.name.replace(/\.[^.]+$/, ""))}`, "_blank");
  else if (IMAGE_EXT.has(ext)) window.open(f.url, "_blank");
  else window.open(`${f.url}?download=1&name=${encodeURIComponent(f.name)}`, "_blank");
}
function FileLink({ f }: { f: SubmissionFile }) {
  return (
    <button type="button" onClick={() => openFile(f)} className="inline-flex items-center gap-1.5 text-xs text-gray-700 hover:text-indigo-700 hover:underline max-w-full">
      <span className={`text-[9px] font-bold text-white px-1 rounded ${typeBadge[f.type] || typeBadge.file}`}>{typeLabel[f.type] || "F"}</span>
      <span className="truncate">{f.name}</span>
      <span className="text-gray-400">{fmtBytes(f.size)}</span>
    </button>
  );
}

const selectCls = "h-9 rounded-md border border-gray-300 bg-white px-2 text-sm";
function yearMonthOptions() {
  const out: string[] = []; const now = new Date();
  for (let i = -12; i <= 1; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
  return out.reverse();
}
const groupLabel = (g: string) => (g === SHARE_ALL ? "전체" : g);

export default function SubmissionsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tabChoice, setTab] = useState<string>("");
  const [uploadFor, setUploadFor] = useState<{ open: boolean; request?: Req | null; editing?: Sub | null }>({ open: false });
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMe(d.user)).catch(() => {});
  }, []);
  const loadCategories = useCallback(() => {
    fetch("/api/work/submissions/categories").then((r) => r.json()).then((d) => setCategories(d.categories || [])).catch(() => {});
  }, []);
  useEffect(() => { loadCategories(); }, [loadCategories]);

  const tabs = useMemo(() => {
    if (!me) return [];
    if (me.role === "ADMIN") return [["requests", "요청 관리"], ["all", "전체 제출"], ["shared", "공유 자료"], ["categories", "분류 관리"]];
    if (me.role === "MANAGER") return [["todo", "내야 할 것"], ["mine", "내 제출"], ["shared", "공유 자료"], ["branch", "우리 지점"], ["requests", "요청 현황"]];
    return [["todo", "내야 할 것"], ["mine", "내 제출"], ["shared", "공유 자료"]];
  }, [me]);
  // 고른 탭이 없으면 첫 탭 — 효과 없이 파생값으로(역할이 오기 전엔 탭 목록이 비어 있다)
  const tab = tabChoice || tabs[0]?.[0] || "";

  if (!me) return <div className="p-8 text-sm text-gray-500">불러오는 중…</div>;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold flex items-center gap-2"><FileUp size={20} className="text-indigo-600" />자료제출</h1>
        <div className="ml-auto flex gap-2">
          {me.role !== "ADMIN" && (
            <Button onClick={() => setUploadFor({ open: true, request: null })} className="gap-1 bg-indigo-600 hover:bg-indigo-700"><Plus size={16} />자료 올리기</Button>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-500">교육 과제·본부 프로모션·이벤트 자료를 여기에 냅니다. 지점·직책·직급·연월은 자동으로 붙고, 본인 것은 본인만 봅니다(본부는 전부, 원장은 담당 지점).</p>

      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === k ? "border-indigo-600 text-indigo-700 font-medium" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "todo" && <TodoTab me={me} reloadKey={reloadKey} onSubmit={(r) => setUploadFor({ open: true, request: r })} />}
      {tab === "mine" && <SubmissionList me={me} scope="mine" categories={categories} reloadKey={reloadKey} onChanged={reload} onEdit={(s) => setUploadFor({ open: true, editing: s })} />}
      {tab === "shared" && <SubmissionList me={me} scope="shared" categories={categories} reloadKey={reloadKey} onChanged={reload} />}
      {tab === "branch" && <SubmissionList me={me} scope="branch" categories={categories} reloadKey={reloadKey} onChanged={reload} />}
      {tab === "all" && <SubmissionList me={me} scope="all" categories={categories} reloadKey={reloadKey} onChanged={reload} />}
      {tab === "requests" && <RequestsTab me={me} categories={categories} reloadKey={reloadKey} onChanged={reload} />}
      {tab === "categories" && <CategoryManager categories={categories} onChanged={loadCategories} />}

      {uploadFor.open && (
        <UploadDialog me={me} categories={categories} request={uploadFor.request ?? null} editing={uploadFor.editing ?? null}
          onClose={() => setUploadFor({ open: false })} onDone={() => { setUploadFor({ open: false }); reload(); }} />
      )}
    </div>
  );
}

// ─── 내야 할 것 ─────────────────────────────────────────────
function TodoTab({ me, reloadKey, onSubmit }: { me: Me; reloadKey: number; onSubmit: (r: Req) => void }) {
  const [rows, setRows] = useState<Req[] | null>(null);
  useEffect(() => {
    fetch("/api/work/submissions/requests?status=open").then((r) => r.json()).then((d) => setRows(d.requests || [])).catch(() => setRows([]));
  }, [reloadKey]);
  if (!rows) return <p className="text-sm text-gray-500 py-6">불러오는 중…</p>;
  if (!rows.length) return <p className="text-sm text-gray-500 py-10 text-center">지금 내야 할 자료가 없습니다.</p>;
  const pending = rows.filter((r) => !r.mySubmissionId);
  const done = rows.filter((r) => r.mySubmissionId);
  const Card = ({ r }: { r: Req }) => {
    const d = dday(r.dueDate);
    return (
      <div className="bg-white border rounded-lg p-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{r.title}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {r.category ? `${CATEGORY_GROUP_LABEL[r.category.group as keyof typeof CATEGORY_GROUP_LABEL] ?? r.category.group} › ${r.category.name}` : ""} · 대상 {r.targetJobGroups.length ? r.targetJobGroups.join("·") : "전 직군"}{r.targetBranches.length ? ` (${r.targetBranches.join("·")})` : ""} · 본부 {r.createdByName}
          </p>
          {r.description && <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">{r.description}</p>}
        </div>
        <div className="text-right space-y-1.5 shrink-0">
          {r.mySubmissionId ? <Chip tone="done">제출 완료{r.mySubmittedAt ? ` · ${format(new Date(r.mySubmittedAt), "M/d HH:mm")}` : ""}</Chip> : <Chip tone={d.tone}>{d.label}</Chip>}
          {!r.mySubmissionId && <div><Button size="sm" onClick={() => onSubmit(r)} className="bg-indigo-600 hover:bg-indigo-700">제출</Button></div>}
        </div>
      </div>
    );
  };
  return (
    <div className="space-y-2">
      {pending.map((r) => <Card key={r.id} r={r} />)}
      {done.length > 0 && <p className="text-xs text-gray-400 pt-2">제출한 요청</p>}
      {done.map((r) => <Card key={r.id} r={r} />)}
      <p className="text-[11px] text-gray-400">{me.role === "MANAGER" ? "지점 직원의 제출 현황은 '우리 지점'·'요청 현황' 탭에서 봅니다." : "본부가 요청을 걸면 여기와 큐브티 봇 DM 으로 알려드립니다."}</p>
    </div>
  );
}

// ─── 제출물 목록 (내 제출 / 공유 자료 / 우리 지점 / 전체 제출) ───────────
function SubmissionList({ me, scope, categories, reloadKey, onChanged, onEdit }: {
  me: Me; scope: "mine" | "shared" | "branch" | "all"; categories: Category[]; reloadKey: number; onChanged: () => void; onEdit?: (s: Sub) => void;
}) {
  // 조회 조건이 바뀌면 그 조건으로 받은 결과가 올 때까지 "불러오는 중" — 효과 안에서 동기 setState 없이 도장(stamp)으로 판정
  const [f, setF] = useState({ categoryId: "", yearMonth: "", branch: "", jobGroup: "", q: "" });
  const stamp = `${scope}|${JSON.stringify(f)}|${reloadKey}`;
  const [data, setData] = useState<{ stamp: string; rows: Sub[] } | null>(null);
  const rows = data && data.stamp === stamp ? data.rows : null;
  const [branches, setBranches] = useState<string[]>([]);
  const showFilters = scope !== "mine";
  useEffect(() => {
    if (scope === "all" || scope === "branch") {
      fetch("/api/branches").then((r) => (r.ok ? r.json() : { branches: [] })).then((d) => setBranches((d.branches || []).map((b: { name: string }) => b.name))).catch(() => {});
    }
  }, [scope]);
  useEffect(() => {
    const qs = new URLSearchParams({ scope });
    Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const my = stamp;
    fetch(`/api/work/submissions?${qs}`).then((r) => r.json()).then((d) => setData({ stamp: my, rows: d.submissions || [] })).catch(() => setData({ stamp: my, rows: [] }));
  }, [scope, f, reloadKey, stamp]);

  return (
    <div className="space-y-3">
      {showFilters && (
        <div className="flex flex-wrap gap-2 items-center">
          <select className={selectCls} value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
            <option value="">모든 분류</option>
            {categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{CATEGORY_GROUP_LABEL[c.group]} › {c.name}</option>)}
          </select>
          <select className={selectCls} value={f.yearMonth} onChange={(e) => setF({ ...f, yearMonth: e.target.value })}>
            <option value="">모든 연월</option>
            {yearMonthOptions().map((ym) => <option key={ym} value={ym}>{ym.replace("-", "년 ")}월</option>)}
          </select>
          {(scope === "all" || (scope === "branch" && branches.length > 1)) && (
            <select className={selectCls} value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}>
              <option value="">모든 지점</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <select className={selectCls} value={f.jobGroup} onChange={(e) => setF({ ...f, jobGroup: e.target.value })}>
            <option value="">모든 직책</option>
            {JOB_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <Input placeholder="제목·이름 검색" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="h-9 w-44" />
          {rows && <span className="text-xs text-gray-500 ml-auto">{rows.length}건</span>}
        </div>
      )}
      {!rows ? <p className="text-sm text-gray-500 py-6">불러오는 중…</p>
        : !rows.length ? <p className="text-sm text-gray-500 py-10 text-center">{scope === "mine" ? "아직 올린 자료가 없습니다." : scope === "shared" ? "공유된 자료가 없습니다." : "제출된 자료가 없습니다."}</p>
        : rows.map((s) => <SubmissionCard key={s.id} s={s} me={me} onChanged={onChanged} onEdit={onEdit} />)}
    </div>
  );
}

function SubmissionCard({ s, me, onChanged, onEdit, compact }: { s: Sub; me: Me; onChanged: () => void; onEdit?: (s: Sub) => void; compact?: boolean }) {
  const [share, setShare] = useState(false);
  const isOwner = s.userId === me.id;
  const isAdmin = me.role === "ADMIN";
  const due = s.request?.dueDate ?? null;
  const canDelete = isAdmin || (isOwner && s.status !== "CHECKED" && (!due || due >= todayStr()));
  const canEdit = isOwner && s.status !== "CHECKED" && !!onEdit;
  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/work/submissions/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "실패했습니다."); return false; }
    onChanged(); return true;
  }
  async function remove() {
    if (!confirm(`「${s.title}」 제출물을 지울까요?`)) return;
    const res = await fetch(`/api/work/submissions/${s.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "지우지 못했습니다."); return; }
    toast.success("지웠습니다."); onChanged();
  }
  return (
    <div className={`bg-white border rounded-lg ${compact ? "p-2.5" : "p-3"} space-y-2`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{s.title}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {!isOwner && <span className="text-gray-700">{[s.userBranch, s.userJobGroup, s.userPosition].filter(Boolean).join(" · ")} <b>{s.userName}</b> · </span>}
            {s.category ? `${CATEGORY_GROUP_LABEL[s.category.group as keyof typeof CATEGORY_GROUP_LABEL] ?? ""} › ${s.category.name}` : ""} · {s.yearMonth.replace("-", "년 ")}월 · {format(new Date(s.createdAt), "M/d HH:mm")} 제출
            {s.request && <> · 요청 「{s.request.title}」</>}
          </p>
          {s.memo && <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">{s.memo}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">{s.files.map((f) => <FileLink key={f.url} f={f} />)}</div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <div className="flex gap-1 flex-wrap justify-end">
            {s.status === "CHECKED" ? <Chip tone="done"><Check size={11} className="inline mr-0.5" />본부 확인</Chip> : <Chip tone="grey">제출됨</Chip>}
            {s.shared && <Chip tone="shared"><Share2 size={11} className="inline mr-0.5" />{s.shareJobGroups.map(groupLabel).join("·")} 공유</Chip>}
          </div>
          <div className="flex gap-1">
            {isAdmin && (
              <>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => patch({ status: s.status === "CHECKED" ? "SUBMITTED" : "CHECKED" })}>
                  {s.status === "CHECKED" ? <><Unlock size={12} />확인 취소</> : <><Check size={12} />확인</>}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShare(true)}><Share2 size={12} />공유</Button>
              </>
            )}
            {canEdit && <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onEdit?.(s)}><Pencil size={12} />수정</Button>}
            {canDelete && <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600" onClick={remove}><Trash2 size={12} /></Button>}
          </div>
        </div>
      </div>
      {share && <ShareDialog s={s} onClose={() => setShare(false)} onSave={async (b) => { const ok = await patch(b); if (ok) { toast.success(b.shared ? "공유했습니다. 대상 직군에게 알렸습니다." : "공유를 껐습니다."); setShare(false); } }} />}
    </div>
  );
}

function ShareDialog({ s, onClose, onSave }: { s: Sub; onClose: () => void; onSave: (b: { shared: boolean; shareJobGroups: string[] }) => Promise<void> }) {
  const [on, setOn] = useState(s.shared);
  const [groups, setGroups] = useState<string[]>(s.shareJobGroups.length ? s.shareJobGroups : []);
  const [saving, setSaving] = useState(false);
  const toggle = (g: string) => setGroups((cur) => g === SHARE_ALL ? (cur.includes(SHARE_ALL) ? [] : [SHARE_ALL]) : (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur.filter((x) => x !== SHARE_ALL), g]));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader><DialogTitle>공유 설정 — {s.userName}({s.userBranch ?? "-"}) 「{s.title}」</DialogTitle></DialogHeader>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> 공유 켜기</label>
        <div className={`flex flex-wrap gap-2 ${on ? "" : "opacity-40 pointer-events-none"}`}>
          {[SHARE_ALL, ...JOB_GROUPS].map((g) => (
            <button key={g} type="button" onClick={() => toggle(g)}
              className={`px-3 py-1 rounded-md border text-sm ${groups.includes(g) ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-300 bg-white text-gray-700"}`}>
              {groups.includes(g) ? "✓ " : ""}{groupLabel(g)}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">켜면 대상 직군에게 봇 DM 으로 알리고 그분들의 「공유 자료」 탭에 나타납니다. 끄면 즉시 사라집니다. 본부는 언제나 전부 봅니다.</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button disabled={saving || (on && !groups.length)} className="bg-indigo-600 hover:bg-indigo-700" onClick={async () => { setSaving(true); try { await onSave({ shared: on, shareJobGroups: on ? groups : [] }); } finally { setSaving(false); } }}>저장</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── 올리기 창 (새 제출 / 내 제출 수정) ─────────────────────────
function UploadDialog({ me, categories, request, editing, onClose, onDone }: {
  me: Me; categories: Category[]; request: Req | null; editing: Sub | null; onClose: () => void; onDone: () => void;
}) {
  const [files, setFiles] = useState<SubmissionFile[]>(editing?.files ?? []);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? request?.categoryId ?? "");
  const [yearMonth, setYearMonth] = useState(editing?.yearMonth ?? currentYearMonthKST());
  const [memo, setMemo] = useState(editing?.memo ?? "");
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lockCategory = !!request || !!editing;

  async function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    if (files.length + arr.length > MAX_FILES) { toast.error(`파일은 제출당 ${MAX_FILES}개까지입니다.`); return; }
    for (const file of arr) {
      const ext = extOf(file.name);
      if (!ALLOWED_EXT.has(ext)) { toast.error(`${file.name}: 워드·엑셀·PPT·PDF·한글·이미지·ZIP 만 올릴 수 있습니다.`); continue; }
      if (file.size > MAX_FILE_BYTES) { toast.error(`${file.name}: 파일당 50MB 이하만 올릴 수 있습니다.`); continue; }
      setUploading((n) => n + 1);
      try {
        const fd = new FormData(); fd.append("file", file);
        const res = await fetch("/api/work/submissions/upload", { method: "POST", body: fd });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { toast.error(`${file.name}: ${d.error || "업로드 실패"}`); continue; }
        setFiles((cur) => [...cur, d as SubmissionFile]);
        setTitle((t) => t || file.name.replace(/\.[^.]+$/, ""));
      } finally { setUploading((n) => n - 1); }
    }
  }
  async function submit() {
    if (!files.length) { toast.error("파일을 올려주세요."); return; }
    if (!editing && !request && !categoryId) { toast.error("어디에 올리는 자료인지 골라주세요."); return; }
    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/work/submissions/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, memo, files }) })
        : await fetch("/api/work/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: request?.id ?? null, categoryId, title, memo, files, yearMonth }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "제출하지 못했습니다."); return; }
      toast.success(editing ? "고쳤습니다." : "제출했습니다.");
      onDone();
    } finally { setSaving(false); }
  }
  const auto = (v: string | null | undefined) => <div className="h-9 rounded-md border bg-gray-100 px-3 text-sm flex items-center justify-between text-gray-700"><span>{v || "-"}</span><span className="text-[10px] text-gray-400">자동</span></div>;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? "내 제출 수정" : request ? `제출 — ${request.title}` : "자료 올리기"}</DialogTitle></DialogHeader>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-5 text-center text-sm cursor-pointer ${drag ? "border-indigo-400 bg-indigo-50" : "border-gray-300 text-gray-500 hover:bg-gray-50"}`}>
          <Paperclip size={18} className="inline mr-1" />파일을 여기에 끌어다 놓거나 클릭해서 고르기
          <p className="text-[11px] text-gray-400 mt-1">워드 · 엑셀 · PPT · PDF · 한글 · 이미지 · ZIP — 파일당 50MB, {MAX_FILES}개까지</p>
          <input ref={inputRef} type="file" multiple hidden accept={[...ALLOWED_EXT].join(",")} onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {(files.length > 0 || uploading > 0) && (
          <div className="space-y-1">
            {files.map((f) => (
              <div key={f.url} className="flex items-center gap-2 text-sm border rounded px-2 py-1">
                <span className={`text-[9px] font-bold text-white px-1 rounded ${typeBadge[f.type] || typeBadge.file}`}>{typeLabel[f.type] || "F"}</span>
                <span className="truncate flex-1">{f.name}</span><span className="text-xs text-gray-400">{fmtBytes(f.size)}</span>
                <button type="button" onClick={() => setFiles((cur) => cur.filter((x) => x.url !== f.url))} className="text-gray-400 hover:text-red-600"><X size={14} /></button>
              </div>
            ))}
            {uploading > 0 && <p className="text-xs text-indigo-600 flex items-center gap-1"><Loader2 size={12} className="animate-spin" />올리는 중 ({uploading})</p>}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><label className="text-xs text-gray-500">제목</label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="파일 이름으로 자동으로 채워집니다" /></div>
          <div><label className="text-xs text-gray-500">어디에</label>
            <select className={`${selectCls} w-full ${lockCategory ? "bg-gray-100 text-gray-600" : ""}`} value={categoryId} disabled={lockCategory} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">선택</option>
              {(["EDU", "PROMO", "EVENT"] as const).map((g) => (
                <optgroup key={g} label={CATEGORY_GROUP_LABEL[g]}>
                  {categories.filter((c) => c.group === g && (c.active || c.id === categoryId)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </select></div>
          <div><label className="text-xs text-gray-500">제출 요청</label>{auto(request ? `${request.title}${request.dueDate ? ` (${request.dueDate}까지)` : ""}` : editing?.request?.title ?? "자유 제출")}</div>
          <div><label className="text-xs text-gray-500">지점</label>{auto(editing?.userBranch ?? me.branch)}</div>
          <div><label className="text-xs text-gray-500">직책 · 직급</label>{auto([editing?.userJobGroup ?? me.jobGroup, editing?.userPosition ?? me.position].filter(Boolean).join(" · "))}</div>
          <div><label className="text-xs text-gray-500">연월</label>
            {editing ? auto(editing.yearMonth) : (
              <select className={`${selectCls} w-full`} value={yearMonth} onChange={(e) => setYearMonth(e.target.value)}>
                {yearMonthOptions().map((ym) => <option key={ym} value={ym}>{ym.replace("-", "년 ")}월</option>)}
              </select>
            )}
          </div>
          <div className="md:col-span-2"><label className="text-xs text-gray-500">메모 (선택)</label><Textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="본부에 전할 말" /></div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button disabled={saving || uploading > 0 || !files.length} onClick={submit} className="bg-indigo-600 hover:bg-indigo-700">{saving ? "저장 중…" : editing ? "저장" : "제출"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── 요청 관리(본부) / 요청 현황(원장) ─────────────────────────
function RequestsTab({ me, categories, reloadKey, onChanged }: { me: Me; categories: Category[]; reloadKey: number; onChanged: () => void }) {
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const stamp = `${status}|${reloadKey}`;
  const [data, setData] = useState<{ stamp: string; rows: Req[] } | null>(null);
  const rows = data && data.stamp === stamp ? data.rows : null;
  const [edit, setEdit] = useState<{ open: boolean; req?: Req | null }>({ open: false });
  const [detailId, setDetailId] = useState<string | null>(null);
  const isAdmin = me.role === "ADMIN";
  useEffect(() => {
    const my = stamp;
    fetch(`/api/work/submissions/requests?scope=manage&status=${status}`).then((r) => r.json()).then((d) => setData({ stamp: my, rows: d.requests || [] })).catch(() => setData({ stamp: my, rows: [] }));
  }, [status, reloadKey, stamp]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="open">진행 중</option><option value="closed">닫힌 요청</option><option value="all">전부</option>
        </select>
        {isAdmin && <Button className="ml-auto gap-1 bg-indigo-600 hover:bg-indigo-700" onClick={() => setEdit({ open: true, req: null })}><Plus size={16} />제출 요청 걸기</Button>}
      </div>
      {!rows ? <p className="text-sm text-gray-500 py-6">불러오는 중…</p>
        : !rows.length ? <p className="text-sm text-gray-500 py-10 text-center">{isAdmin ? "제출 요청을 걸면 대상 직원에게 봇 DM 이 가고, 여기에 현황이 쌓입니다." : "담당 지점에 걸린 요청이 없습니다."}</p>
        : rows.map((r) => {
          const d = dday(r.dueDate); const pct = r.targetCount ? Math.round(((r.submittedCount ?? 0) / r.targetCount) * 100) : 0;
          return (
            <button key={r.id} type="button" onClick={() => setDetailId(r.id)} className="w-full text-left bg-white border rounded-lg p-3 hover:border-indigo-300">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{r.title} {r.closedAt && <Chip tone="grey">닫힘</Chip>}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{r.category?.name} · 대상 {r.targetJobGroups.length ? r.targetJobGroups.join("·") : "전 직군"}{r.targetBranches.length ? ` (${r.targetBranches.join("·")})` : ""} · {r.createdByName} · {format(new Date(r.createdAt), "M/d")}</p>
                  <div className="mt-2 h-1.5 bg-gray-100 rounded overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} /></div>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <Chip tone={r.closedAt ? "grey" : d.tone}>{d.label}</Chip>
                  <p className="text-sm tabular-nums"><b>{r.submittedCount ?? 0}</b> / {r.targetCount ?? 0} 제출</p>
                </div>
              </div>
            </button>
          );
        })}
      {edit.open && <RequestDialog categories={categories} req={edit.req ?? null} onClose={() => setEdit({ open: false })} onDone={() => { setEdit({ open: false }); onChanged(); }} />}
      {detailId && <RequestDetail id={detailId} me={me} onClose={() => setDetailId(null)} onChanged={onChanged} onEdit={(r) => { setDetailId(null); setEdit({ open: true, req: r }); }} />}
    </div>
  );
}

function RequestDialog({ categories, req, onClose, onDone }: { categories: Category[]; req: Req | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ title: req?.title ?? "", description: req?.description ?? "", categoryId: req?.categoryId ?? "", dueDate: req?.dueDate ?? "", targetJobGroups: req?.targetJobGroups ?? [] as string[], targetBranches: req?.targetBranches ?? [] as string[] });
  const [branches, setBranches] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { fetch("/api/branches").then((r) => r.json()).then((d) => setBranches((d.branches || []).map((b: { name: string }) => b.name))).catch(() => {}); }, []);
  const toggle = (key: "targetJobGroups" | "targetBranches", v: string) => setForm((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }));
  async function save() {
    if (!form.title.trim()) { toast.error("제목을 입력해주세요."); return; }
    if (!form.categoryId) { toast.error("분류를 골라주세요."); return; }
    setSaving(true);
    try {
      const res = await fetch(req ? `/api/work/submissions/requests/${req.id}` : "/api/work/submissions/requests", {
        method: req ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, dueDate: form.dueDate || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "저장하지 못했습니다."); return; }
      toast.success(req ? "고쳤습니다." : "요청을 걸었습니다. 대상 직원에게 알렸습니다.");
      onDone();
    } finally { setSaving(false); }
  }
  const pill = (on: boolean) => `px-2.5 py-1 rounded-md border text-xs ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-300 bg-white text-gray-700"}`;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{req ? "요청 수정" : "제출 요청 걸기"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><label className="text-xs text-gray-500">제목</label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 9월 HOW교육 과제 — 교실 운영 개선안" /></div>
          <div><label className="text-xs text-gray-500">분류</label>
            <select className={`${selectCls} w-full`} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">선택</option>
              {(["EDU", "PROMO", "EVENT"] as const).map((g) => <optgroup key={g} label={CATEGORY_GROUP_LABEL[g]}>{categories.filter((c) => c.group === g && c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
            </select></div>
          <div><label className="text-xs text-gray-500">마감일 (비우면 마감 없음)</label><Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="text-xs text-gray-500">대상 직군 — 아무것도 안 고르면 전 직군(본부 제외)</label>
            <div className="flex flex-wrap gap-1.5 mt-1">{JOB_GROUPS.map((g) => <button key={g} type="button" className={pill(form.targetJobGroups.includes(g))} onClick={() => toggle("targetJobGroups", g)}>{g}</button>)}</div></div>
          <div className="md:col-span-2"><label className="text-xs text-gray-500">대상 지점 — 아무것도 안 고르면 전 지점</label>
            <div className="flex flex-wrap gap-1.5 mt-1">{branches.map((b) => <button key={b} type="button" className={pill(form.targetBranches.includes(b))} onClick={() => toggle("targetBranches", b)}>{b}</button>)}</div></div>
          <div className="md:col-span-2"><label className="text-xs text-gray-500">안내문 (선택 — 봇 DM 에 함께 나갑니다)</label><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button disabled={saving} onClick={save} className="bg-indigo-600 hover:bg-indigo-700">{saving ? "저장 중…" : req ? "저장" : "요청 걸기"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RequestDetail({ id, me, onClose, onChanged, onEdit }: { id: string; me: Me; onClose: () => void; onChanged: () => void; onEdit: (r: Req) => void }) {
  const [d, setD] = useState<ReqDetail | null>(null);
  const [key, setKey] = useState(0);
  const isAdmin = me.role === "ADMIN";
  useEffect(() => { fetch(`/api/work/submissions/requests/${id}`).then((r) => r.json()).then((x) => setD(x.request ? x : null)).catch(() => setD(null)); }, [id, key]);
  const refresh = () => { setKey((k) => k + 1); onChanged(); };
  const [zipping, setZipping] = useState(false);
  // <a href> 로 열면 413·404 응답이 JSON 원문 페이지로 넘어가 화면을 잃는다 → fetch 로 받아 저장
  async function downloadZip() {
    setZipping(true);
    try {
      const res = await fetch(`/api/work/submissions/requests/${id}/zip`);
      if (!res.ok) { const x = await res.json().catch(() => ({})); toast.error(x.error || "ZIP 을 만들지 못했습니다."); return; }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = m ? decodeURIComponent(m[1]) : "submissions.zip";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch { toast.error("ZIP 을 내려받지 못했습니다. 연결을 확인하고 다시 시도해주세요."); }
    finally { setZipping(false); }
  }
  async function remind() {
    if (!confirm("아직 내지 않은 사람들에게만 봇 DM 으로 독촉합니다. 보낼까요?")) return;
    const res = await fetch(`/api/work/submissions/requests/${id}/remind`, { method: "POST" });
    const x = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(x.error || "실패했습니다."); return; }
    toast.success(`${x.sent}명에게 독촉을 보냈습니다.`);
  }
  async function toggleClose() {
    if (!d) return;
    const closed = !d.request.closedAt;
    const res = await fetch(`/api/work/submissions/requests/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ closed }) });
    const x = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(x.error || "실패했습니다."); return; }
    toast.success(closed ? "요청을 닫았습니다. 더 받지 않습니다." : "요청을 다시 열었습니다."); refresh();
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        {!d ? <p className="text-sm text-gray-500">불러오는 중…</p> : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">{d.request.title} {d.request.closedAt ? <Chip tone="grey">닫힘</Chip> : <Chip tone={dday(d.request.dueDate).tone}>{dday(d.request.dueDate).label}</Chip>}</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-gray-500">{d.request.category?.name} · 대상 {d.request.targetJobGroups.length ? d.request.targetJobGroups.join("·") : "전 직군"}{d.request.targetBranches.length ? ` (${d.request.targetBranches.join("·")})` : ""} · {d.request.createdByName}</p>
            {d.request.description && <p className="text-sm whitespace-pre-wrap bg-gray-50 rounded p-2">{d.request.description}</p>}
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <span>제출 <b className="tabular-nums">{d.summary.submitted} / {d.summary.targets}</b></span>
              <span>완료 지점 <b className="tabular-nums">{d.branches.filter((b) => b.missing.length === 0 && b.targets > 0).length} / {d.branches.length}</b></span>
              {d.summary.extra > 0 && <span className="text-gray-500">대상 밖 제출 {d.summary.extra}</span>}
              <div className="ml-auto flex gap-1.5 flex-wrap">
                {d.submissions.length > 0 && <Button size="sm" variant="outline" className="gap-1 h-8" disabled={zipping} onClick={downloadZip}><FolderArchive size={14} />{zipping ? "묶는 중…" : "ZIP 내려받기"}</Button>}
                {isAdmin && !d.request.closedAt && <Button size="sm" variant="outline" className="gap-1 h-8" onClick={remind}><Bell size={14} />미제출자 독촉</Button>}
                {isAdmin && <Button size="sm" variant="outline" className="gap-1 h-8" onClick={() => onEdit(d.request)}><Pencil size={14} />수정</Button>}
                {isAdmin && <Button size="sm" variant="outline" className="gap-1 h-8" onClick={toggleClose}>{d.request.closedAt ? <><Unlock size={14} />다시 열기</> : <><Lock size={14} />닫기</>}</Button>}
              </div>
            </div>
            <div className="border rounded overflow-x-auto">
              <table className="w-full text-xs min-w-[520px]">
                <thead className="bg-gray-50 text-gray-600"><tr><th className="text-left p-2">지점</th><th className="text-left p-2">제출 / 대상</th><th className="text-left p-2">미제출</th></tr></thead>
                <tbody>
                  {d.branches.map((b) => (
                    <tr key={b.branch} className="border-t">
                      <td className="p-2 font-medium">{b.branch}</td>
                      <td className={`p-2 tabular-nums ${b.missing.length === 0 ? "text-green-700 font-semibold" : ""}`}>{b.submitted} / {b.targets}</td>
                      <td className="p-2 text-red-700">{b.missing.length === 0 ? <span className="text-gray-400">—</span> : b.missing.length === b.targets ? `전원 (${b.missing.map((m) => m.name).join(", ")})` : b.missing.map((m) => m.name).join(", ")}</td>
                    </tr>
                  ))}
                  {!d.branches.length && <tr><td className="p-3 text-gray-400" colSpan={3}>대상자가 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 pt-1">제출물 {d.submissions.length}건</p>
            <div className="space-y-2">{d.submissions.map((s) => <SubmissionCard key={s.id} s={s} me={me} onChanged={refresh} compact />)}</div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── 분류 관리(본부) ────────────────────────────────────────
function CategoryManager({ categories, onChanged }: { categories: Category[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState<"EDU" | "PROMO" | "EVENT">("EDU");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  async function call(url: string, method: string, body: unknown) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "실패했습니다."); return false; }
    onChanged(); return true;
  }
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex gap-2 items-end flex-wrap">
        <div><label className="text-xs text-gray-500">구분</label><select className={`${selectCls} block`} value={group} onChange={(e) => setGroup(e.target.value as typeof group)}>{(["EDU", "PROMO", "EVENT"] as const).map((g) => <option key={g} value={g}>{CATEGORY_GROUP_LABEL[g]}</option>)}</select></div>
        <div className="flex-1 min-w-[160px]"><label className="text-xs text-gray-500">새 분류 이름</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 신규 원장 교육" /></div>
        <Button className="gap-1 bg-indigo-600 hover:bg-indigo-700" disabled={!name.trim()} onClick={async () => { if (await call("/api/work/submissions/categories", "POST", { group, name })) { setName(""); toast.success("추가했습니다."); } }}><Plus size={16} />추가</Button>
      </div>
      {(["EDU", "PROMO", "EVENT"] as const).map((g) => (
        <div key={g} className="bg-white border rounded-lg">
          <p className="px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-50 border-b">{CATEGORY_GROUP_LABEL[g]}</p>
          {categories.filter((c) => c.group === g).map((c) => (
            <div key={c.id} className={`flex items-center gap-2 px-3 py-2 border-b last:border-b-0 text-sm ${c.active ? "" : "opacity-50"}`}>
              {editing?.id === c.id ? (
                <>
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-8 flex-1" autoFocus />
                  <Button size="sm" className="h-8" onClick={async () => { if (await call(`/api/work/submissions/categories/${c.id}`, "PATCH", { name: editing.name })) setEditing(null); }}>저장</Button>
                  <Button size="sm" variant="outline" className="h-8" onClick={() => setEditing(null)}>취소</Button>
                </>
              ) : (
                <>
                  <span className="flex-1">{c.name}{!c.active && <span className="text-xs text-gray-400 ml-2">숨김</span>}</span>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setEditing({ id: c.id, name: c.name })}><Pencil size={12} />이름</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => call(`/api/work/submissions/categories/${c.id}`, "PATCH", { active: !c.active })}>{c.active ? <><Eye size={12} />숨기기</> : <><Eye size={12} />표시</>}</Button>
                </>
              )}
            </div>
          ))}
          {!categories.some((c) => c.group === g) && <p className="px-3 py-3 text-xs text-gray-400">분류가 없습니다.</p>}
        </div>
      ))}
      <p className="text-xs text-gray-500">삭제는 없습니다 — 제출물이 매달려 있어 숨김으로 대신합니다. 숨긴 분류는 새 제출·요청에서만 빠지고 기존 자료는 그대로 보입니다.</p>
    </div>
  );
}
