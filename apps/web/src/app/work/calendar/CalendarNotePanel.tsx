"use client";

// 캘린더 오른쪽 「이달의 지점 공유」(#222, 2026-10-20 권경욱 제안 · 디렉터 「처리하자」)
// 글이 한 건씩 쌓인다(디렉터 「쌓이는 방식으로」) — 고정 글 먼저, 그다음 최신 글이 위. 지점·달별로 모인다.
// 그 지점 구성원이 보고(다른 지점에는 안 보임), 원장·관리자와 원장이 지정한 직원이 올린다(디렉터 정정). 링크는 눌러서 연다.
// 고치기·지우기 = 쓴 사람 또는 원장·관리자, 고정 = 원장·관리자. 달이 바뀌면 부모가 key 로 새로 그린다.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Megaphone, Pencil, Pin, PinOff, Plus, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";

type Post = { id: string; content: string; pinned: boolean; authorName: string | null; createdAt: string; edited: boolean; canModify: boolean };
type Data = { branches: string[]; branch: string | null; posts: Post[]; canEdit: boolean; canManage: boolean };
const POST_MAX = 2000;
const URL_RE = /(https?:\/\/[^\s<>"'ㄱ-ㅎㅏ-ㅣ가-힣]+)/gi; // 주소 바로 뒤에 붙은 한글은 링크에서 뺀다
let lastBranch: string | null = null; // 달을 넘겨(다시 그려져)도 고른 지점을 이어 본다

// 글 속 http(s) 주소만 링크로 — innerHTML 을 쓰지 않는다
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) => {
        if (i % 2 === 0) return <span key={i}>{part}</span>;
        const m = part.match(/^(.*?)([.,)\]]*)$/); // 문장 끝 마침표·괄호는 링크에서 뺀다
        const url = m?.[1] || part;
        return (
          <span key={i}>
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline break-all">{url}</a>
            {m?.[2] || ""}
          </span>
        );
      })}
    </>
  );
}

type Cand = { id: string; name: string; position: string | null; jobGroup: string | null };

// 메모 작성자 지정 — 원장(담당 지점)·관리자만. 그 지점 재직 직원 중에서 고른다
function NoteEditors({ branch }: { branch: string }) {
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/work/calendar/note/editors?${new URLSearchParams({ branch })}`, { cache: "no-store" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "직원 목록을 불러오지 못했습니다."); return; }
    setCands(d.candidates || []);
    setSel(new Set(d.editorIds || []));
    setSaved(d.editorIds || []);
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/work/calendar/note/editors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, userIds: Array.from(sel) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "저장하지 못했습니다."); return; }
      setSaved(d.editorIds || []);
      setOpen(false);
      toast.success("작성자를 저장했습니다.");
    } finally { setBusy(false); }
  }

  const names = (cands ?? []).filter((c) => saved.includes(c.id)).map((c) => c.name);
  return (
    <div className="mt-4 pt-3 border-t">
      {!open ? (
        <button className="text-xs text-gray-500 hover:text-indigo-600 flex items-center gap-1" onClick={() => { setOpen(true); if (!cands) void load(); }}>
          <UserCog size={13} />작성자 지정{names.length ? ` · ${names.join(", ")}` : ""}
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">원장·관리자 말고도 이 지점 공유에 글을 올릴 수 있는 직원을 고르세요.</p>
          {!cands ? (
            <p className="text-xs text-gray-400">불러오는 중…</p>
          ) : cands.length === 0 ? (
            <p className="text-xs text-gray-400">이 지점에 지정할 수 있는 직원이 없습니다.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-1 border rounded-md p-2">
              {cands.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sel.has(c.id)}
                    onChange={(e) => setSel((prev) => { const n = new Set(prev); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })}
                  />
                  <span>{c.name}</span>
                  <span className="text-[11px] text-gray-400">{[c.jobGroup, c.position].filter(Boolean).join(" · ")}</span>
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => { setOpen(false); setSel(new Set(saved)); }} disabled={busy}>취소</Button>
            <Button size="sm" onClick={save} disabled={busy || !cands}>{busy ? "저장 중..." : "저장"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function CalendarNotePanel({ ym }: { ym: string }) {
  const [branch, setBranch] = useState<string | null>(lastBranch);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0); // 올리기·고치기·지우기 뒤 다시 불러오기
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    const q = new URLSearchParams({ ym });
    if (branch) q.set("branch", branch);
    fetch(`/api/work/calendar/note?${q}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Data | null) => {
        if (id !== reqId.current) return;
        if (d) setData(d); // 실패면 앞서 받은 것(지점 목록 포함)을 그대로 두고 안내만 한다
        setFailed(!d);
        setLoading(false);
      })
      .catch(() => { if (id === reqId.current) { setFailed(true); setLoading(false); } });
  }, [ym, branch, tick]);

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "처리하지 못했습니다."); return false; }
      setTick((t) => t + 1);
      return true;
    } catch {
      toast.error("처리하지 못했습니다. 인터넷 연결을 확인해 주세요.");
      return false;
    } finally { setBusy(false); }
  }

  async function create() {
    if (!data?.branch || !draft.trim()) return;
    if (await call("/api/work/calendar/note", "POST", { ym, branch: data.branch, content: draft })) {
      setDraft(""); setComposing(false); toast.success("올렸습니다.");
    }
  }
  async function saveEdit(id: string) {
    if (!editDraft.trim()) return;
    if (await call(`/api/work/calendar/note/${id}`, "PATCH", { content: editDraft })) { setEditId(null); toast.success("고쳤습니다."); }
  }
  async function togglePin(p: Post) {
    await call(`/api/work/calendar/note/${p.id}`, "PATCH", { pinned: !p.pinned });
  }
  async function remove(p: Post) {
    if (!window.confirm("이 글을 지울까요? 지운 글은 되살릴 수 없습니다.")) return;
    if (await call(`/api/work/calendar/note/${p.id}`, "DELETE")) toast.success("지웠습니다.");
  }

  const [y, m] = ym.split("-");
  const posts = data?.posts ?? [];
  const working = composing || editId !== null;

  return (
    <aside className="bg-white rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="font-semibold text-sm flex items-center gap-1.5"><Megaphone size={16} className="text-indigo-500" />이달의 지점 공유</h2>
        {data?.canEdit && data.branch && !working && !loading && !failed && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => { setComposing(true); setEditId(null); }}>
            <Plus size={12} />올리기
          </Button>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        {Number(y)}년 {Number(m)}월 · 우리 지점 구성원만 봅니다{data && !data.canManage && data.branch ? (data.canEdit ? " · 작성자로 지정됨" : " · 원장·지정된 분이 올립니다") : ""}
      </p>

      {data && data.branches.length > 1 && (
        <select
          className="w-full mb-3 border rounded-md px-2 py-1.5 text-sm bg-white"
          value={data.branch ?? ""}
          disabled={working}
          onChange={(e) => { lastBranch = e.target.value; setLoading(true); setBranch(e.target.value); }}
        >
          {data.branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      )}
      {data && data.branches.length === 1 && data.branch && <p className="text-xs text-gray-500 mb-2">{data.branch}</p>}

      {composing && (
        <div className="space-y-2 mb-3">
          <Textarea
            rows={5}
            value={draft}
            maxLength={POST_MAX}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            placeholder={"지점 구성원에게 알릴 내용을 한 건 적어 주세요.\n예) 이탈방어 강의영상 링크 https://..."}
            className="text-sm"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-400">{draft.length.toLocaleString()} / {POST_MAX.toLocaleString()}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setComposing(false); setDraft(""); }} disabled={busy}>취소</Button>
              <Button size="sm" onClick={create} disabled={busy || !draft.trim()}>{busy ? "올리는 중..." : "올리기"}</Button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">불러오는 중…</p>
      ) : failed ? (
        <p className="text-sm text-red-500">글을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</p>
      ) : !data || !data.branch ? (
        <p className="text-sm text-gray-400">소속 지점이 없어 볼 수 있는 글이 없습니다.</p>
      ) : posts.length === 0 ? (
        !composing && <p className="text-sm text-gray-400">이번 달 공유한 글이 아직 없습니다.{data.canEdit ? " 「올리기」를 눌러 지점 구성원에게 알릴 내용을 남겨 주세요." : ""}</p>
      ) : (
        // 고정 글 먼저, 그다음 최신 글이 위 — 아래로 쌓인다
        <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-0.5">
          {posts.map((p) => (
            <div key={p.id} className={`rounded-lg border p-3 ${p.pinned ? "border-amber-300 bg-amber-50/60" : "bg-gray-50/60"}`}>
              {p.pinned && <div className="text-[11px] text-amber-700 font-semibold mb-1 flex items-center gap-1"><Pin size={11} />고정</div>}
              {editId === p.id ? (
                <div className="space-y-2">
                  <Textarea rows={5} value={editDraft} maxLength={POST_MAX} autoFocus onChange={(e) => setEditDraft(e.target.value)} className="text-sm bg-white" />
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setEditId(null)} disabled={busy}>취소</Button>
                    <Button size="sm" onClick={() => saveEdit(p.id)} disabled={busy || !editDraft.trim()}>{busy ? "저장 중..." : "저장"}</Button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed"><Linkified text={p.content} /></div>
              )}
              <div className="flex items-center justify-between gap-2 mt-2">
                <span className="text-[11px] text-gray-400 truncate">{p.authorName || "알 수 없음"} · {fmtTime(p.createdAt)}{p.edited ? " (수정됨)" : ""}</span>
                {editId !== p.id && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    {data.canManage && (
                      <button className="p-1 rounded text-gray-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-40" title={p.pinned ? "고정 풀기" : "맨 위에 고정"} disabled={busy || working} onClick={() => togglePin(p)}>
                        {p.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                      </button>
                    )}
                    {p.canModify && (
                      <>
                        <button className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-40" title="고치기" disabled={busy || working} onClick={() => { setEditId(p.id); setEditDraft(p.content); }}><Pencil size={13} /></button>
                        <button className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40" title="지우기" disabled={busy || working} onClick={() => remove(p)}><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {/* 작성자 지정(원장·관리자) — 지점을 바꾸면 새로 그린다 */}
      {!loading && !failed && data?.canManage && data.branch && !working && <NoteEditors key={data.branch} branch={data.branch} />}
    </aside>
  );
}
