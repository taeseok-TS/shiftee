"use client";

// 큐브티워크 마케팅 자료 (2026-09-14 본부장 과제) — 지점이 수업·행사 사례, 성적 향상 사례, 지점 사진, 후기를 올리고
// 큐브마케팅이 회사 연동 키로 가져가 블로그에 발행한 뒤 주소를 되돌려준다("블로그 발행됨").
// 저장·권한·업로드는 자료제출(분류 구분 MARKETING)을 그대로 쓴다. 검수는 큐브마케팅 쪽(디렉터 확정 9/14) — 여기서는 동의 체크만 받는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Camera, Plus, X, Paperclip, Trash2, Loader2, ExternalLink, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { ALLOWED_EXT, IMAGE_EXT, MAX_FILES, MAX_FILE_BYTES, PREVIEW_EXT, extOf, type SubmissionFile } from "@/lib/submissions";

type Me = { id: string; name: string; role: "ADMIN" | "MANAGER" | "EMPLOYEE"; branch: string | null; jobGroup: string | null };
type Category = { id: string; group: string; name: string; active: boolean };
type Sub = {
  id: string; categoryId: string; category?: { id: string; group: string; name: string };
  userId: string; userName: string; userBranch: string | null; userJobGroup: string | null; userPosition: string | null;
  yearMonth: string; title: string; memo: string | null; files: SubmissionFile[]; consent: boolean;
  publishedAt: string | null; publishedUrl: string | null; createdAt: string;
};

const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`);
function openFile(f: SubmissionFile) {
  const ext = extOf(f.name);
  if (PREVIEW_EXT.has(ext)) window.open(`/docs/viewer?src=${encodeURIComponent(f.url)}&title=${encodeURIComponent(f.name.replace(/\.[^.]+$/, ""))}`, "_blank");
  else if (IMAGE_EXT.has(ext)) window.open(f.url, "_blank");
  else window.open(`${f.url}?download=1&name=${encodeURIComponent(f.name)}`, "_blank");
}

export default function MarketingPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [scope, setScope] = useState<"mine" | "branch" | "all">("mine");
  const [reloadKey, setReloadKey] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => { fetch("/api/auth/me").then((r) => r.json()).then((d) => setMe(d.user)).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/work/submissions/categories").then((r) => r.json()).then((d) => setCategories((d.categories || []).filter((c: Category) => c.group === "MARKETING"))).catch(() => {}); }, []);
  if (!me) return <div className="p-8 text-sm text-gray-500">불러오는 중…</div>;
  const scopes: [typeof scope, string][] = [["mine", "내 자료"], ...(me.role === "MANAGER" ? [["branch", "우리 지점"] as [typeof scope, string]] : []), ...(me.role === "ADMIN" ? [["all", "전체"] as [typeof scope, string]] : [])];
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold flex items-center gap-2"><Camera size={20} className="text-indigo-600" />마케팅 자료</h1>
        <Button onClick={() => setOpen(true)} className="ml-auto gap-1 bg-indigo-600 hover:bg-indigo-700"><Plus size={16} />자료 올리기</Button>
      </div>
      <p className="text-xs text-gray-500">수업·행사 사례, 성적 향상 사례, 지점 사진, 학부모 후기를 올려주세요. 큐브마케팅이 가져가 블로그에 발행하고, 발행되면 이 화면과 봇 DM 으로 주소를 알려드립니다. 학생 얼굴·이름·성적이 보이는 자료는 동의를 받았거나 가린 것만 올려주세요.</p>
      {scopes.length > 1 && (
        <div className="flex gap-1 border-b">
          {scopes.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setScope(k)} className={`px-3 py-2 text-sm border-b-2 -mb-px ${scope === k ? "border-indigo-600 text-indigo-700 font-medium" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{label}</button>
          ))}
        </div>
      )}
      <MaterialList me={me} scope={scope} categories={categories} reloadKey={reloadKey} onChanged={() => setReloadKey((k) => k + 1)} />
      {open && <UploadDialog categories={categories} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setReloadKey((k) => k + 1); }} />}
    </div>
  );
}

function MaterialList({ me, scope, categories, reloadKey, onChanged }: { me: Me; scope: "mine" | "branch" | "all"; categories: Category[]; reloadKey: number; onChanged: () => void }) {
  const [categoryId, setCategoryId] = useState("");
  const stamp = `${scope}|${categoryId}|${reloadKey}`;
  const [data, setData] = useState<{ stamp: string; rows: Sub[] } | null>(null);
  const rows = data && data.stamp === stamp ? data.rows : null;
  useEffect(() => {
    const my = stamp;
    // 마케팅 구분만 — 분류 필터가 없으면 MARKETING 분류 전부를 받아 화면에서 거른다
    const qs = new URLSearchParams({ scope, group: "MARKETING" });
    if (categoryId) qs.set("categoryId", categoryId);
    fetch(`/api/work/submissions?${qs}`).then((r) => r.json())
      .then((d) => setData({ stamp: my, rows: (d.submissions || []).filter((s: Sub) => s.category?.group === "MARKETING") }))
      .catch(() => setData({ stamp: my, rows: [] }));
  }, [scope, categoryId, reloadKey, stamp]);
  async function remove(s: Sub) {
    if (!confirm(`「${s.title}」 자료를 지울까요?`)) return;
    const res = await fetch(`/api/work/submissions/${s.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "지우지 못했습니다."); return; }
    toast.success("지웠습니다."); onChanged();
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center flex-wrap">
        <select className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">모든 유형</option>
          {categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {rows && <span className="text-xs text-gray-500 ml-auto">{rows.length}건</span>}
      </div>
      {!rows ? <p className="text-sm text-gray-500 py-6">불러오는 중…</p>
        : !rows.length ? <p className="text-sm text-gray-500 py-10 text-center">{scope === "mine" ? "아직 올린 마케팅 자료가 없습니다." : "올라온 마케팅 자료가 없습니다."}</p>
        : rows.map((s) => {
          const isOwner = s.userId === me.id;
          const images = s.files.filter((f) => IMAGE_EXT.has(extOf(f.name)));
          const others = s.files.filter((f) => !IMAGE_EXT.has(extOf(f.name)));
          return (
            <div key={s.id} className="bg-white border rounded-lg p-3 space-y-2">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{s.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {!isOwner && <span className="text-gray-700">{[s.userBranch, s.userJobGroup].filter(Boolean).join(" · ")} <b>{s.userName}</b> · </span>}
                    {s.category?.name} · {format(new Date(s.createdAt), "M/d HH:mm")}
                  </p>
                  {s.memo && <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">{s.memo}</p>}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  {s.publishedAt ? (
                    <a href={s.publishedUrl ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-green-50 text-green-700 border-green-200 hover:underline">
                      <CheckCircle2 size={11} />블로그 발행됨 {format(new Date(s.publishedAt), "M/d")}<ExternalLink size={10} />
                    </a>
                  ) : <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border bg-gray-100 text-gray-600 border-gray-200">발행 대기</span>}
                  {(isOwner || me.role === "ADMIN") && !s.publishedAt && <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600" onClick={() => remove(s)}><Trash2 size={12} /></Button>}
                </div>
              </div>
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {images.map((f) => (
                    <button key={f.url} type="button" onClick={() => openFile(f)} className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.url} alt={f.name} className="h-24 w-24 object-cover rounded border" />
                    </button>
                  ))}
                </div>
              )}
              {others.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {others.map((f) => (
                    <button key={f.url} type="button" onClick={() => openFile(f)} className="inline-flex items-center gap-1.5 text-xs text-gray-700 hover:text-indigo-700 hover:underline">
                      <Paperclip size={12} />{f.name} <span className="text-gray-400">{fmtBytes(f.size)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

function UploadDialog({ categories, onClose, onDone }: { categories: Category[]; onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<SubmissionFile[]>([]);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [memo, setMemo] = useState("");
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addFiles = useCallback(async (list: FileList | File[]) => {
    const arr = Array.from(list);
    let count = files.length;
    if (count + arr.length > MAX_FILES) toast.error(`파일은 ${MAX_FILES}개까지입니다. 앞의 ${Math.max(0, MAX_FILES - count)}개만 올립니다.`);
    for (const file of arr) {
      if (count >= MAX_FILES) break;
      const ext = extOf(file.name);
      if (!ALLOWED_EXT.has(ext)) { toast.error(`${file.name}: 사진·워드·엑셀·PPT·PDF·한글·ZIP 만 올릴 수 있습니다.`); continue; }
      if (file.size > MAX_FILE_BYTES) { toast.error(`${file.name}: 파일당 50MB 이하만 올릴 수 있습니다.`); continue; }
      setUploading((n) => n + 1);
      try {
        const fd = new FormData(); fd.append("file", file);
        const res = await fetch("/api/work/submissions/upload", { method: "POST", body: fd });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { toast.error(`${file.name}: ${d.error || "업로드 실패"}`); continue; }
        setFiles((cur) => [...cur, d as SubmissionFile]); count++;
        setTitle((t) => t || file.name.replace(/\.[^.]+$/, ""));
      } finally { setUploading((n) => n - 1); }
    }
  }, [files.length]);
  async function submit() {
    if (!files.length) { toast.error("사진이나 파일을 올려주세요."); return; }
    if (!categoryId) { toast.error("자료 유형을 골라주세요."); return; }
    if (!consent) { toast.error("개인정보 확인에 체크해주세요."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/work/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryId, title, memo, files, consent }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "올리지 못했습니다."); return; }
      toast.success("올렸습니다. 큐브마케팅이 확인해 발행하면 알려드립니다.");
      onDone();
    } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !uploading && !saving) onClose(); }}>
      <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>마케팅 자료 올리기</DialogTitle></DialogHeader>
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }} onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed rounded-lg p-5 text-center text-sm cursor-pointer border-gray-300 text-gray-500 hover:bg-gray-50">
          <Paperclip size={18} className="inline mr-1" />사진·파일을 여기에 끌어다 놓거나 클릭해서 고르기
          <p className="text-[11px] text-gray-400 mt-1">사진(JPG·PNG) 여러 장 · 워드·PPT·PDF·한글·ZIP — 파일당 50MB, {MAX_FILES}개까지</p>
          <input ref={inputRef} type="file" multiple hidden accept={[...ALLOWED_EXT].join(",")} onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {(files.length > 0 || uploading > 0) && (
          <div className="flex flex-wrap gap-2">
            {files.map((f) => (
              <div key={f.url} className="relative">
                {IMAGE_EXT.has(extOf(f.name))
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={f.url} alt={f.name} className="h-20 w-20 object-cover rounded border" />
                  : <div className="h-20 w-40 rounded border bg-gray-50 p-2 text-xs overflow-hidden"><Paperclip size={12} className="inline mr-1" />{f.name}</div>}
                <button type="button" onClick={() => setFiles((cur) => cur.filter((x) => x.url !== f.url))} className="absolute -top-2 -right-2 bg-gray-700 text-white rounded-full p-0.5"><X size={12} /></button>
              </div>
            ))}
            {uploading > 0 && <p className="text-xs text-indigo-600 flex items-center gap-1 self-center"><Loader2 size={12} className="animate-spin" />올리는 중 ({uploading})</p>}
          </div>
        )}
        <div className="space-y-3">
          <div><label className="text-xs text-gray-500">자료 유형</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {categories.filter((c) => c.active).map((c) => (
                <button key={c.id} type="button" onClick={() => setCategoryId(c.id)} className={`px-3 py-1 rounded-md border text-sm ${categoryId === c.id ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-300 bg-white text-gray-700"}`}>{c.name}</button>
              ))}
              {!categories.length && <span className="text-xs text-gray-400">유형을 불러오지 못했습니다. 새로고침해주세요.</span>}
            </div></div>
          <div><label className="text-xs text-gray-500">제목</label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 9월 과학 실험 수업 — 대치" maxLength={150} /></div>
          <div><label className="text-xs text-gray-500">짧은 설명 (블로그 글의 재료가 됩니다)</label><Textarea rows={3} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="언제·누가·무엇을 했고 어떤 점이 좋았는지 두세 줄" maxLength={1000} /></div>
          <label className="flex items-start gap-2 text-xs text-gray-700 bg-amber-50 border border-amber-200 rounded p-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span><b>개인정보 확인(필수)</b> — 학생·학부모의 얼굴, 이름, 성적이 보이는 경우 외부 게시 동의를 받았거나 가렸습니다. 이 자료는 블로그 등 외부에 발행될 수 있습니다.</span>
          </label>
          <p className="text-[11px] text-gray-400">지점·직책은 내 정보로 자동으로 붙습니다. 발행 전 검수는 큐브마케팅이 합니다.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={!!uploading || saving}>취소</Button>
          <Button disabled={saving || uploading > 0 || !files.length || !consent || !categoryId} onClick={submit} className="bg-indigo-600 hover:bg-indigo-700">{saving ? "올리는 중…" : "올리기"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
