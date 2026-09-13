"use client";

// 환경설정 › AI 연결 키 — 개인 API 키 발급·목록·끄기 (2026-09-13 2단계). 본부가 허용한 계정에만 탭이 보인다.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KeyRound, Plus, Copy, Power, PlayCircle, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Key = {
  id: string; name: string; prefix: string; scopes: string[]; channelIds: string[]; expiresAt: string; lastUsedAt: string | null; lastUsedIp: string | null;
  suspendedAt: string | null; suspendReason: string | null; revokedAt: string | null; createdAt: string; status: "active" | "suspended" | "expired" | "revoked";
};
type Channel = { id: string; name: string; type: string };

const SCOPES: { id: string; label: string; hint: string }[] = [
  { id: "submissions:read", label: "자료제출 읽기", hint: "내야 할 것 · 내 제출 · 공유 자료" },
  { id: "submissions:write", label: "자료제출 쓰기", hint: "파일 올리고 제출" },
  { id: "chat:read", label: "채팅 읽기", hint: "내가 속한 방과 새 메시지" },
  { id: "chat:write", label: "채팅 쓰기", hint: "아래에서 고른 방에만 메시지 올리기 (🤖 표시가 붙습니다)" },
];
const scopeLabel = (s: string) => SCOPES.find((x) => x.id === s)?.label ?? s;
const statusChip: Record<Key["status"], [string, string]> = {
  active: ["사용 중", "bg-green-50 text-green-700 border-green-200"],
  suspended: ["멈춤", "bg-amber-50 text-amber-700 border-amber-200"],
  expired: ["만료", "bg-gray-100 text-gray-600 border-gray-200"],
  revoked: ["꺼짐", "bg-gray-100 text-gray-500 border-gray-200"],
};

export function ApiKeysPanel() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [create, setCreate] = useState(false);
  const [secret, setSecret] = useState<{ raw: string; name: string } | null>(null);
  const load = useCallback(() => {
    fetch("/api/me/api-keys").then((r) => r.json()).then((d) => setKeys(d.keys || [])).catch(() => setKeys([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function revoke(k: Key) {
    if (!confirm(`「${k.name}」 키를 끌까요? 이 키를 쓰던 AI·프로그램은 즉시 멈추고, 되돌릴 수 없습니다.`)) return;
    const res = await fetch(`/api/me/api-keys/${k.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("끄지 못했습니다."); return; }
    toast.success("껐습니다."); load();
  }
  async function resume(k: Key) {
    const res = await fetch(`/api/me/api-keys/${k.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resume: true }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "다시 켜지 못했습니다."); return; }
    toast.success("다시 켰습니다."); load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium flex items-center gap-1.5"><KeyRound size={15} className="text-indigo-600" />AI·외부 연결 키</p>
          <p className="text-xs text-gray-500 mt-1">Claude·ChatGPT 같은 AI 나 내가 만든 프로그램이 내 이름으로 자료제출·채팅을 쓰게 하는 열쇠입니다. 키로 한 일은 모두 내 이름으로 기록됩니다.</p>
        </div>
        <Button size="sm" className="gap-1 bg-indigo-600 hover:bg-indigo-700 shrink-0" onClick={() => setCreate(true)}><Plus size={14} />새 키 만들기</Button>
      </div>
      <a href="/api/v1/docs" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"><ExternalLink size={12} />AI 에게 알려줄 사용 안내 (/api/v1/docs)</a>

      {secret && (
        <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 text-sm space-y-2">
          <p className="font-medium text-amber-800">「{secret.name}」 키가 만들어졌습니다. 지금 한 번만 보입니다 — 복사해서 안전한 곳에 두세요. 창을 닫으면 다시 볼 수 없습니다.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all text-xs bg-white border rounded px-2 py-1.5">{secret.raw}</code>
            <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => { navigator.clipboard.writeText(secret.raw).then(() => toast.success("복사했습니다.")).catch(() => toast.error("복사하지 못했습니다. 직접 선택해 복사해주세요.")); }}><Copy size={13} />복사</Button>
          </div>
          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSecret(null)}>복사했습니다, 닫기</Button>
        </div>
      )}

      {!keys ? <p className="text-sm text-gray-500">불러오는 중…</p>
        : !keys.length ? <p className="text-sm text-gray-500 py-4 text-center border rounded-lg">아직 만든 키가 없습니다.</p>
        : keys.map((k) => {
          const [label, cls] = statusChip[k.status];
          return (
            <div key={k.id} className={`border rounded-lg p-3 text-sm ${k.status === "revoked" || k.status === "expired" ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{k.name} <span className={`ml-1 inline-block px-2 py-0.5 rounded-full text-[11px] border ${cls}`}>{label}</span></p>
                  <p className="text-xs text-gray-500 mt-0.5 break-all">cbt_pk_{k.prefix}… · {k.scopes.map(scopeLabel).join(" · ")}{k.channelIds.length ? ` · 방 ${k.channelIds.length}개` : ""}</p>
                  <p className="text-xs text-gray-500">{k.lastUsedAt ? `마지막 사용 ${format(new Date(k.lastUsedAt), "M/d HH:mm")}${k.lastUsedIp ? ` · ${k.lastUsedIp}` : ""}` : "아직 사용 안 함"} · {k.revokedAt ? `${format(new Date(k.revokedAt), "M/d")} 끔` : `만료 ${format(new Date(k.expiresAt), "yyyy-MM-dd")}`}</p>
                  {k.suspendedAt && <p className="text-xs text-amber-700 mt-1">이상 사용({k.suspendReason})으로 멈췄습니다. 본인이 쓴 것이 맞으면 다시 켜고, 아니면 끄고 새로 만드세요.</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  {k.status === "suspended" && <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => resume(k)}><PlayCircle size={12} />다시 켜기</Button>}
                  {(k.status === "active" || k.status === "suspended") && <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600" onClick={() => revoke(k)}><Power size={12} />끄기</Button>}
                </div>
              </div>
            </div>
          );
        })}
      <p className="text-[11px] text-gray-400">키가 새면 즉시 끄고 새로 만드세요. 키는 10개까지, 기본 90일(최대 1년)이며 비밀번호가 초기화되면 전부 꺼집니다.</p>
      {create && <CreateDialog onClose={() => setCreate(false)} onCreated={(raw, name) => { setCreate(false); setSecret({ raw, name }); load(); }} />}
    </div>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (raw: string, name: string) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["submissions:read", "submissions:write"]);
  const [ttl, setTtl] = useState("90");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/work/channels").then((r) => r.json()).then((d) => setChannels((d.channels || []).map((c: { id: string; name: string; displayName?: string; type: string }) => ({ id: c.id, name: c.displayName || c.name, type: c.type })))).catch(() => {});
  }, []);
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/me/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, scopes, ttlDays: Number(ttl), channelIds: picked, consent }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "만들지 못했습니다."); return; }
      onCreated(d.secret, name);
    } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>새 키 만들기</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div><label className="text-xs text-gray-500">용도 (필수)</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 과제 자동 제출 (Claude)" maxLength={60} /></div>
          <div>
            <label className="text-xs text-gray-500">권한</label>
            <div className="space-y-1.5 mt-1">
              {SCOPES.map((s) => (
                <label key={s.id} className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={scopes.includes(s.id)} onChange={() => setScopes(toggle(scopes, s.id))} />
                  <span><span className="font-medium">{s.label}</span> <span className="text-xs text-gray-500">— {s.hint}</span></span>
                </label>
              ))}
            </div>
          </div>
          {scopes.includes("chat:write") && (
            <div>
              <label className="text-xs text-gray-500">메시지를 올릴 방 (내가 속한 방만, 하나 이상)</label>
              <div className="flex flex-wrap gap-1.5 mt-1 max-h-40 overflow-y-auto">
                {channels.map((c) => (
                  <button key={c.id} type="button" onClick={() => setPicked(toggle(picked, c.id))}
                    className={`px-2.5 py-1 rounded-md border text-xs ${picked.includes(c.id) ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-300 bg-white text-gray-700"}`}>
                    {c.type === "DM" ? "1:1 " : "# "}{c.name}
                  </button>
                ))}
                {!channels.length && <span className="text-xs text-gray-400">방 목록을 불러오는 중…</span>}
              </div>
            </div>
          )}
          <div><label className="text-xs text-gray-500">만료</label>
            <select className="block h-9 rounded-md border border-gray-300 bg-white px-2 text-sm" value={ttl} onChange={(e) => setTtl(e.target.value)}>
              <option value="30">30일</option><option value="90">90일 (기본)</option><option value="180">180일</option><option value="365">1년</option>
            </select></div>
          <label className="flex items-start gap-2 text-xs text-gray-700 bg-gray-50 border rounded p-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>이 키로 한 일은 본인이 한 것으로 기록되며, 키를 남에게 주면 그 사람이 내 이름으로 행동하게 됩니다. 키는 지금 한 번만 표시되고 다시 볼 수 없습니다.</span>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button disabled={saving || !name.trim() || !scopes.length || !consent || (scopes.includes("chat:write") && !picked.length)} className="bg-indigo-600 hover:bg-indigo-700" onClick={save}>{saving ? "만드는 중…" : "만들기"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
