"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Paperclip, X } from "lucide-react";
import { toast } from "sonner";

// 「한 번에 보내기」(2026-10-26 디렉터 승인) — 관리자가 여러 사람·여러 채팅방에 같은 글을 한 번에 보낸다.
// 받는 쪽(사람·방)과 내용을 한 창에서 고르고, 아래 버튼 하나로 보낸다(별도 확인창 없음 — 클릭 최소화).
// 사람은 /api/work/members, 방은 /api/work/channels 의 그룹방(CHANNEL)만. 서버는 /api/work/broadcast.
const MAX_USERS = 200;
const MAX_CHANNELS = 30;
const HQ = "본부";

type Member = { id: string; name: string; branch?: string | null; position?: string | null; role?: string | null };
type Channel = { id: string; name: string; type: "CHANNEL" | "DM"; isDefault: boolean; memberCount: number };
type Result = { sentUsers: number; sentChannels: number; failed: string[] };
// 내 그룹(디렉터 10/26 「나중에 또 보낼 수 있으니 대상 묶음을 본인만의 그룹으로」) — /api/work/broadcast/groups.
// validUserIds·validChannelIds 는 서버가 지금 보낼 수 있다고 본 것(퇴사·방 삭제로 빠진 대상은 저장 수보다 적다)
type SavedGroup = { id: string; name: string; userIds: string[]; channelIds: string[]; updatedAt: string; validUserIds: string[]; validChannelIds: string[] };
const MAX_GROUP_NAME = 30;

export default function BroadcastDialog({ open, onOpenChange, onSent }: { open: boolean; onOpenChange: (v: boolean) => void; onSent?: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [search, setSearch] = useState("");
  const [chSearch, setChSearch] = useState(""); // 채팅방 검색(디렉터 10/26 — 사람만 검색되고 방은 안 됐다)
  const [selUsers, setSelUsers] = useState<Set<string>>(new Set());
  const [selChannels, setSelChannels] = useState<Set<string>>(new Set());
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  // 내 그룹 — 목록, 「저장」 입력칸 펼침 여부·이름, 저장 중, 결과 화면에서 저장한 그룹 이름(저장 뒤 입력칸 대신 보여 준다)
  const [myGroups, setMyGroups] = useState<SavedGroup[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  // 상태는 한 번의 렌더 뒤에 바뀐다 — 연타해도 같은 것을 다시 보내지 않게 ref 로 잠근다(채팅 화면과 같은 방식)
  const sendingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 열릴 때마다 목록을 새로 가져온다(직원·방이 바뀌어 있을 수 있다)
  const openRef = useRef(false); // 늦게 오는 응답이 닫힌 창의 상태를 건드리지 않게
  useEffect(() => {
    openRef.current = open;
    if (!open) return;
    fetch("/api/work/members").then((r) => (r.ok ? r.json() : { members: [] })).then((d) => setMembers(d.members || [])).catch(() => {});
    fetch("/api/work/channels").then((r) => (r.ok ? r.json() : { channels: [] })).then((d) => setChannels((d.channels || []).filter((c: Channel) => c.type === "CHANNEL"))).catch(() => {});
    loadGroups();
  }, [open]);

  // 내 그룹 목록 — 열 때와 저장 뒤에 다시 읽는다(유효 대상 수는 서버가 셈)
  function loadGroups() {
    fetch("/api/work/broadcast/groups")
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || ""); return d; })
      .then((d) => setMyGroups(Array.isArray(d.groups) ? d.groups : []))
      .catch((e) => toast.error(e instanceof Error && e.message ? e.message : "내 그룹을 불러오지 못했습니다"));
  }

  function reset() {
    setSearch(""); setChSearch(""); setSelUsers(new Set()); setSelChannels(new Set()); setContent(""); setFile(null); setResult(null);
    setSaveOpen(false); setGroupName(""); setSavingGroup(false); setSavedAs(null);
    setSending(false); sendingRef.current = false;
  }
  function handleOpenChange(v: boolean) {
    if (!v && sendingRef.current) return; // 보내는 중에는 닫지 않는다
    if (!v) reset();
    onOpenChange(v);
  }

  // 빠른 묶음 — 관리자(ADMIN)는 묶음에 넣지 않는다(기본 목록에서 숨기는 사람과 같은 기준, 검색해서 개별로 고를 수 있다)
  const groups = useMemo(() => {
    const staff = members.filter((m) => m.role !== "ADMIN");
    const list: { key: string; label: string; ids: string[] }[] = [
      { key: "managers", label: "원장 전원", ids: staff.filter((m) => m.role === "MANAGER").map((m) => m.id) },
      { key: "branch-staff", label: "지점 직원 전원", ids: staff.filter((m) => m.role === "EMPLOYEE" && m.branch !== HQ).map((m) => m.id) },
      { key: "hq", label: HQ, ids: staff.filter((m) => m.branch === HQ).map((m) => m.id) },
    ];
    const branches = Array.from(new Set(staff.map((m) => m.branch).filter((b): b is string => !!b && b !== HQ))).sort((a, b) => a.localeCompare(b, "ko"));
    for (const b of branches) list.push({ key: `branch:${b}`, label: `${b} 전체`, ids: staff.filter((m) => m.branch === b).map((m) => m.id) });
    return list.filter((g) => g.ids.length > 0);
  }, [members]);

  const q = search.trim().toLowerCase();
  // 새 채팅 화면 관례 — 관리자는 검색어가 있을 때만 노출
  const shownMembers = members.filter((m) => (q ? m.name.toLowerCase().includes(q) || (m.branch ?? "").toLowerCase().includes(q) : m.role !== "ADMIN"));
  const cq = chSearch.trim().toLowerCase();
  const shownChannels = cq ? channels.filter((c) => c.name.toLowerCase().includes(cq)) : channels;

  const toggleUser = (id: string, on: boolean) => setSelUsers((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  const toggleChannel = (id: string, on: boolean) => setSelChannels((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  // 칩 토글 — 켜면 그 묶음 전원 체크, 끄면 해제
  const toggleGroup = (ids: string[]) => setSelUsers((prev) => {
    const allOn = ids.every((id) => prev.has(id));
    const n = new Set(prev);
    for (const id of ids) { if (allOn) n.delete(id); else n.add(id); }
    return n;
  });

  const nUsers = selUsers.size;
  const nChannels = selChannels.size;
  const overLimit = nUsers > MAX_USERS || nChannels > MAX_CHANNELS;
  const hasBody = !!content.trim() || !!file;
  const canSend = !sending && !overLimit && nUsers + nChannels > 0 && hasBody;

  // 그룹 칩 클릭 — 그 그룹의 사람·방을 **현재 선택으로 바꿔 넣는다**(더하지 않는다). 지금 유효한 id 만 넣고 빠진 건 알려 준다
  function applyGroup(g: SavedGroup) {
    setSelUsers(new Set(g.validUserIds));
    setSelChannels(new Set(g.validChannelIds));
    const dropped = (g.userIds.length - g.validUserIds.length) + (g.channelIds.length - g.validChannelIds.length);
    if (dropped > 0) toast.info(`퇴사·삭제로 ${dropped}건은 뺐습니다`);
  }
  const deletingRef = useRef(false); // × 더블클릭이면 두 번째 DELETE 가 404 toast 를 띄운다(검증)
  async function deleteGroup(g: SavedGroup) {
    if (deletingRef.current) return;
    deletingRef.current = true;
    try {
      const res = await fetch("/api/work/broadcast/groups", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: g.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "그룹을 지우지 못했습니다"); return; }
      setMyGroups((prev) => prev.filter((x) => x.id !== g.id));
      toast.success(`${g.name} 그룹을 지웠습니다`);
    } catch {
      toast.error("그룹을 지우지 못했습니다");
    } finally {
      deletingRef.current = false;
    }
  }
  // 현재 선택(selUsers·selChannels)을 그룹으로 저장 — 고르는 화면·보낸 뒤 결과 화면 둘 다 이 함수를 쓴다(결과 화면에서도 선택은 닫기 전까지 남아 있다)
  async function saveGroup() {
    const name = groupName.trim();
    if (!name || savingGroup || nUsers + nChannels === 0) return;
    setSavingGroup(true);
    try {
      const res = await fetch("/api/work/broadcast/groups", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, userIds: Array.from(selUsers), channelIds: Array.from(selChannels) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "그룹을 저장하지 못했습니다"); return; }
      toast.success(data.updated ? `${name} 그룹을 갱신했습니다` : `${name} 그룹으로 저장했습니다`);
      if (!openRef.current) return; // 응답 전에 창을 닫았으면 reset 뒤 상태를 되살리지 않는다(검증)
      setSaveOpen(false); setGroupName(""); setSavedAs(name);
      loadGroups();
    } catch {
      toast.error("그룹을 저장하지 못했습니다");
    } finally {
      setSavingGroup(false);
    }
  }
  const canSaveGroup = !savingGroup && !!groupName.trim() && nUsers + nChannels > 0;
  // 칩 꼬리 — 저장 수보다 유효 수가 적으면 「(2명·1방 빠짐)」
  const missingLabel = (g: SavedGroup) => {
    const mu = g.userIds.length - g.validUserIds.length;
    const mc = g.channelIds.length - g.validChannelIds.length;
    if (mu <= 0 && mc <= 0) return "";
    return `(${[mu > 0 ? `${mu}명` : "", mc > 0 ? `${mc}방` : ""].filter(Boolean).join("·")} 빠짐)`;
  };
  // 이름 입력칸 + 저장(+취소) — 고르는 화면(펼침·취소 있음)과 결과 화면(항상 펼침·취소 없음) 공용. 별도 Dialog 를 띄우지 않는다(Dialog 안 Dialog 는 피한다)
  const groupNameForm = (withCancel: boolean) => (
    <div className="flex items-center gap-1.5">
      <Input className="h-8 text-sm" placeholder="그룹 이름" value={groupName} maxLength={MAX_GROUP_NAME} autoFocus
        onChange={(e) => setGroupName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveGroup(); } }} />
      <Button type="button" size="sm" onClick={saveGroup} disabled={!canSaveGroup}>{savingGroup ? "저장 중…" : "저장"}</Button>
      {withCancel && <Button type="button" size="sm" variant="ghost" onClick={() => { setSaveOpen(false); setGroupName(""); }} disabled={savingGroup}>취소</Button>}
    </div>
  );

  async function send() {
    if (sendingRef.current || !canSend) return;
    sendingRef.current = true;
    setSending(true);
    setSavedAs(null); // 고르는 화면에서 저장한 뒤 선택을 바꿔 보냈으면 결과 화면에서 다시 저장할 수 있게(검증)
    try {
      let attach: { fileUrl: string; fileName: string; fileType: string } | null = null;
      if (file) {
        // 채팅 화면의 업로드와 같은 방식 — POST /api/work/upload FormData "file"
        const fd = new FormData();
        fd.append("file", file);
        const up = await fetch("/api/work/upload", { method: "POST", body: fd });
        const upData = await up.json().catch(() => ({}));
        if (!up.ok || !upData?.fileUrl) { toast.error(upData?.error || "업로드 실패"); return; }
        attach = { fileUrl: upData.fileUrl, fileName: upData.fileName, fileType: upData.fileType };
      }
      const res = await fetch("/api/work/broadcast", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: Array.from(selUsers), channelIds: Array.from(selChannels), content: content.trim(), ...(attach ?? {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "보내기 실패"); return; }
      setResult({ sentUsers: data.sentUsers ?? 0, sentChannels: data.sentChannels ?? 0, failed: Array.isArray(data.failed) ? data.failed : [] });
      onSent?.();
    } catch {
      toast.error("보내기 실패");
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>한 번에 보내기</DialogTitle></DialogHeader>
        {result ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-gray-50 px-4 py-3 text-sm">
              <p className="font-medium">{result.sentUsers}명 · {result.sentChannels}개 방에 보냈습니다</p>
              {result.failed.length > 0 && <p className="mt-1 text-red-600">실패: {result.failed.join(", ")}</p>}
            </div>
            {/* 보낸 대상을 바로 그룹으로(디렉터 요구의 핵심) — 선택은 닫기 전까지 남아 있어 그대로 저장한다 */}
            {nUsers + nChannels > 0 && (
              <div className="space-y-1.5">
                {savedAs ? (
                  <p className="text-xs text-gray-500">「{savedAs}」 그룹으로 저장했습니다. 다음에 「내 그룹」에서 바로 꺼내 쓸 수 있습니다.</p>
                ) : (
                  <>
                    <label className="text-sm font-medium">이 대상을 그룹으로 저장 <span className="text-xs font-normal text-gray-400">({nUsers}명 · {nChannels}방)</span></label>
                    {groupNameForm(false)}
                  </>
                )}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={() => handleOpenChange(false)}>닫기</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            {/* 내 그룹 — 칩 클릭=그 묶음을 현재 선택으로, hover 때 × 로 삭제(확인창 없음), 줄 끝에 「현재 선택을 그룹으로 저장」 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium">내 그룹 <span className="text-xs font-normal text-gray-400">({myGroups.length}개)</span></label>
                {!saveOpen && (
                  <button type="button" onClick={() => setSaveOpen(true)} disabled={nUsers + nChannels === 0}
                    className="text-xs text-indigo-600 hover:underline disabled:text-gray-400 disabled:no-underline">
                    현재 선택을 그룹으로 저장
                  </button>
                )}
              </div>
              {saveOpen && groupNameForm(true)}
              {myGroups.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {myGroups.map((g) => {
                    const missing = missingLabel(g);
                    return (
                      <span key={g.id} className="group inline-flex items-center rounded-full border border-gray-300 bg-white text-xs text-gray-600 hover:bg-gray-50">
                        <button type="button" onClick={() => applyGroup(g)} title="이 그룹의 사람·방을 현재 선택으로 바꿔 넣기" className="pl-2.5 py-0.5 pr-1">
                          {g.name} <span className="text-gray-400">{g.userIds.length}명·{g.channelIds.length}방</span>
                          {missing && <span className="ml-1 text-gray-400">{missing}</span>}
                        </button>
                        <button type="button" onClick={() => deleteGroup(g)} title={`${g.name} 그룹 지우기`}
                          className="mr-1 rounded-full p-0.5 text-gray-400 opacity-40 transition-opacity hover:text-red-600 group-hover:opacity-100 focus:opacity-100">
                          <X size={12} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-400">저장한 그룹이 없습니다. 사람·채팅방을 고른 뒤 「현재 선택을 그룹으로 저장」을 누르면 다음에 바로 꺼내 쓸 수 있습니다.</p>
              )}
            </div>

            {/* 사람 */}
            <div className="space-y-2">
              <label className="text-sm font-medium">사람 <span className="text-xs font-normal text-gray-400">({nUsers}명 선택)</span></label>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((g) => {
                  const on = g.ids.every((id) => selUsers.has(id));
                  return (
                    <button key={g.key} type="button" onClick={() => toggleGroup(g.ids)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${on ? "border-indigo-500 bg-indigo-600 text-white" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"}`}>
                      {g.label} {g.ids.length}
                    </button>
                  );
                })}
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <Input className="pl-9" placeholder="이름 · 지점 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="max-h-44 overflow-y-auto border rounded-lg divide-y">
                {shownMembers.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" checked={selUsers.has(m.id)} onChange={(ev) => toggleUser(m.id, ev.target.checked)} />
                    {m.name}{m.branch && <span className="text-xs text-gray-400">· {m.branch}</span>}{m.position && <span className="text-xs text-gray-400">· {m.position}</span>}
                  </label>
                ))}
                {shownMembers.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">해당하는 사람이 없습니다.</p>}
              </div>
              {/* 고른 사람 이름 — 검색어를 지우면 목록에서 안 보이는 사람(관리자 등)도 누가 받는지 보이게(검증 지적) */}
              {nUsers > 0 && (
                <p className="text-xs text-gray-500 leading-5">
                  받는 사람: {members.filter((m) => selUsers.has(m.id)).slice(0, 15).map((m) => m.name).join(", ")}
                  {nUsers > 15 && ` 외 ${nUsers - 15}명`}
                  <button type="button" onClick={() => setSelUsers(new Set())} className="ml-2 text-indigo-600 hover:underline">모두 지우기</button>
                </p>
              )}
            </div>

            {/* 채팅방 */}
            <div className="space-y-2">
              <label className="text-sm font-medium">채팅방 <span className="text-xs font-normal text-gray-400">({nChannels}개 선택)</span></label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <Input className="pl-9" placeholder="채팅방 이름 검색" value={chSearch} onChange={(e) => setChSearch(e.target.value)} />
              </div>
              <div className="max-h-36 overflow-y-auto border rounded-lg divide-y">
                {shownChannels.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" checked={selChannels.has(c.id)} onChange={(ev) => toggleChannel(c.id, ev.target.checked)} />
                    {c.name}<span className="text-xs text-gray-400">· {c.memberCount}명</span>
                  </label>
                ))}
                {shownChannels.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">{channels.length === 0 ? "들어가 있는 그룹방이 없습니다." : "해당하는 채팅방이 없습니다."}</p>}
              </div>
            </div>

            {/* 내용 */}
            <div className="space-y-2">
              <label className="text-sm font-medium">내용</label>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="보낼 글 (글 또는 첨부 중 하나는 필요합니다)" rows={4} maxLength={4000} />
              <div className="flex items-center gap-2 text-sm">
                <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => fileInputRef.current?.click()} disabled={sending}>
                  <Paperclip size={14} /> 첨부 1개
                </Button>
                {file && (
                  <span className="flex items-center gap-1 min-w-0 text-gray-600">
                    <span className="truncate">{file.name}</span>
                    <button type="button" onClick={() => setFile(null)} className="text-gray-400 hover:text-gray-700" title="첨부 빼기"><X size={14} /></button>
                  </span>
                )}
              </div>
            </div>

            {overLimit && (
              <p className="text-xs text-red-600">한 번에 사람 {MAX_USERS}명 · 채팅방 {MAX_CHANNELS}개까지 보낼 수 있습니다. 줄여 주세요.</p>
            )}
            <div className="flex justify-end">
              <Button onClick={send} disabled={!canSend}>
                {sending ? "보내는 중…" : `${nUsers}명 · ${nChannels}개 방에 보내기`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
