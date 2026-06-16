"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Send, Plus, Hash, User as UserIcon, Search } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Channel = {
  id: string;
  name: string;
  type: "CHANNEL" | "DM";
  isDefault: boolean;
  memberCount: number;
  lastMessage: { content: string; createdAt: string } | null;
};
type Message = {
  id: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
  mine: boolean;
};
type Employee = { id: string; name: string; branch?: string | null };

export default function WorkChatPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empSearch, setEmpSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    }
  }, []);

  useEffect(() => {
    fetchChannels();
    fetch("/api/employees").then(r => r.ok ? r.json() : { employees: [] }).then(d => setEmployees(d.employees || [])).catch(() => {});
  }, [fetchChannels]);

  // 활성 채널 메시지 폴링 (3초)
  useEffect(() => {
    if (!activeId) return;
    fetchMessages(activeId);
    const t = setInterval(() => fetchMessages(activeId), 3000);
    return () => clearInterval(t);
  }, [activeId, fetchMessages]);

  // 새 메시지 오면 스크롤 하단
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    if (!input.trim() || !activeId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/work/channels/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: input }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "전송 실패"); return; }
      setInput("");
      setMessages((m) => [...m, data.message]);
    } finally {
      setSending(false);
    }
  }

  async function createChannel() {
    if (!newName.trim()) { toast.error("채널 이름을 입력해주세요."); return; }
    const res = await fetch("/api/work/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, type: "CHANNEL", memberIds: selectedMembers }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "생성 실패"); return; }
    toast.success("채널이 생성되었습니다.");
    setNewOpen(false); setNewName(""); setSelectedMembers([]); setEmpSearch("");
    await fetchChannels();
    setActiveId(data.channel.id);
  }

  async function startDM(userId: string) {
    const res = await fetch("/api/work/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "DM", memberIds: [userId] }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "실패"); return; }
    setNewOpen(false); setEmpSearch("");
    await fetchChannels();
    setActiveId(data.channel.id);
  }

  const active = channels.find((c) => c.id === activeId);
  const filteredEmps = employees.filter((e) => !empSearch || e.name.includes(empSearch));

  return (
    <div className="flex h-screen">
      {/* 채널 목록 */}
      <div className="w-72 border-r bg-white flex flex-col">
        <div className="px-4 py-4 border-b flex items-center justify-between">
          <h2 className="font-bold text-lg">채팅</h2>
          <Button size="sm" variant="ghost" onClick={() => setNewOpen(true)} className="gap-1">
            <Plus size={16} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {channels.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 flex items-start gap-2 ${activeId === c.id ? "bg-indigo-50" : ""}`}
            >
              {c.type === "DM" ? <UserIcon size={16} className="mt-0.5 text-gray-400 shrink-0" /> : <Hash size={16} className="mt-0.5 text-gray-400 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{c.name}</div>
                {c.lastMessage && <div className="text-xs text-gray-400 truncate">{c.lastMessage.content}</div>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 flex flex-col bg-gray-50">
        {active ? (
          <>
            <div className="px-6 py-4 border-b bg-white flex items-center gap-2">
              {active.type === "DM" ? <UserIcon size={18} /> : <Hash size={18} />}
              <span className="font-semibold">{active.name}</span>
              {active.type === "CHANNEL" && <span className="text-xs text-gray-400">멤버 {active.memberCount}명</span>}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {messages.length === 0 ? (
                <div className="text-center text-gray-400 mt-10 text-sm">아직 메시지가 없습니다. 첫 메시지를 보내보세요!</div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] ${m.mine ? "items-end" : "items-start"} flex flex-col`}>
                      {!m.mine && <span className="text-xs text-gray-500 mb-0.5 ml-1">{m.userName}</span>}
                      <div className={`rounded-2xl px-4 py-2 text-sm ${m.mine ? "bg-indigo-500 text-white" : "bg-white border"}`}>
                        {m.content}
                      </div>
                      <span className="text-[10px] text-gray-400 mt-0.5 mx-1">{format(new Date(m.createdAt), "HH:mm")}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-4 py-3 border-t bg-white flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="메시지를 입력하세요..."
              />
              <Button onClick={send} disabled={sending || !input.trim()} className="gap-1 bg-indigo-500 hover:bg-indigo-600">
                <Send size={16} />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">채널을 선택하세요</div>
        )}
      </div>

      {/* 새 대화/채널 다이얼로그 */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>새 채팅</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">그룹 채널 만들기</label>
              <Input placeholder="채널 이름 (예: 마케팅팀)" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <p className="text-xs text-gray-400">멤버를 아래에서 선택하면 그룹 채널, 이름 없이 한 명만 누르면 1:1 대화가 시작됩니다.</p>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <Input className="pl-9" placeholder="직원 검색" value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} />
            </div>
            <div className="max-h-56 overflow-y-auto border rounded-lg divide-y">
              {filteredEmps.map((e) => (
                <div key={e.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(e.id)}
                      onChange={(ev) => setSelectedMembers((prev) => ev.target.checked ? [...prev, e.id] : prev.filter((x) => x !== e.id))}
                    />
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
