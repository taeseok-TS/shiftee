"use client";

// 큐브티워크 「합격 · 성적 사례」 (2026-11-13 디렉터 결정 — 11/13 직영 주간회의 김나현 팀장 의견)
// EMS 「에듀합격스타」처럼 사례마다 성적 변화 · 지원 결과 · 전략을 남겨, 매니저가 다른 지점 사례로 공부하고 합격을 자랑하는 내부 게시판.
// 열람 = 튜터 빼고 전 직원(본부 포함). 학생은 학년 · 성만. 외부 게시는 「마케팅 자료로도 보내기」(동의 체크 따로)로만.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trophy, Plus, X, Paperclip, Loader2, Search, PartyPopper, MessageCircle, Pencil, Trash2, Send, Megaphone, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { IMAGE_EXT, MAX_FILE_BYTES, PREVIEW_EXT, decodeFileName, extOf, type SubmissionFile } from "@/lib/submissions";
import {
  CASE_KINDS, CASE_KIND_LABEL, CASE_MAX_FILES, COMMENT_MAX, GENDERS, GRADE_BASES, OUTCOMES, RESULTS_MAX, SCHOOL_TYPES, STRATEGY_MIN, STUDENT_GRADES,
  caseFileAllowed, type CaseKind, type CaseResult,
} from "@/lib/success-cases";

type CaseItem = {
  id: string; kind: CaseKind; kindLabel: string; title: string; student: string;
  studentGrade: string; studentSurname: string; studentGender: string | null;
  region: string | null; schoolType: string | null; periodMonths: number | null;
  gradeBasis: string | null; gradeFrom: number | null; gradeTo: number | null;
  beforeText: string | null; afterText: string | null; results: CaseResult[]; strategy: string;
  files: SubmissionFile[]; fileCount: number;
  authorId: string; authorName: string; authorBranch: string | null; authorJobGroup: string | null;
  marketingSent: boolean; cheerCount: number; commentCount: number; cheeredByMe: boolean; canEdit: boolean;
  createdAt: string; updatedAt: string;
};
type Comment = { id: string; userId: string; userName: string; userBranch: string | null; content: string; createdAt: string; canDelete: boolean };

const KIND_STYLE: Record<CaseKind, string> = {
  UNIV: "bg-indigo-50 text-indigo-700 border-indigo-200",
  HS: "bg-emerald-50 text-emerald-700 border-emerald-200",
  GRADE: "bg-amber-50 text-amber-700 border-amber-200",
};
const OUTCOME_STYLE: Record<string, string> = { 합격: "text-emerald-700", 추가합격: "text-emerald-700", 예비: "text-amber-700", 불합격: "text-gray-500" };

function gradeLine(c: Pick<CaseItem, "gradeBasis" | "gradeFrom" | "gradeTo">): string | null {
  if (c.gradeFrom === null && c.gradeTo === null) return null;
  return `${c.gradeBasis ?? "평균"} ${c.gradeFrom ?? "?"}등급 → ${c.gradeTo ?? "?"}등급`;
}
function openFile(f: SubmissionFile) {
  const ext = extOf(f.name);
  if (PREVIEW_EXT.has(ext)) window.open(`/docs/viewer?src=${encodeURIComponent(f.url)}&title=${encodeURIComponent(f.name.replace(/\.[^.]+$/, ""))}`, "_blank");
  else if (IMAGE_EXT.has(ext)) window.open(f.url, "_blank");
  else window.open(`${f.url}?download=1&name=${encodeURIComponent(decodeFileName(f.name))}`, "_blank");
}

export default function CasesPage() {
  const [cases, setCases] = useState<CaseItem[] | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [grade, setGrade] = useState("");
  const [branch, setBranch] = useState("");
  const [band, setBand] = useState("");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CaseItem | "new" | null>(null);

  useEffect(() => {
    let alive = true;
    const sp = new URLSearchParams();
    if (kind) sp.set("kind", kind); if (grade) sp.set("grade", grade); if (branch) sp.set("branch", branch);
    if (band) sp.set("band", band); if (mine) sp.set("mine", "1"); if (qApplied) sp.set("q", qApplied);
    fetch(`/api/work/cases?${sp}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!alive) return;
      if (r.status === 403) { setBlocked(d.error || "볼 수 없습니다."); setCases([]); return; }
      if (!r.ok) { toast.error(d.error || "불러오지 못했습니다."); setCases([]); return; }
      setCases(d.cases || []); setBranches(d.branches || []);
    }).catch(() => { if (alive) setCases([]); });
    return () => { alive = false; };
  }, [kind, grade, branch, band, mine, qApplied, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  const sel = "h-9 rounded-md border border-gray-300 bg-white px-2 text-sm";

  if (blocked) return <div className="p-8 text-sm text-gray-500">{blocked}</div>;
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold flex items-center gap-2"><Trophy size={20} className="text-amber-500" />합격 · 성적 사례</h1>
        <Button onClick={() => setEditing("new")} className="ml-auto gap-1 bg-indigo-600 hover:bg-indigo-700"><Plus size={16} />사례 쓰기</Button>
      </div>
      <p className="text-xs text-gray-500">우리 지점 학생의 합격 · 성적 상승 사례와 전략을 남겨 주세요. 전 지점 매니저가 함께 보고 배우는 <b>내부 게시판</b>입니다. 학생은 학년과 성만 보입니다(이름 · 얼굴은 올리지 않습니다).</p>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1">
          {[["", "전체"], ...CASE_KINDS.map((k) => [k, CASE_KIND_LABEL[k]])].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`px-3 py-1.5 rounded-md border text-sm ${kind === k ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium" : "border-gray-300 bg-white text-gray-600"}`}>{label}</button>
          ))}
        </div>
        <select className={sel} value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="학년"><option value="">모든 학년</option>{STUDENT_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}</select>
        <select className={sel} value={band} onChange={(e) => setBand(e.target.value)} aria-label="등급대"><option value="">모든 등급대</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((b) => <option key={b} value={b}>{b}등급대</option>)}</select>
        <select className={sel} value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="지점"><option value="">모든 지점</option>{branches.map((b) => <option key={b} value={b}>{b}</option>)}</select>
        <label className="flex items-center gap-1 text-sm text-gray-600"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />내가 쓴 글</label>
        <form className="flex gap-1 ml-auto" onSubmit={(e) => { e.preventDefault(); setQApplied(q.trim()); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="학교 · 학과 · 전략 검색" className="h-9 w-52" maxLength={50} />
          <Button type="submit" variant="outline" className="h-9 px-2" aria-label="검색"><Search size={16} /></Button>
        </form>
      </div>
      <p className="text-[11px] text-gray-400">등급대는 결과(지원 시점) 평균 등급 기준입니다. 결과가 없으면 시작 등급으로 셉니다.</p>

      {cases === null ? <div className="text-sm text-gray-500 py-10 text-center">불러오는 중…</div>
        : cases.length === 0 ? <div className="text-sm text-gray-500 py-16 text-center border rounded-lg bg-gray-50">아직 사례가 없습니다. 첫 사례를 남겨 주세요!</div>
        : (
          <div className="grid gap-3 md:grid-cols-2">
            {cases.map((c) => (
              <button key={c.id} type="button" onClick={() => setOpenId(c.id)} className="text-left border rounded-lg bg-white p-4 hover:shadow-md hover:border-indigo-300 transition space-y-2">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className={`px-2 py-0.5 rounded border ${KIND_STYLE[c.kind] ?? ""}`}>{c.kindLabel}</span>
                  <span className="text-gray-700 font-medium">{c.student}</span>
                  {c.schoolType && <span className="text-gray-400">{c.schoolType}</span>}
                  <span className="ml-auto text-gray-400">{c.authorBranch ?? "-"} · {c.authorName}</span>
                </div>
                <p className="font-semibold text-gray-900 leading-snug">{c.title}</p>
                {gradeLine(c) && <p className="text-sm text-indigo-700 flex items-center gap-1">{gradeLine(c)}</p>}
                {c.results.length > 0 && (
                  <p className="text-xs text-gray-600 truncate">{c.results.slice(0, 3).map((r) => `${r.school}${r.major ? ` ${r.major}` : ""} ${r.outcome}`).join(" · ")}{c.results.length > 3 ? ` 외 ${c.results.length - 3}` : ""}</p>
                )}
                <p className="text-xs text-gray-500 line-clamp-2 whitespace-pre-line">{c.strategy}</p>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span className={`flex items-center gap-1 ${c.cheeredByMe ? "text-pink-600" : ""}`}><PartyPopper size={13} />{c.cheerCount}</span>
                  <span className="flex items-center gap-1"><MessageCircle size={13} />{c.commentCount}</span>
                  {c.fileCount > 0 && <span className="flex items-center gap-1"><Paperclip size={13} />{c.fileCount}</span>}
                  {c.marketingSent && <span className="flex items-center gap-1 text-indigo-500"><Megaphone size={13} />마케팅 자료로 보냄</span>}
                  <span className="ml-auto">{format(new Date(c.createdAt), "yyyy.MM.dd")}</span>
                </div>
              </button>
            ))}
          </div>
        )}

      {openId && <CaseDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} onEdit={(c) => { setOpenId(null); setEditing(c); }} />}
      {editing && <CaseForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={(id) => { setEditing(null); reload(); setOpenId(id); }} />}
    </div>
  );
}

function CaseDetail({ id, onClose, onChanged, onEdit }: { id: string; onClose: () => void; onChanged: () => void; onEdit: (c: CaseItem) => void }) {
  const [c, setC] = useState<CaseItem | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [mkOpen, setMkOpen] = useState(false);
  const [mkConsent, setMkConsent] = useState(false);
  const load = useCallback(() => {
    fetch(`/api/work/cases/${id}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || "불러오지 못했습니다."); onClose(); return; }
      setC(d.case); setComments(d.comments || []);
    }).catch(() => toast.error("불러오지 못했습니다."));
  }, [id, onClose]);
  useEffect(() => { load(); }, [load]);

  async function cheer() {
    if (!c) return;
    const res = await fetch(`/api/work/cases/${id}/cheer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: !c.cheeredByMe }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "실패했습니다."); return; }
    setC({ ...c, cheeredByMe: d.on, cheerCount: d.cheerCount }); onChanged();
  }
  async function addComment() {
    const content = text.trim(); if (!content) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/work/cases/${id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "댓글을 달지 못했습니다."); return; }
      setComments((cur) => [...cur, d.comment]); setText("");
      setC((cur) => (cur ? { ...cur, commentCount: d.commentCount } : cur)); onChanged();
    } finally { setBusy(false); }
  }
  async function delComment(cid: string) {
    if (!confirm("댓글을 지울까요?")) return;
    const res = await fetch(`/api/work/cases/${id}/comments/${cid}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "지우지 못했습니다."); return; }
    setComments((cur) => cur.filter((m) => m.id !== cid)); setC((cur) => (cur ? { ...cur, commentCount: d.commentCount } : cur)); onChanged();
  }
  async function del() {
    if (!c || !confirm("이 사례를 지울까요? (마케팅 자료로 보낸 것은 따로 남습니다)")) return;
    const res = await fetch(`/api/work/cases/${id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "지우지 못했습니다."); return; }
    toast.success("지웠습니다."); onChanged(); onClose();
  }
  async function sendMarketing() {
    setBusy(true);
    try {
      const res = await fetch(`/api/work/cases/${id}/marketing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: mkConsent }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "보내지 못했습니다."); return; }
      toast.success("마케팅 자료로 보냈습니다. 큐브마케팅이 확인해 발행하면 알려드립니다.");
      setMkOpen(false); setC((cur) => (cur ? { ...cur, marketingSent: true } : cur)); onChanged();
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[90vh] overflow-y-auto grid-cols-[minmax(0,1fr)]">
        {!c ? <div className="py-10 text-center text-sm text-gray-500"><Loader2 size={16} className="inline animate-spin mr-1" />불러오는 중…</div> : (
          <>
            <DialogHeader><DialogTitle className="leading-snug pr-6">{c.title}</DialogTitle></DialogHeader>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className={`px-2 py-0.5 rounded border ${KIND_STYLE[c.kind] ?? ""}`}>{c.kindLabel}</span>
              <span className="text-gray-700 font-medium">{c.student}</span>
              {[c.region, c.schoolType, c.periodMonths ? `관리 ${c.periodMonths}개월` : null].filter(Boolean).map((t) => <span key={t as string} className="text-gray-500">· {t}</span>)}
              <span className="ml-auto text-gray-400">{c.authorBranch ?? "-"} · {c.authorName} · {format(new Date(c.createdAt), "yyyy.MM.dd")}</span>
            </div>

            {(gradeLine(c) || c.beforeText || c.afterText) && (
              <div className="rounded-lg border bg-indigo-50/40 p-3 space-y-1.5 text-sm">
                {gradeLine(c) && <p className="font-semibold text-indigo-700">{gradeLine(c)}</p>}
                {(c.beforeText || c.afterText) && (
                  <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-2 items-start">
                    <div><p className="text-[11px] text-gray-400">시작</p><p className="whitespace-pre-line text-gray-700">{c.beforeText || "-"}</p></div>
                    <ArrowRight size={16} className="hidden sm:block text-gray-300 mt-4" />
                    <div><p className="text-[11px] text-gray-400">결과</p><p className="whitespace-pre-line text-gray-700">{c.afterText || "-"}</p></div>
                  </div>
                )}
              </div>
            )}

            {c.results.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">지원 · 합격 결과</p>
                <table className="w-full text-sm border rounded">
                  <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left p-1.5">학교</th><th className="text-left p-1.5">전형</th><th className="text-left p-1.5">학과</th><th className="text-left p-1.5">결과</th></tr></thead>
                  <tbody>{c.results.map((r, i) => (
                    <tr key={i} className="border-t"><td className="p-1.5">{r.school}</td><td className="p-1.5 text-gray-600">{r.track || "-"}</td><td className="p-1.5 text-gray-600">{r.major || "-"}</td><td className={`p-1.5 font-medium ${OUTCOME_STYLE[r.outcome] ?? ""}`}>{r.outcome}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            <div><p className="text-xs text-gray-500 mb-1">전략 · 노하우</p><p className="text-sm whitespace-pre-line leading-relaxed text-gray-800 border rounded-lg p-3 bg-white">{c.strategy}</p></div>

            {c.files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {c.files.map((f) => (
                  <button key={f.url} type="button" onClick={() => openFile(f)} className="text-left">
                    {IMAGE_EXT.has(extOf(f.name))
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={f.url} alt={f.name} className="h-20 w-20 object-cover rounded border" />
                      : <div className="h-20 w-40 rounded border bg-gray-50 p-2 text-xs overflow-hidden hover:bg-gray-100"><Paperclip size={12} className="inline mr-1" />{decodeFileName(f.name)}</div>}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap border-t pt-3">
              <Button variant="outline" onClick={cheer} className={`gap-1 ${c.cheeredByMe ? "border-pink-300 bg-pink-50 text-pink-700 hover:bg-pink-100" : ""}`}><PartyPopper size={16} />축하해요 {c.cheerCount}</Button>
              {c.marketingSent
                ? <span className="text-xs text-indigo-600 flex items-center gap-1"><Megaphone size={14} />마케팅 자료로 보냄</span>
                : c.canEdit && <Button variant="outline" onClick={() => { setMkConsent(false); setMkOpen((o) => !o); }} className="gap-1"><Megaphone size={16} />마케팅 자료로도 보내기</Button>}
              {c.canEdit && (
                <div className="ml-auto flex gap-1">
                  <Button variant="outline" onClick={() => onEdit(c)} className="gap-1"><Pencil size={14} />고치기</Button>
                  <Button variant="outline" onClick={del} className="gap-1 text-red-600 hover:text-red-700"><Trash2 size={14} />지우기</Button>
                </div>
              )}
            </div>
            {mkOpen && !c.marketingSent && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2 text-xs text-gray-700">
                <p>이 사례를 「마케팅 자료」로도 올려 큐브마케팅이 블로그 글감으로 쓸 수 있게 합니다. <b>외부에 나갈 수 있는 자료</b>입니다.</p>
                <label className="flex items-start gap-2 cursor-pointer"><input type="checkbox" className="mt-0.5" checked={mkConsent} onChange={(e) => setMkConsent(e.target.checked)} />
                  <span><b>외부 게시 동의(필수)</b> — 학생 · 학부모에게 외부 게시 동의를 받았거나, 알아볼 수 있는 정보(이름 · 얼굴 · 학교 · 성적표)를 가렸습니다.</span></label>
                <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setMkOpen(false)}>취소</Button><Button disabled={!mkConsent || busy} onClick={sendMarketing} className="bg-indigo-600 hover:bg-indigo-700">보내기</Button></div>
              </div>
            )}

            <div className="border-t pt-3 space-y-2">
              <p className="text-xs text-gray-500">댓글 {comments.length}</p>
              {comments.map((m) => (
                <div key={m.id} className="text-sm bg-gray-50 rounded-lg p-2">
                  <div className="flex items-center gap-2 text-xs text-gray-500"><b className="text-gray-700">{m.userName}</b>{m.userBranch && <span>{m.userBranch}</span>}<span>{format(new Date(m.createdAt), "MM.dd HH:mm")}</span>
                    {m.canDelete && <button type="button" onClick={() => delComment(m.id)} className="ml-auto text-gray-400 hover:text-red-600" aria-label="댓글 지우기"><X size={14} /></button>}</div>
                  <p className="whitespace-pre-line mt-0.5 text-gray-800">{m.content}</p>
                </div>
              ))}
              <div className="flex gap-2">
                <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="축하 · 궁금한 점을 남겨 주세요" maxLength={COMMENT_MAX} />
                <Button disabled={busy || !text.trim()} onClick={addComment} className="self-end bg-indigo-600 hover:bg-indigo-700" aria-label="댓글 달기"><Send size={16} /></Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const emptyResult = (): CaseResult => ({ school: "", track: "", major: "", outcome: "합격" });

function CaseForm({ initial, onClose, onDone }: { initial: CaseItem | null; onClose: () => void; onDone: (id: string) => void }) {
  const [kind, setKind] = useState<CaseKind>(initial?.kind ?? "UNIV");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [studentGrade, setStudentGrade] = useState(initial?.studentGrade ?? "");
  const [studentSurname, setStudentSurname] = useState(initial?.studentSurname ?? "");
  const [studentGender, setStudentGender] = useState(initial?.studentGender ?? "");
  const [region, setRegion] = useState(initial?.region ?? "");
  const [schoolType, setSchoolType] = useState(initial?.schoolType ?? "");
  const [periodMonths, setPeriodMonths] = useState(initial?.periodMonths ? String(initial.periodMonths) : "");
  const [gradeBasis, setGradeBasis] = useState(initial?.gradeBasis ?? "내신");
  const [gradeFrom, setGradeFrom] = useState(initial?.gradeFrom !== null && initial?.gradeFrom !== undefined ? String(initial.gradeFrom) : "");
  const [gradeTo, setGradeTo] = useState(initial?.gradeTo !== null && initial?.gradeTo !== undefined ? String(initial.gradeTo) : "");
  const [beforeText, setBeforeText] = useState(initial?.beforeText ?? "");
  const [afterText, setAfterText] = useState(initial?.afterText ?? "");
  const [results, setResults] = useState<CaseResult[]>(initial?.results?.length ? initial.results : [emptyResult()]);
  const [strategy, setStrategy] = useState(initial?.strategy ?? "");
  const [files, setFiles] = useState<SubmissionFile[]>(initial?.files ?? []);
  const [maskConfirmed, setMaskConfirmed] = useState(false);
  const [toMarketing, setToMarketing] = useState(false);
  const [mkConsent, setMkConsent] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialUrls = new Set((initial?.files ?? []).map((f) => f.url));
  const hasNewFile = files.some((f) => !initialUrls.has(f.url));
  const needMask = initial ? hasNewFile : files.length > 0;

  const addFiles = useCallback(async (list: FileList | File[]) => {
    let count = files.length;
    for (const file of Array.from(list)) {
      if (count >= CASE_MAX_FILES) { toast.error(`첨부는 ${CASE_MAX_FILES}개까지입니다.`); break; }
      if (!caseFileAllowed(file.name)) { toast.error(`${file.name}: 이미지 · PDF · 워드 · 엑셀 · PPT · 한글만 올릴 수 있습니다(아이폰 HEIC 는 JPG 로).`); continue; }
      if (file.size > MAX_FILE_BYTES) { toast.error(`${file.name}: 파일당 50MB 이하만 올릴 수 있습니다.`); continue; }
      setUploading((n) => n + 1);
      try {
        const fd = new FormData(); fd.append("file", file);
        const res = await fetch("/api/work/submissions/upload", { method: "POST", body: fd });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { toast.error(`${file.name}: ${d.error || "업로드 실패"}`); continue; }
        setFiles((cur) => [...cur, d as SubmissionFile]); count++;
      } finally { setUploading((n) => n - 1); }
    }
  }, [files.length]);

  const setResult = (i: number, patch: Partial<CaseResult>) => setResults((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit() {
    if (needMask && !maskConfirmed) { toast.error("첨부 가림 확인에 체크해주세요."); return; }
    if (!initial && toMarketing && !mkConsent) { toast.error("마케팅 자료로 보내려면 외부 게시 동의에 체크해주세요."); return; }
    setSaving(true);
    try {
      const body = {
        kind, title, studentGrade, studentSurname: studentSurname.trim(), studentGender: studentGender || null,
        region, schoolType: schoolType || null, periodMonths: periodMonths || null, gradeBasis: gradeBasis || null,
        gradeFrom: gradeFrom || null, gradeTo: gradeTo || null, beforeText, afterText,
        results: results.filter((r) => r.school.trim()),
        strategy, files, maskConfirmed,
        ...(initial ? {} : { sendToMarketing: toMarketing, marketingConsent: mkConsent }),
      };
      const res = await fetch(initial ? `/api/work/cases/${initial.id}` : "/api/work/cases", { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "저장하지 못했습니다."); return; }
      if (d.marketingError) toast.error(`사례는 올렸지만 마케팅 자료로는 못 보냈습니다: ${d.marketingError}`);
      else toast.success(initial ? "고쳤습니다." : toMarketing ? "올렸습니다. 마케팅 자료로도 보냈습니다." : "올렸습니다. 축하드려요!");
      onDone(d.case.id);
    } finally { setSaving(false); }
  }

  const sel = "h-9 rounded-md border border-gray-300 bg-white px-2 text-sm w-full";
  const lab = "text-xs text-gray-500";
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !uploading && !saving) onClose(); }}>
      <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[90vh] overflow-y-auto grid-cols-[minmax(0,1fr)]">
        <DialogHeader><DialogTitle>{initial ? "사례 고치기" : "사례 쓰기"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {CASE_KINDS.map((k) => <button key={k} type="button" onClick={() => setKind(k)} className={`px-3 py-1.5 rounded-md border text-sm ${kind === k ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium" : "border-gray-300 bg-white text-gray-700"}`}>{CASE_KIND_LABEL[k]}</button>)}
          </div>
          <div><label className={lab}>한 줄 제목 *</label><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder={kind === "GRADE" ? "예: 수학 5등급 → 2등급, 개념 다시 잡기로 한 학기 만에" : "예: 내신 2.8, 학종으로 ○○대 경영 합격"} /></div>

          <div className="grid grid-cols-3 gap-2">
            <div><label className={lab}>학년 *</label><select className={sel} value={studentGrade} onChange={(e) => setStudentGrade(e.target.value)}><option value="">고르기</option>{STUDENT_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}</select></div>
            <div><label className={lab}>학생 성 *</label><Input value={studentSurname} onChange={(e) => setStudentSurname(e.target.value)} maxLength={2} placeholder="김" /></div>
            <div><label className={lab}>성별</label><select className={sel} value={studentGender} onChange={(e) => setStudentGender(e.target.value)}><option value="">-</option>{GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}</select></div>
          </div>
          <p className="text-[11px] text-gray-400 -mt-2">학생 이름은 저장하지 않습니다 — 성만 적으면 「{studentGrade || "고3"} {studentSurname || "김"}○○」로 보입니다.</p>
          <div className="grid grid-cols-3 gap-2">
            <div><label className={lab}>지역</label><Input value={region} onChange={(e) => setRegion(e.target.value)} maxLength={30} placeholder="예: 강남구" /></div>
            <div><label className={lab}>학교 유형</label><select className={sel} value={schoolType} onChange={(e) => setSchoolType(e.target.value)}><option value="">-</option>{SCHOOL_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><label className={lab}>관리 기간(개월)</label><Input type="number" min={1} max={120} value={periodMonths} onChange={(e) => setPeriodMonths(e.target.value)} placeholder="예: 18" /></div>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div><label className={lab}>성적 기준</label><select className={sel} value={gradeBasis} onChange={(e) => setGradeBasis(e.target.value)}>{GRADE_BASES.map((g) => <option key={g} value={g}>{g}</option>)}</select></div>
              <div><label className={lab}>시작 평균 등급</label><Input type="number" step="0.01" min={1} max={9} value={gradeFrom} onChange={(e) => setGradeFrom(e.target.value)} placeholder="예: 4.1" /></div>
              <div><label className={lab}>{kind === "GRADE" ? "결과 평균 등급" : "지원 시점 평균 등급"}</label><Input type="number" step="0.01" min={1} max={9} value={gradeTo} onChange={(e) => setGradeTo(e.target.value)} placeholder="예: 2.3" /></div>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <div><label className={lab}>시작 성적 자세히(과목별)</label><Textarea rows={2} value={beforeText} onChange={(e) => setBeforeText(e.target.value)} maxLength={500} placeholder="예: 국3 수5 영2 (고1 1학기)" /></div>
              <div><label className={lab}>결과 성적 자세히(과목별)</label><Textarea rows={2} value={afterText} onChange={(e) => setAfterText(e.target.value)} maxLength={500} placeholder="예: 국2 수2 영1 (고2 2학기)" /></div>
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className={lab}>지원 · 합격 결과{kind === "GRADE" ? " (있으면)" : " *"} — 불합격 · 예비도 적으면 다음 매니저에게 큰 도움이 됩니다</p>
            {results.map((r, i) => (
              <div key={i} className="grid grid-cols-[2fr_1.5fr_1.5fr_1fr_auto] gap-1.5 items-center">
                <Input value={r.school} onChange={(e) => setResult(i, { school: e.target.value })} maxLength={60} placeholder="학교" />
                <Input value={r.track} onChange={(e) => setResult(i, { track: e.target.value })} maxLength={60} placeholder="전형" />
                <Input value={r.major} onChange={(e) => setResult(i, { major: e.target.value })} maxLength={60} placeholder="학과" />
                <select className="h-9 rounded-md border border-gray-300 bg-white px-1 text-sm" value={r.outcome} onChange={(e) => setResult(i, { outcome: e.target.value })}>{OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                <button type="button" onClick={() => setResults((cur) => (cur.length > 1 ? cur.filter((_, j) => j !== i) : [emptyResult()]))} className="text-gray-400 hover:text-red-600" aria-label="줄 지우기"><X size={16} /></button>
              </div>
            ))}
            {results.length < RESULTS_MAX && <button type="button" onClick={() => setResults((cur) => [...cur, emptyResult()])} className="text-xs text-indigo-600 hover:underline">+ 한 줄 더</button>}
          </div>

          <div><label className={lab}>전략 · 노하우 * ({STRATEGY_MIN}자 이상)</label>
            <Textarea rows={6} value={strategy} onChange={(e) => setStrategy(e.target.value)} maxLength={4000} placeholder={"다른 지점 매니저가 따라 할 수 있게 적어 주세요.\n· 처음 상담 때 학생 상태와 목표\n· 학습 계획 · 관리 방법(무엇을 바꿨나)\n· 원서 전략(왜 이 학교 · 전형을 골랐나)\n· 잘 안 됐던 것과 다음에 다르게 할 것"} />
            <p className={`text-[11px] text-right ${strategy.trim().length < STRATEGY_MIN ? "text-amber-600" : "text-gray-400"}`}>{strategy.trim().length}자</p></div>

          <div>
            <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }} onClick={() => inputRef.current?.click()}
              className="border-2 border-dashed rounded-lg p-3 text-center text-sm cursor-pointer border-gray-300 text-gray-500 hover:bg-gray-50">
              <Paperclip size={16} className="inline mr-1" />첨부(선택) — 가린 성적표 · 계획표 등, {CASE_MAX_FILES}개까지
              <input ref={inputRef} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx" onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {(files.length > 0 || uploading > 0) && (
              <div className="flex flex-wrap gap-2 mt-2">
                {files.map((f) => (
                  <div key={f.url} className="relative">
                    {IMAGE_EXT.has(extOf(f.name))
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={f.url} alt={f.name} className="h-16 w-16 object-cover rounded border" />
                      : <div className="h-16 w-36 rounded border bg-gray-50 p-2 text-xs overflow-hidden"><Paperclip size={12} className="inline mr-1" />{decodeFileName(f.name)}</div>}
                    <button type="button" onClick={() => setFiles((cur) => cur.filter((x) => x.url !== f.url))} className="absolute -top-2 -right-2 bg-gray-700 text-white rounded-full p-0.5" aria-label="첨부 빼기"><X size={12} /></button>
                  </div>
                ))}
                {uploading > 0 && <p className="text-xs text-indigo-600 flex items-center gap-1 self-center"><Loader2 size={12} className="animate-spin" />올리는 중 ({uploading})</p>}
              </div>
            )}
            {needMask && (
              <label className="flex items-start gap-2 text-xs text-gray-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={maskConfirmed} onChange={(e) => setMaskConfirmed(e.target.checked)} />
                <span><b>첨부 가림 확인(필수)</b> — 학생 이름 · 얼굴 · 학교 이름 · 수험번호와 학부모 연락처를 가렸습니다. 학생 얼굴 사진은 올리지 않습니다.</span>
              </label>
            )}
          </div>

          {!initial && (
            <div className="rounded-lg border p-3 space-y-2 text-xs text-gray-700">
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={toMarketing} onChange={(e) => setToMarketing(e.target.checked)} /><Megaphone size={14} className="text-indigo-500" /><b>마케팅 자료로도 보내기</b> — 큐브마케팅이 블로그 글감으로 씁니다(외부 게시)</label>
              {toMarketing && (
                <label className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded p-2 cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={mkConsent} onChange={(e) => setMkConsent(e.target.checked)} />
                  <span><b>외부 게시 동의(필수)</b> — 학생 · 학부모에게 외부 게시 동의를 받았거나, 알아볼 수 있는 정보를 가렸습니다.</span>
                </label>
              )}
            </div>
          )}
          {initial?.marketingSent && <p className="text-[11px] text-gray-400">이미 마케팅 자료로 보낸 사례입니다. 여기서 고쳐도 보낸 마케팅 자료는 바뀌지 않습니다.</p>}
          <p className="text-[11px] text-gray-400">작성자 · 지점은 내 정보로 자동으로 붙습니다. 고치고 지우기는 작성자와 본부가 할 수 있습니다.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={!!uploading || saving}>취소</Button>
          <Button disabled={saving || uploading > 0} onClick={submit} className="bg-indigo-600 hover:bg-indigo-700">{saving ? "저장 중…" : initial ? "고치기" : "올리기"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
