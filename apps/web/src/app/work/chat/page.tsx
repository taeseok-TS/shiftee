"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Send, Plus, Hash, User as UserIcon, Search, Smile, MessageCircle, Paperclip, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const EMOJIS = ["👍", "❤️", "😄", "😢", "👌", "🎉"];

type Channel = { id: string; name: string; type: "CHANNEL" | "DM"; isDefault: boolean; memberCount: number; unread: number; lastMessage: { content: string; createdAt: string } | null };
type Reaction = { emoji: string; count: number; mine: boolean };
type Message = { id: string; userId: string; userName: string; content: string; fileUrl: string | null; fileName: string | null; fileType: string | null; createdAt: string; mine: boolean; reactions: Reaction[]; replyCount: number };
type Employee = { id: string; name: string; branch?: string | null };

export default function WorkChatPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [readWatermark, setReadWatermark] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ parent: Message; replies: Message[] } | null>(null);
  const [threadInput, setThreadInput] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empSearch, setEmpSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  activeIdRef.current = activeId;

  const fetchChannels = useCallback(async () => {
    const res = await fetch("/api/work/channels");
    if (res.ok) {
      const data = await res.json();
      setChannels(data.channels || []);
      setActiveId((cur) => cur ?? data.channels?.[0]?.id ?? null);
    }
  }, []);

  const fetchMessages = useCallback(async (channelId: string) => {
    const res = await fetch(`/api/work/channels/${channelId}/messages`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages || []);
      setReadWatermark(data.readWatermark || null);
    }
  }, []);

  const markRead = useCallback(async (channelId: string) => {
    await fetch(`/api/work/channels/${channelId}/read`, { method: "POST" });
  }, []);

  useEffect(() => {
    fetchChannels();
    fetch("/api/employees").then(r => r.ok ? r.json() : { employees: [] }).then(d => setEmployees(d.employees || [])).catch(() => {});
  }, [fetchChannels]);

  // 활성 채널 진입 시 메시지 로드 + 읽음 처리
  useEffect(() => {
    if (!activeId) return;
    fetchMessages(activeId).then(() => markRead(activeId).then(fetchChannels));
  }, [activeId, fetchMessages, markRead, fetchChannels]);

  // SSE 실시간 수신
  useEffect(() => {
    const es = new EventSource("/api/work/stream");
    es.onmessage = (ev) => {
      let e: any;
      try { e = JSON.parse(ev.data); } catch { return; }
      const cur = activeIdRef.current;
      if (e.type === "message" || e.type === "reaction") {
        if (e.channelId === cur) {
          fetchMessages(cur).then(() => markRead(cur));
          if (threadId) refreshThread(threadId);
        }
        fetchChannels();
      } else if (e.type === "read") {
        if (e.channelId === cur) fetchMessages(cur);
      } else if (e.type === "typing") {
        if (e.channelId === cur) {
          setTypingUser(e.userName);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTypingUser(null), 3000);
        }
      }
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function onInputChange(v: string) {
    setInput(v);
    const now = Date.now();
    if (activeId && now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      fetch(`/api/work/channels/${activeId}/typing`, { method: "POST" });
    }
  }

  async function send() {
    if (!input.trim() || !activeId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/work/channels/${activeId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: input }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "전송 실패"); return; }
      setInput("");
      setMessages((m) => [...m, data.message]);
    } finally { setSending(false); }
  }

  async function uploadAndSend(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const up = await fetch("/api/work/upload", { method: "POST", body: fd });
    const upData = await up.json();
    if (!up.ok) { toast.error(upData.error || "업로드 실패"); return; }
    await fetch(`/api/work/channels/${activeId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "", fileUrl: upData.fileUrl, fileName: upData.fileName, fileType: upData.fileType }),
    });
    fetchMessages(activeId!);
  }

  async function toggleReaction(messageId: string, emoji: string) {
    setPickerFor(null);
    await fetch(`/api/work/messages/${messageId}/reactions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }),
    });
    if (activeId) fetchMessages(activeId);
  }

  async function refreshThread(parentId: string) {
    const res = await fetch(`/api/work/messages/${parentId}/replies`);
    if (res.ok) setThread(await res.json());
  }
  function openThread(parentId: string) { setThreadId(parentId); refreshThread(parentId); }
  function closeThread() { setThreadId(null); setThread(null); setThreadInput(""); }

  async function sendReply() {
    if (!threadInput.trim() || !threadId || !activeId) return;
    await fetch(`/api/work/channels/${activeId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: threadInput, parentId: threadId }),
    });
    setThreadInput("");
    refreshThread(threadId);
    fetchMessages(activeId);
  }

  async function createChannel() {
    if (!newName.trim()) { toast.error("채널 이름을 입력해주세요."); return; }
    const res = await fetch("/api/work/channels", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, type: "CHANNEL", memberIds: selectedMembers }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "생성 실패"); return; }
    toast.success("채널이 생성되었습니다.");
    setNewOpen(false); setNewName(""); setSelectedMembers([]); setEmpSearch("");
    await fetchChannels(); setActiveId(data.channel.id);
  }
  async function startDM(userId: string) {
    const res = await fetch("/api/work/channels", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "DM", memberIds: [userId] }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "실패"); return; }
    setNewOpen(false); setEmpSearch("");
    await fetchChannels(); setActiveId(data.channel.id);
  }

  const active = channels.find((c) => c.id === activeId);
  const filteredEmps = employees.filter((e) => !empSearch || e.name.includes(empSearch));

  const renderAttachment = (m: { fileUrl: string | null; fileName: string | null; fileType: string | null }) => {
    if (!m.fileUrl) return null;
    if (m.fileType === "image")
      return <a href={m.fileUrl} target="_blank" rel="noreferrer"><img src={m.fileUrl} alt={m.fileName || ""} className="max-w-[220px] rounded-lg mt-1" /></a>;
    return (
      <a href={m.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 mt-1 text-xs underline">
        <Paperclip size={12} />{m.fileName || "첨부파일"}
      </a>
    );
  };

  return (
    <div className="flex h-screen">
      {/* 채널 목록 */}
      <div className="w-72 border-r bg-white flex flex-col">
        <div className="px-4 py-4 border-b flex items-center justify-between">
          <h2 className="font-bold text-lg">채팅</h2>
          <Button size="sm" variant="ghost" onClick={() => setNewOpen(true)} className="gap-1"><Plus size={16} /></Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {channels.map((c) => (
            <button key={c.id} onClick={() => setActiveId(c.id)}
              className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 flex items-start gap-2 ${activeId === c.id ? "bg-indigo-50" : ""}`}>
              {c.type === "DM" ? <UserIcon size={16} className="mt-0.5 text-gray-400 shrink-0" /> : <Hash size={16} className="mt-0.5 text-gray-400 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate flex items-center justify-between gap-2">
                  <span className="truncate">{c.name}</span>
                  {c.unread > 0 && <span className="bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold shrink-0">{c.unread}</span>}
                </div>
                {c.lastMessage && <div className="text-xs text-gray-400 truncate">{c.lastMessage.content}</div>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 flex flex-col bg-gray-50 min-w-0">
        {active ? (
          <>
            <div className="px-6 py-4 border-b bg-white flex items-center gap-2">
              {active.type === "DM" ? <UserIcon size={18} /> : <Hash size={18} />}
              <span className="font-semibold">{active.name}</span>
              {active.type === "CHANNEL" && active.memberCount > 0 && <span className="text-xs text-gray-400">멤버 {active.memberCount}명</span>}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
              {messages.length === 0 ? (
                <div className="text-center text-gray-400 mt-10 text-sm">아직 메시지가 없습니다. 첫 메시지를 보내보세요!</div>
              ) : (
                messages.map((m) => {
                  const read = active.type === "DM" && m.mine && readWatermark && new Date(m.createdAt) <= new Date(readWatermark);
                  return (
                    <div key={m.id} className={`group flex ${m.mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[70%] flex flex-col ${m.mine ? "items-end" : "items-start"}`}>
                        {!m.mine && <span className="text-xs text-gray-500 mb-0.5 ml-1">{m.userName}</span>}
                        <div className="flex items-center gap-1">
                          {m.mine && (
                            <span className="text-[10px] text-gray-400 flex flex-col items-end mr-1 leading-tight">
                              {read && <span className="text-indigo-500">읽음</span>}
                              {format(new Date(m.createdAt), "HH:mm")}
                            </span>
                          )}
                          <div className={`rounded-2xl px-4 py-2 text-sm ${m.mine ? "bg-indigo-500 text-white" : "bg-white border"}`}>
                            {m.content && <span className="whitespace-pre-wrap">{m.content}</span>}
                            {renderAttachment(m)}
                          </div>
                          {/* 호버 액션 */}
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 relative">
                            <button onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)} className="text-gray-400 hover:text-gray-700"><Smile size={15} /></button>
                            <button onClick={() => openThread(m.id)} className="text-gray-400 hover:text-gray-700"><MessageCircle size={15} /></button>
                            {pickerFor === m.id && (
                              <div className="absolute bottom-6 left-0 z-10 bg-white border rounded-full shadow px-2 py-1 flex gap-1">
                                {EMOJIS.map((e) => (
                                  <button key={e} onClick={() => toggleReaction(m.id, e)} className="hover:scale-125 transition-transform">{e}</button>
                                ))}
                              </div>
                            )}
                          </div>
                          {!m.mine && <span className="text-[10px] text-gray-400 ml-1">{format(new Date(m.createdAt), "HH:mm")}</span>}
                        </div>
                        {/* 반응 칩 */}
                        {m.reactions.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {m.reactions.map((r) => (
                              <button key={r.emoji} onClick={() => toggleReaction(m.id, r.emoji)}
                                className={`text-xs rounded-full px-2 py-0.5 border ${r.mine ? "bg-indigo-100 border-indigo-300" : "bg-white border-gray-200"}`}>
                                {r.emoji} {r.count}
                              </button>
                            ))}
                          </div>
                        )}
                        {/* 댓글 수 */}
                        {m.replyCount > 0 && (
                          <button onClick={() => openThread(m.id)} className="text-xs text-indigo-500 mt-1 hover:underline">
                            답글 {m.replyCount}개
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              {typingUser && <div className="text-xs text-gray-400 italic mt-1">{typingUser}님이 입력 중…</div>}
            </div>

            <div className="px-4 py-3 border-t bg-white flex gap-2 items-center">
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndSend(f); e.target.value = ""; }} />
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} className="shrink-0"><Paperclip size={16} /></Button>
              <Input value={input} onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="메시지를 입력하세요..." />
              <Button onClick={send} disabled={sending || !input.trim()} className="gap-1 bg-indigo-500 hover:bg-indigo-600"><Send size={16} /></Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">채널을 선택하세요</div>
        )}
      </div>

      {/* 스레드(댓글) 패널 */}
      {threadId && thread && (
        <div className="w-80 border-l bg-white flex flex-col">
          <div className="px-4 py-4 border-b flex items-center justify-between">
            <span className="font-semibold">스레드</span>
            <button onClick={closeThread} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            <div className="border-b pb-3">
              <div className="text-xs text-gray-500 mb-0.5">{thread.parent.userName}</div>
              <div className="text-sm whitespace-pre-wrap">{thread.parent.content}</div>
              {renderAttachment(thread.parent)}
            </div>
            {thread.replies.map((r) => (
              <div key={r.id}>
                <div className="text-xs text-gray-500 mb-0.5">{r.userName} · {format(new Date(r.createdAt), "HH:mm")}</div>
                <div className="text-sm whitespace-pre-wrap">{r.content}</div>
                {renderAttachment(r)}
              </div>
            ))}
            {thread.replies.length === 0 && <div className="text-xs text-gray-400 text-center py-6">첫 댓글을 남겨보세요.</div>}
          </div>
          <div className="px-3 py-3 border-t flex gap-2">
            <Input value={threadInput} onChange={(e) => setThreadInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
              placeholder="댓글 입력..." />
            <Button onClick={sendReply} disabled={!threadInput.trim()} size="sm" className="bg-indigo-500 hover:bg-indigo-600"><Send size={14} /></Button>
          </div>
        </div>
      )}

      {/* 새 채팅 다이얼로그 */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>새 채팅</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">그룹 채널 만들기</label>
              <Input placeholder="채널 이름 (예: 마케팅팀)" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <p className="text-xs text-gray-400">멤버를 선택하면 그룹 채널, 이름 없이 한 명 '1:1 대화'를 누르면 DM이 시작됩니다.</p>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <Input className="pl-9" placeholder="직원 검색" value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} />
            </div>
            <div className="max-h-56 overflow-y-auto border rounded-lg divide-y">
              {filteredEmps.map((e) => (
                <div key={e.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedMembers.includes(e.id)}
                      onChange={(ev) => setSelectedMembers((prev) => ev.target.checked ? [...prev, e.id] : prev.filter((x) => x !== e.id))} />
                    {e.name}{e.branch && <span className="text-xs text-gray-400">· {e.branch}</span>}
                  </label>
                  <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => startDM(e.id)}>1:1 대화</Button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setNewOpen(false)}>취소</Button>
              <Button onClick={createChannel} disabled={!newName.trim()}>채널 만들기</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
