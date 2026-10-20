"use client";

// 캘린더 오른쪽 「이달의 지점 공유」(#222, 2026-10-20 권경욱 제안 · 디렉터 「처리하자」)
// 지점·달마다 메모 하나 — 그 지점 구성원이 보고(다른 지점에는 안 보임), 원장·관리자와 원장이 지정한 직원이 쓴다
// (2026-10-20 디렉터 정정: 「지점 메모는 원장이나 원장이 지정한 사람이 작성」). 링크는 눌러서 연다.
// 달이 바뀌면 부모가 key 로 새로 그린다(편집 중 상태가 다른 달로 넘어가지 않게).
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Megaphone, Pencil, UserCog } from "lucide-react";
import { toast } from "sonner";

type Note = { branches: string[]; branch: string | null; content: string; updatedAt: string | null; updatedByName: string | null; canEdit: boolean; canManage?: boolean };
const NOTE_MAX = 5000;
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
          <p className="text-xs text-gray-600">원장·관리자 말고도 이 메모를 쓸 수 있는 직원을 고르세요.</p>
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

export default function CalendarNotePanel({ ym }: { ym: string }) {
  const [branch, setBranch] = useState<string | null>(lastBranch);
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    const q = new URLSearchParams({ ym });
    if (branch) q.set("branch", branch);
    fetch(`/api/work/calendar/note?${q}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Note | null) => {
        if (id !== reqId.current) return;
        if (d) setNote(d); // 실패면 앞서 받은 것(지점 목록 포함)을 그대로 두고 안내만 한다
        setFailed(!d);
        setLoading(false);
      })
      .catch(() => { if (id === reqId.current) { setFailed(true); setLoading(false); } });
  }, [ym, branch]);

  async function save() {
    if (!note?.branch) return;
    setSaving(true);
    try {
      const res = await fetch("/api/work/calendar/note", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ym, branch: note.branch, content: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "저장하지 못했습니다."); return; }
      setNote({ ...note, content: data.content, updatedAt: data.updatedAt, updatedByName: data.updatedByName });
      setEditing(false);
      toast.success("저장했습니다.");
    } finally { setSaving(false); }
  }

  const [y, m] = ym.split("-");
  const updated = note?.updatedAt ? new Date(note.updatedAt) : null;

  return (
    <aside className="bg-white rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="font-semibold text-sm flex items-center gap-1.5"><Megaphone size={16} className="text-indigo-500" />이달의 지점 공유</h2>
        {note?.canEdit && note.branch && !editing && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => { setDraft(note.content); setEditing(true); }}>
            <Pencil size={12} />{note.content ? "편집" : "쓰기"}
          </Button>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mb-3">{Number(y)}년 {Number(m)}월 · 우리 지점 구성원만 봅니다{note && !note.canManage && note.branch ? (note.canEdit ? " · 작성자로 지정됨" : " · 원장·지정된 분이 씁니다") : ""}</p>

      {note && note.branches.length > 1 && (
        <select
          className="w-full mb-3 border rounded-md px-2 py-1.5 text-sm bg-white"
          value={note.branch ?? ""}
          disabled={editing}
          onChange={(e) => { lastBranch = e.target.value; setLoading(true); setBranch(e.target.value); }}
        >
          {note.branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      )}
      {note && note.branches.length === 1 && note.branch && <p className="text-xs text-gray-500 mb-2">{note.branch}</p>}

      {loading ? (
        <p className="text-sm text-gray-400">불러오는 중…</p>
      ) : failed ? (
        <p className="text-sm text-red-500">메모를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</p>
      ) : !note || !note.branch ? (
        <p className="text-sm text-gray-400">소속 지점이 없어 볼 수 있는 메모가 없습니다.</p>
      ) : editing ? (
        <div className="space-y-2">
          <Textarea
            rows={14}
            value={draft}
            maxLength={NOTE_MAX}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={"예)\n· 이탈방어 강의영상 링크 https://...\n· 이번 달 집중할 내용\n· 수요일 변동사항 마감\n· 금요일 주말등원일정 마감"}
            className="text-sm"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-400">{draft.length.toLocaleString()} / {NOTE_MAX.toLocaleString()}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>취소</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? "저장 중..." : "저장"}</Button>
            </div>
          </div>
        </div>
      ) : note.content ? (
        <>
          <div className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed"><Linkified text={note.content} /></div>
          {updated && (
            <p className="text-[11px] text-gray-400 mt-3">
              {updated.getMonth() + 1}/{updated.getDate()} {String(updated.getHours()).padStart(2, "0")}:{String(updated.getMinutes()).padStart(2, "0")} 수정{note.updatedByName ? ` · ${note.updatedByName}` : ""}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-400">이번 달 공유할 내용이 아직 없습니다.{note.canEdit ? " 「쓰기」를 눌러 지점 구성원에게 알릴 내용을 남겨 주세요." : ""}</p>
      )}
      {/* 작성자 지정(원장·관리자) — 지점을 바꾸면 새로 그린다 */}
      {!loading && !failed && note?.canManage && note.branch && !editing && <NoteEditors key={note.branch} branch={note.branch} />}
    </aside>
  );
}
