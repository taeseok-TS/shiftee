"use client";

// 이모티콘(채팅 스티커) 관리 — 2026-09-29 디렉터 지시: 관리자가 세트를 더 올릴 수 있게.
// 세트 만들기 → 그림 여러 장 올리기(PNG·GIF·JPG·WebP, 3MB 이하, 움직이는 GIF 가능) → 켜기/숨기기·순서·이름.
// 이미 보낸 이모티콘은 지울 수 없다(보낸 메시지의 그림이 깨진다) — [숨기기]만 된다.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2, Upload } from "lucide-react";

type Item = { id: string; name: string; url: string; animated: boolean; isActive: boolean; sortOrder: number; sentCount: number };
type EmoSet = { id: string; name: string; isActive: boolean; sortOrder: number; items: Item[] };

export default function AdminEmoticonsPage() {
  const [sets, setSets] = useState<EmoSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/emoticons");
    const d = await res.json().catch(() => ({}));
    if (res.ok) setSets(d.sets || []);
    else toast.error(d.error || "불러오지 못했습니다.");
    setLoading(false);
  }, []);
  // 첫 불러오기 — 상태는 응답을 받은 뒤(비동기 콜백)에만 바꾼다
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/emoticons")
      .then(async (res) => ({ res, d: await res.json().catch(() => ({})) }))
      .then(({ res, d }) => {
        if (!alive) return;
        if (res.ok) setSets(d.sets || []);
        else toast.error(d.error || "불러오지 못했습니다.");
        setLoading(false);
      })
      .catch(() => { if (alive) { toast.error("불러오지 못했습니다."); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  async function call(url: string, init: RequestInit, ok?: string) {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "처리하지 못했습니다."); return false; }
      if (ok) toast.success(ok);
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }
  const json = (method: string, body: unknown): RequestInit => ({
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  async function createSet() {
    const n = newName.trim();
    if (!n) return;
    if (await call("/api/admin/emoticons", json("POST", { name: n }), "세트를 만들었습니다.")) setNewName("");
  }
  async function upload(setId: string, files: FileList | null) {
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    await call(`/api/admin/emoticons/${setId}/items`, { method: "POST", body: fd }, `${files.length}개를 올렸습니다.`);
  }
  // 순서 바꾸기 — 바뀐 전체 순서를 한 번에 보낸다(번호가 같아도 확실히 바뀐다)
  const moved = <T,>(arr: T[], i: number, j: number) => { const a = arr.slice(); [a[i], a[j]] = [a[j], a[i]]; return a; };
  async function moveSet(i: number, j: number) {
    await call("/api/admin/emoticons", json("PUT", { setIds: moved(sets, i, j).map((x) => x.id) }));
  }
  async function moveItem(st: EmoSet, i: number, j: number) {
    await call(`/api/admin/emoticons/${st.id}/items`, json("PUT", { itemIds: moved(st.items, i, j).map((x) => x.id) }));
  }
  async function renameItem(it: Item) {
    const n = window.prompt("이모티콘 이름 (마우스를 올리면 보입니다)", it.name);
    if (n === null || !n.trim() || n.trim() === it.name) return;
    await call(`/api/admin/emoticons/items/${it.id}`, json("PATCH", { name: n.trim() }), "이름을 바꿨습니다.");
  }
  async function renameSet(st: EmoSet) {
    const n = window.prompt("세트 이름", st.name);
    if (n === null || !n.trim() || n.trim() === st.name) return;
    await call(`/api/admin/emoticons/${st.id}`, json("PATCH", { name: n.trim() }), "세트 이름을 바꿨습니다.");
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">이모티콘 관리</h1>
        <p className="text-sm text-gray-500 mt-1">
          큐브티워크 채팅에서 보내는 이모티콘 세트입니다. 켜진 세트가 채팅 입력창의 이모티콘 창에 순서대로 나옵니다.
          그림은 PNG·GIF·JPG·WebP(3MB 이하, 한 번에 30장)를 올릴 수 있습니다. <b>움직이는 이모티콘은 GIF로</b> 올려 주세요 —
          움직이는 WebP·PNG 는 웹에서만 움직이고 휴대폰 앱에서는 멈춰 보입니다.
          정사각형·배경 투명 그림이 가장 보기 좋습니다.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 flex gap-2 items-center">
          <Input placeholder="새 세트 이름 (예: 듀리 움직이는 이모티콘)" value={newName} maxLength={30}
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") createSet(); }} />
          <Button onClick={createSet} disabled={busy || !newName.trim()}><Plus size={16} className="mr-1" />세트 만들기</Button>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-sm text-gray-400">불러오는 중…</div>
      ) : sets.length === 0 ? (
        <div className="text-sm text-gray-400">아직 세트가 없습니다. 위에서 세트를 만든 뒤 그림을 올려 주세요.</div>
      ) : sets.map((st, si) => (
        <Card key={st.id} className={st.isActive ? "" : "opacity-60"}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <button className="font-semibold text-lg hover:underline" onClick={() => renameSet(st)} title="이름 바꾸기">{st.name}</button>
              <span className="text-xs text-gray-400">{st.items.length}개{st.isActive ? "" : " · 숨김"}</span>
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="ghost" disabled={busy || si === 0} onClick={() => moveSet(si, si - 1)} title="위로"><ArrowUp size={14} /></Button>
                <Button size="sm" variant="ghost" disabled={busy || si === sets.length - 1} onClick={() => moveSet(si, si + 1)} title="아래로"><ArrowDown size={14} /></Button>
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => call(`/api/admin/emoticons/${st.id}`, json("PATCH", { isActive: !st.isActive }), st.isActive ? "세트를 숨겼습니다." : "세트를 켰습니다.")}>
                  {st.isActive ? <><EyeOff size={14} className="mr-1" />숨기기</> : <><Eye size={14} className="mr-1" />켜기</>}
                </Button>
                <input type="file" multiple accept="image/png,image/gif,image/jpeg,image/webp" className="hidden"
                  ref={(el) => { fileRefs.current[st.id] = el; }}
                  onChange={(e) => { upload(st.id, e.target.files); e.target.value = ""; }} />
                <Button size="sm" disabled={busy} onClick={() => fileRefs.current[st.id]?.click()}><Upload size={14} className="mr-1" />그림 올리기</Button>
                {st.items.every((i) => i.sentCount === 0) && (
                  <Button size="sm" variant="ghost" className="text-red-500" disabled={busy}
                    onClick={() => { if (window.confirm(`「${st.name}」 세트를 지울까요? 그림 ${st.items.length}개도 함께 지워집니다.`)) call(`/api/admin/emoticons/${st.id}`, { method: "DELETE" }, "세트를 지웠습니다."); }}>
                    <Trash2 size={14} />
                  </Button>
                )}
              </div>
            </div>
            {st.items.length === 0 ? (
              <div className="text-xs text-gray-400">그림이 없습니다. [그림 올리기]로 여러 장을 한 번에 올릴 수 있습니다.</div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2">
                {st.items.map((it, ii) => (
                  <div key={it.id} className={`border rounded-lg p-1.5 flex flex-col items-center gap-1 ${it.isActive ? "" : "opacity-40"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.url} alt={it.name} className="w-20 h-20 object-contain" />
                    <button className="text-[11px] text-gray-700 truncate max-w-full hover:underline" title="이름 바꾸기" onClick={() => renameItem(it)}>
                      {it.name}{it.animated ? (it.url.endsWith(".gif") ? " · 움직임" : " · 움직임(웹만)") : ""}
                    </button>
                    <div className="text-[10px] text-gray-400">{it.sentCount ? `${it.sentCount}번 보냄` : "보낸 적 없음"}</div>
                    <div className="flex items-center">
                      <button disabled={busy || ii === 0} onClick={() => moveItem(st, ii, ii - 1)} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="앞으로"><ArrowUp size={12} className="-rotate-90" /></button>
                      <button disabled={busy || ii === st.items.length - 1} onClick={() => moveItem(st, ii, ii + 1)} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="뒤로"><ArrowDown size={12} className="-rotate-90" /></button>
                      <button disabled={busy} onClick={() => call(`/api/admin/emoticons/items/${it.id}`, json("PATCH", { isActive: !it.isActive }))}
                        className="p-1 text-gray-400 hover:text-gray-700" title={it.isActive ? "숨기기" : "켜기"}>
                        {it.isActive ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      {it.sentCount === 0 && (
                        <button disabled={busy} className="p-1 text-red-400 hover:text-red-600" title="지우기"
                          onClick={() => { if (window.confirm(`「${it.name}」을(를) 지울까요?`)) call(`/api/admin/emoticons/items/${it.id}`, { method: "DELETE" }, "지웠습니다."); }}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
