"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Send, Plus, Hash, User as UserIcon, Search, Smile, MessageCircle, Paperclip, X, Bell, BellOff, AtSign, Download, Link as LinkIcon, ExternalLink, Pin, Settings, UserPlus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const EMOJIS = ["👍", "❤️", "😄", "😢", "👌", "🎉"];
const NOTIFY_LABEL: Record<string, string> = { ALL: "모든 메시지", MENTION: "멘션만", MUTE: "음소거" };

// @멘션 하이라이트 렌더링
function renderContent(text: string) {
  if (!text) return null;
  const parts = text.split(/(@[가-힣A-Za-z0-9_]+)/g);
  return parts.map((p, i) =>
    p.startsWith("@")
      ? <span key={i} className="text-indigo-300 font-semibold bg-indigo-500/20 rounded px-0.5">{p}</span>
      : <span key={i}>{p}</span>
  );
}

type Channel = { id: string; name: string; type: "CHANNEL" | "DM"; isDefault: boolean; memberCount: number; unread: number; notify: string; pinned: boolean; canManage: boolean; amCreator: boolean; labelText: string | null; labelColor: string | null; lastMessage: { content: string; createdAt: string } | null };
type TrashChannel = { id: string; name: string; deletedAt: string; permanentlyDeletedAt: string; labelText: string | null; labelColor: string | null };
const LABEL_COLORS = ["#eab308", "#ef4444", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899", "#6b7280"];
type ChannelMember = { userId: string; name: string; branch?: string | null; position?: string | null; isCreator: boolean; isManager: boolean };
type ChannelFile = { messageId: string; fileUrl: string; fileName: string | null; fileType: string | null; userName: string; createdAt: string };
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
  // 채널 관리 (이름 변경 / 멤버 / 고정)
  const [manageOpen, setManageOpen] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [channelMembers, setChannelMembers] = useState<ChannelMember[]>([]);
  const [addIds, setAddIds] = useState<string[]>([]);
  const [addSearch, setAddSearch] = useState("");
  const [labelTextVal, setLabelTextVal] = useState("");
  const [labelColorVal, setLabelColorVal] = useState(LABEL_COLORS[0]);
  const [addHistory, setAddHistory] = useState<"all" | "90days" | "none">("all");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashChannels, setTrashChannels] = useState<TrashChannel[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myName, setMyName] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [memberViewOpen, setMemberViewOpen] = useState(false);
  const [viewMembers, setViewMembers] = useState<ChannelMember[]>([]);
  const [filesOpen, setFilesOpen] = useState(false);
  const [channelFiles, setChannelFiles] = useState<ChannelFile[]>([]);
  const [confirmCleanOpen, setConfirmCleanOpen] = useState(false);
  // 멘션 자동완성
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // 검색
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; channelId: string; channelName: string; userName: string; content: string; createdAt: string }[]>([]);
  // 알림 설정 메뉴
  const [notifyMenuOpen, setNotifyMenuOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => { if (d?.user) { setIsAdmin(d.user.role === "ADMIN"); setMyName(d.user.name || ""); } }).catch(() => {});
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
    // @멘션 자동완성: 마지막 토큰이 @로 시작하면 쿼리 추출
    const m = v.match(/@([가-힣A-Za-z0-9_]*)$/);
    setMentionQuery(m ? m[1] : null);
    const now = Date.now();
    if (activeId && now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      fetch(`/api/work/channels/${activeId}/typing`, { method: "POST" });
    }
  }

  function pickMention(name: string) {
    setInput((cur) => cur.replace(/@([가-힣A-Za-z0-9_]*)$/, `@${name} `));
    setMentionQuery(null);
    inputRef.current?.focus();
  }

  // 메시지 검색 (디바운스)
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/work/search?q=${encodeURIComponent(searchQuery)}`);
      if (res.ok) setSearchResults((await res.json()).results || []);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  async function setNotify(value: string) {
    if (!activeId) return;
    setNotifyMenuOpen(false);
    await fetch(`/api/work/channels/${activeId}/notify`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notify: value }),
    });
    fetchChannels();
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
    setUploadProgress(0);
    // 진행률 표시를 위해 XHR 사용 (fetch는 업로드 진행 이벤트 미지원)
    const upData: any = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/work/upload");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        try { const j = JSON.parse(xhr.responseText); resolve(xhr.status >= 200 && xhr.status < 300 ? j : { _error: j.error }); }
        catch { resolve({ _error: "업로드 실패" }); }
      };
      xhr.onerror = () => resolve({ _error: "네트워크 오류" });
      xhr.send(fd);
    });
    setUploadProgress(null);
    if (!upData || upData._error) { toast.error(upData?._error || "업로드 실패"); return; }
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

  async function openManage() {
    if (!activeId || !active) return;
    setRenameVal(active.name);
    setLabelTextVal(active.labelText || "");
    setLabelColorVal(active.labelColor || LABEL_COLORS[0]);
    setAddIds([]); setAddSearch(""); setAddHistory("all");
    setManageOpen(true);
    const res = await fetch(`/api/work/channels/${activeId}/members`);
    if (res.ok) { const d = await res.json(); setChannelMembers(d.members || []); }
  }
  async function saveLabel(clear = false) {
    if (!activeId) return;
    const res = await fetch(`/api/work/channels/${activeId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clear ? { labelText: "", labelColor: "" } : { labelText: labelTextVal.trim(), labelColor: labelColorVal }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "라벨 저장 실패"); return; }
    if (clear) setLabelTextVal("");
    toast.success(clear ? "라벨을 해제했습니다." : "라벨이 적용되었습니다.");
    fetchChannels();
  }
  async function deleteChannel() {
    if (!activeId) return;
    const res = await fetch(`/api/work/channels/${activeId}`, { method: "DELETE" });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "삭제 실패"); return; }
    toast.success("채널이 삭제되었습니다. (휴지통에서 30일간 복구 가능)");
    setConfirmDeleteOpen(false); setManageOpen(false);
    setActiveId(null);
    await fetchChannels();
  }
  async function openTrash() {
    setTrashOpen(true);
    const res = await fetch("/api/work/channels/trash");
    if (res.ok) setTrashChannels((await res.json()).channels || []);
  }
  async function restoreChannel(id: string) {
    const res = await fetch(`/api/work/channels/${id}/restore`, { method: "POST" });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "복구 실패"); return; }
    toast.success("채널이 복구되었습니다.");
    setTrashChannels((prev) => prev.filter((c) => c.id !== id));
    fetchChannels();
  }
  // 멤버 목록 보기 (참여자 누구나, 읽기 전용)
  async function openMemberView() {
    if (!activeId) return;
    setMemberViewOpen(true);
    const res = await fetch(`/api/work/channels/${activeId}/members`);
    if (res.ok) setViewMembers((await res.json()).members || []);
  }
  // 방장 지정/해제 (생성자/관리자)
  async function assignManager(userId: string, makeManager: boolean) {
    if (!activeId) return;
    const res = await fetch(`/api/work/channels/${activeId}/manager`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, isManager: makeManager }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "변경 실패"); return; }
    toast.success(makeManager ? "방장으로 지정했습니다." : "방장을 해제했습니다.");
    setChannelMembers((prev) => prev.map((m) => m.userId === userId ? { ...m, isManager: makeManager } : m));
    fetchChannels();
  }
  // DM 삭제
  async function deleteDM(ch: Channel) {
    if (!confirm("이 대화를 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/work/channels/${ch.id}`, { method: "DELETE" });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "삭제 실패"); return; }
    toast.success("대화를 삭제했습니다.");
    setActiveId(null); fetchChannels();
  }
  // 파일 정리
  async function openFiles() {
    if (!activeId) return;
    setFilesOpen(true);
    const res = await fetch(`/api/work/channels/${activeId}/files`);
    if (res.ok) setChannelFiles((await res.json()).files || []);
  }
  async function cleanFiles() {
    if (!activeId) return;
    const res = await fetch(`/api/work/channels/${activeId}/files`, { method: "DELETE" });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "정리 실패"); return; }
    toast.success(`첨부파일 ${d.removed}개를 정리했습니다.`);
    setConfirmCleanOpen(false); setFilesOpen(false); setChannelFiles([]);
    if (activeId) fetchMessages(activeId);
  }
  async function renameChannel() {
    if (!activeId || !renameVal.trim()) return;
    const res = await fetch(`/api/work/channels/${activeId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: renameVal.trim() }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "이름 변경 실패"); return; }
    toast.success("채널 이름이 변경되었습니다.");
    fetchChannels();
  }
  async function addMembers() {
    if (!activeId || addIds.length === 0) return;
    const res = await fetch(`/api/work/channels/${activeId}/members`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userIds: addIds, historyOption: addHistory }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "멤버 추가 실패"); return; }
    toast.success("멤버가 추가되었습니다.");
    setAddIds([]); setAddSearch("");
    const m = await fetch(`/api/work/channels/${activeId}/members`); if (m.ok) setChannelMembers((await m.json()).members || []);
    fetchChannels();
  }
  async function removeMember(userId: string) {
    if (!activeId) return;
    const res = await fetch(`/api/work/channels/${activeId}/members`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "내보내기 실패"); return; }
    setChannelMembers((prev) => prev.filter((x) => x.userId !== userId));
    fetchChannels();
  }
  async function togglePin(ch: Channel) {
    const res = await fetch(`/api/work/channels/${ch.id}/pin`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: !ch.pinned }),
    });
    if (res.ok) { toast.success(!ch.pinned ? "상단에 고정했습니다." : "고정을 해제했습니다."); fetchChannels(); }
  }

  const active = channels.find((c) => c.id === activeId);
  const filteredEmps = employees.filter((e) => !empSearch || e.name.includes(empSearch));
  const memberIdSet = new Set(channelMembers.map((m) => m.userId));
  const addCandidates = employees.filter((e) => !memberIdSet.has(e.id) && (!addSearch || e.name.includes(addSearch)));

  const copyLink = (url: string) => {
    const full = `${window.location.origin}${url}`;
    navigator.clipboard?.writeText(full).then(
      () => toast.success("링크가 복사되었습니다."),
      () => toast.error("링크 복사에 실패했습니다.")
    );
  };

  const renderAttachment = (m: { fileUrl: string | null; fileName: string | null; fileType: string | null }) => {
    if (!m.fileUrl) return null;
    const isImg = m.fileType === "image";
    return (
      <div className="mt-1">
        {isImg ? (
          <a href={m.fileUrl} target="_blank" rel="noreferrer">
            <img src={m.fileUrl} alt={m.fileName || ""} className="max-w-[220px] rounded-lg" />
          </a>
        ) : (
          <div className="flex items-center gap-2 text-xs font-medium">
            <Paperclip size={14} />
            <span className="truncate max-w-[180px]">{m.fileName || "첨부파일"}</span>
          </div>
        )}
        <div className="flex items-center gap-3 mt-1.5 text-[11px] opacity-80">
          <a href={m.fileUrl} download={m.fileName || ""} className="flex items-center gap-1 hover:underline">
            <Download size={12} /> 다운로드
          </a>
          <button type="button" onClick={() => copyLink(m.fileUrl!)} className="flex items-center gap-1 hover:underline">
            <LinkIcon size={12} /> 링크 복사
          </button>
          <a href={m.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:underline">
            <ExternalLink size={12} /> 열기
          </a>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen">
      {/* 채널 목록 */}
      <div className="w-72 border-r bg-white flex flex-col">
        <div className="px-4 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="font-bold text-lg">채팅</h2>
            {myName && <span className="text-xs text-indigo-700 bg-indigo-50 rounded-full px-2 py-0.5 truncate">{myName}님</span>}
          </div>
          <div className="flex items-center">
            <Button size="sm" variant="ghost" onClick={openTrash} className="gap-1 text-gray-400 hover:text-gray-700" title="휴지통"><Trash2 size={16} /></Button>
            <Button size="sm" variant="ghost" onClick={() => setNewOpen(true)} className="gap-1" title="새 채팅"><Plus size={16} /></Button>
          </div>
        </div>
        <div className="px-3 py-2 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 text-gray-400" size={14} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="메시지 검색"
              className="w-full pl-8 pr-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-300"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* 검색 모드 */}
          {searchQuery.trim() ? (
            searchResults.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-8">검색 결과가 없습니다.</div>
            ) : (
              searchResults.map((r) => (
                <button key={r.id} onClick={() => { setActiveId(r.channelId); setSearchQuery(""); }}
                  className="w-full text-left px-4 py-3 border-b hover:bg-gray-50">
                  <div className="text-xs text-indigo-500 mb-0.5"># {r.channelName}</div>
                  <div className="text-sm truncate">{r.content}</div>
                  <div className="text-[10px] text-gray-400">{r.userName} · {format(new Date(r.createdAt), "MM/dd HH:mm")}</div>
                </button>
              ))
            )
          ) : (
          channels.map((c) => (
            <button key={c.id} onClick={() => setActiveId(c.id)}
              className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 flex items-start gap-2 ${activeId === c.id ? "bg-indigo-50" : ""}`}>
              {c.type === "DM" ? <UserIcon size={16} className="mt-0.5 text-gray-400 shrink-0" />
                : c.labelText ? <span className="mt-0.5 shrink-0 text-white text-[10px] font-bold rounded px-1.5 py-0.5 leading-5" style={{ backgroundColor: c.labelColor || "#6b7280" }}>{c.labelText}</span>
                : <Hash size={16} className="mt-0.5 text-gray-400 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate flex items-center justify-between gap-2">
                  <span className="truncate flex items-center gap-1">{c.pinned && <Pin size={11} className="text-indigo-500 fill-indigo-500 shrink-0" />}{c.notify === "MUTE" && <BellOff size={11} className="text-gray-400" />}{c.name}</span>
                  {c.unread > 0 && <span className="bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold shrink-0">{c.unread}</span>}
                </div>
                {c.lastMessage && <div className="text-xs text-gray-400 truncate">{c.lastMessage.content}</div>}
              </div>
            </button>
          )))}
        </div>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 flex flex-col bg-gray-50 min-w-0">
        {active ? (
          <>
            <div className="px-6 py-4 border-b bg-white flex items-center gap-2">
              {active.type === "DM" ? <UserIcon size={18} />
                : active.labelText ? <span className="text-white text-xs font-bold rounded px-2 py-0.5" style={{ backgroundColor: active.labelColor || "#6b7280" }}>{active.labelText}</span>
                : <Hash size={18} />}
              <span className="font-semibold">{active.name}</span>
              {active.type === "CHANNEL" && active.memberCount > 0 && (
                <button onClick={openMemberView} className="text-xs text-gray-400 hover:text-indigo-600 hover:underline" title="멤버 보기">멤버 {active.memberCount}명</button>
              )}
              <div className="ml-auto flex items-center gap-1">
              {/* 상단 고정 */}
              <button onClick={() => togglePin(active)} title={active.pinned ? "고정 해제" : "상단 고정"}
                className={`p-1.5 rounded hover:bg-gray-100 ${active.pinned ? "text-indigo-600" : "text-gray-400"}`}>
                <Pin size={16} className={active.pinned ? "fill-indigo-600" : ""} />
              </button>
              {/* DM 삭제 */}
              {active.type === "DM" && (
                <button onClick={() => deleteDM(active)} title="대화 삭제"
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
              )}
              {/* 채널 관리 (그룹 채널: 권한자 / 전체 채널: 관리자) */}
              {active.type === "CHANNEL" && ((active.canManage && !active.isDefault) || (active.isDefault && isAdmin)) && (
                <button onClick={openManage} title="채널 관리"
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><Settings size={16} /></button>
              )}
              {/* 알림 설정 */}
              <div className="relative">
                <button onClick={() => setNotifyMenuOpen((v) => !v)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100">
                  {active.notify === "MUTE" ? <BellOff size={15} /> : <Bell size={15} />}
                  {NOTIFY_LABEL[active.notify] || "알림"}
                </button>
                {notifyMenuOpen && (
                  <div className="absolute right-0 top-8 z-20 bg-white border rounded-lg shadow py-1 w-32">
                    {(["ALL", "MENTION", "MUTE"] as const).map((v) => (
                      <button key={v} onClick={() => setNotify(v)}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${active.notify === v ? "text-indigo-600 font-medium" : ""}`}>
                        {NOTIFY_LABEL[v]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              </div>
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
                            {m.content && <span className="whitespace-pre-wrap">{renderContent(m.content)}</span>}
                            {renderAttachment(m)}
                          </div>
                          {/* 호버 액션 */}
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 relative">
                            <button onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)} className="text-gray-400 hover:text-gray-700"><Smile size={15} /></button>
                            <button onClick={() => openThread(m.id)} className="text-gray-400 hover:text-gray-700"><MessageCircle size={15} /></button>
                            {pickerFor === m.id && (
                              <div className={`absolute top-7 ${m.mine ? "right-0" : "left-0"} z-10 bg-white border rounded-full shadow px-2 py-1 flex gap-1`}>
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

            {/* 파일 업로드 진행률 */}
            {uploadProgress !== null && (
              <div className="px-4 pt-2 bg-white border-t">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                  <Paperclip size={12} /> 파일 업로드 중… <b className="text-indigo-600">{uploadProgress}%</b>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}

            <div className="px-4 py-3 border-t bg-white flex gap-2 items-center relative">
              {/* @멘션 자동완성 드롭다운 */}
              {mentionQuery !== null && (() => {
                const cands = employees.filter((e) => e.name.includes(mentionQuery)).slice(0, 6);
                if (cands.length === 0) return null;
                return (
                  <div className="absolute bottom-14 left-12 z-20 bg-white border rounded-lg shadow w-48 max-h-52 overflow-y-auto">
                    <div className="px-3 py-1.5 text-[10px] text-gray-400 border-b flex items-center gap-1"><AtSign size={11} />멘션할 사람</div>
                    {cands.map((e) => (
                      <button key={e.id} onClick={() => pickMention(e.name)} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50">
                        {e.name}{e.branch && <span className="text-xs text-gray-400"> · {e.branch}</span>}
                      </button>
                    ))}
                  </div>
                );
              })()}
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndSend(f); e.target.value = ""; }} />
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} className="shrink-0"><Paperclip size={16} /></Button>
              <Input ref={inputRef} value={input} onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && mentionQuery === null) { e.preventDefault(); send(); } }}
                placeholder="메시지를 입력하세요... (@로 멘션)" />
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

      {/* 채널 관리: 이름 변경 / 멤버 / 내보내기 */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>채널 관리</DialogTitle></DialogHeader>
          <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
            {!active?.isDefault && (<>
            {/* 이름 변경 */}
            <div className="space-y-2">
              <label className="text-sm font-medium">채널 이름</label>
              <div className="flex gap-2">
                <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} placeholder="채널 이름" />
                <Button onClick={renameChannel} disabled={!renameVal.trim() || renameVal.trim() === active?.name}>변경</Button>
              </div>
            </div>

            {/* 라벨(# 대신 색+텍스트 표시) */}
            <div className="space-y-2">
              <label className="text-sm font-medium">채널 표시 (# 대신 라벨)</label>
              <div className="flex gap-2 items-center">
                <Input value={labelTextVal} onChange={(e) => setLabelTextVal(e.target.value)} placeholder="예: 지점 (비우면 # 유지)" maxLength={6} />
                <Button onClick={() => saveLabel(false)} disabled={!labelTextVal.trim()}>적용</Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">색상</span>
                {LABEL_COLORS.map((col) => (
                  <button key={col} type="button" onClick={() => setLabelColorVal(col)}
                    className={`w-6 h-6 rounded-full border-2 ${labelColorVal === col ? "border-gray-800" : "border-transparent"}`}
                    style={{ backgroundColor: col }} />
                ))}
                {active?.labelText && (
                  <button type="button" onClick={() => saveLabel(true)} className="ml-auto text-xs text-gray-500 hover:underline">라벨 해제</button>
                )}
              </div>
              {labelTextVal.trim() && (
                <div className="text-xs text-gray-500 flex items-center gap-1">
                  미리보기: <span className="text-white text-[10px] font-bold rounded px-1.5 py-0.5" style={{ backgroundColor: labelColorVal }}>{labelTextVal.trim()}</span> {active?.name}
                </div>
              )}
            </div>
            </>)}

            {/* 현재 멤버 */}
            <div className="space-y-2">
              <label className="text-sm font-medium">멤버 {channelMembers.length}명</label>
              <div className="max-h-40 overflow-y-auto border rounded-lg divide-y">
                {channelMembers.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-gray-400">멤버 정보를 불러오는 중…</div>
                ) : channelMembers.map((m) => (
                  <div key={m.userId} className="flex items-center justify-between px-3 py-2 text-sm gap-2">
                    <span className="flex items-center gap-1 truncate">
                      {m.name}
                      {m.isCreator && <span className="text-[10px] text-indigo-500 border border-indigo-200 rounded px-1">생성자</span>}
                      {m.isManager && !m.isCreator && <span className="text-[10px] text-amber-600 border border-amber-300 rounded px-1">방장</span>}
                      {m.branch && <span className="text-xs text-gray-400">· {m.branch}</span>}
                    </span>
                    {!m.isCreator && (
                      <div className="flex items-center gap-1 shrink-0">
                        {(isAdmin || active?.amCreator) && (
                          <Button size="sm" variant="ghost" className="text-xs h-7 text-amber-600 hover:text-amber-700" onClick={() => assignManager(m.userId, !m.isManager)}>
                            {m.isManager ? "방장 해제" : "방장 지정"}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="text-xs h-7 text-red-500 hover:text-red-600" onClick={() => removeMember(m.userId)}>
                          내보내기
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 멤버 추가 */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1"><UserPlus size={14} /> 멤버 추가</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <Input className="pl-9" placeholder="직원 검색" value={addSearch} onChange={(e) => setAddSearch(e.target.value)} />
              </div>
              <div className="max-h-40 overflow-y-auto border rounded-lg divide-y">
                {addCandidates.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-gray-400">추가할 수 있는 직원이 없습니다.</div>
                ) : addCandidates.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={addIds.includes(e.id)}
                      onChange={(ev) => setAddIds((prev) => ev.target.checked ? [...prev, e.id] : prev.filter((x) => x !== e.id))} />
                    {e.name}{e.branch && <span className="text-xs text-gray-400">· {e.branch}</span>}
                  </label>
                ))}
              </div>
              {/* 과거 채팅기록 열람 범위 */}
              <div className="space-y-1 bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-600">추가되는 멤버의 이전 채팅기록 열람</p>
                {([
                  { v: "all", label: "이전 채팅기록 전체 보이기" },
                  { v: "90days", label: "최근 90일 이내 채팅만 보이기" },
                  { v: "none", label: "이전 채팅기록 없이 추가 (가입 이후만)" },
                ] as const).map((o) => (
                  <label key={o.v} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
                    <input type="radio" name="addHistory" checked={addHistory === o.v} onChange={() => setAddHistory(o.v)} />
                    {o.label}
                  </label>
                ))}
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={addMembers} disabled={addIds.length === 0}>{addIds.length > 0 ? `${addIds.length}명 추가` : "추가"}</Button>
              </div>
            </div>

            {/* 첨부파일 정리 */}
            <div className="border-t pt-4">
              <Button variant="outline" className="w-full gap-1" onClick={openFiles}>
                <Paperclip size={15} /> 첨부파일 정리
              </Button>
            </div>

            {/* 채널 삭제 */}
            {!active?.isDefault && (
              <div className="pt-1">
                <Button variant="outline" className="w-full text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
                  onClick={() => setConfirmDeleteOpen(true)}>
                  <Trash2 size={15} /> 채널 삭제
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 멤버 보기 (읽기 전용, 누구나) */}
      <Dialog open={memberViewOpen} onOpenChange={setMemberViewOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>멤버 {viewMembers.length}명</DialogTitle></DialogHeader>
          <div className="max-h-80 overflow-y-auto border rounded-lg divide-y">
            {viewMembers.length === 0 ? (
              <div className="px-3 py-4 text-xs text-gray-400">멤버 정보를 불러오는 중…</div>
            ) : viewMembers.map((m) => (
              <div key={m.userId} className="flex items-center gap-1 px-3 py-2 text-sm">
                {m.name}
                {m.isCreator && <span className="text-[10px] text-indigo-500 border border-indigo-200 rounded px-1">생성자</span>}
                {m.isManager && !m.isCreator && <span className="text-[10px] text-amber-600 border border-amber-300 rounded px-1">방장</span>}
                {m.branch && <span className="text-xs text-gray-400">· {m.branch}</span>}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* 첨부파일 정리 */}
      <Dialog open={filesOpen} onOpenChange={setFilesOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>첨부파일 정리</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">이 채팅방의 첨부파일 <b>{channelFiles.length}개</b>. 채팅방은 유지되고 파일만 삭제됩니다.</p>
            <div className="max-h-56 overflow-y-auto border rounded-lg divide-y">
              {channelFiles.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-gray-400">첨부파일이 없습니다.</div>
              ) : channelFiles.map((f) => (
                <div key={f.messageId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <Paperclip size={13} className="text-gray-400 shrink-0" />
                  <span className="truncate flex-1">{f.fileName || "파일"}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">{f.userName}</span>
                </div>
              ))}
            </div>
            {channelFiles.length > 0 && (
              <div className="flex gap-2 justify-end">
                <a href={`/api/work/channels/${activeId}/files/download`}>
                  <Button variant="outline" className="gap-1"><Download size={14} /> 압축 다운로드</Button>
                </a>
                <Button className="bg-red-600 hover:bg-red-700 text-white gap-1" onClick={() => setConfirmCleanOpen(true)}>
                  <Trash2 size={14} /> 파일 정리
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 파일 정리 확인 */}
      <Dialog open={confirmCleanOpen} onOpenChange={setConfirmCleanOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>첨부파일 정리</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-800 font-medium">정리하기 전 다운받으시겠습니까?</p>
            <p className="text-sm text-gray-500">정리하면 이 채팅방의 첨부파일이 모두 삭제됩니다(채팅 내용은 유지). 필요하면 먼저 압축 다운로드하세요.</p>
            <div className="flex gap-2 justify-end">
              <a href={`/api/work/channels/${activeId}/files/download`}>
                <Button variant="outline" className="gap-1"><Download size={14} /> 압축 다운로드</Button>
              </a>
              <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={cleanFiles}>정리(삭제)</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>채널 삭제</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-800 font-medium">정말로 삭제하시겠습니까?</p>
            <p className="text-sm text-gray-500">해당 채팅은 30일간 보관하니, 쓰레기통에서 다시 복구 시킬 수 있습니다.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>취소</Button>
              <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={deleteChannel}>삭제</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 휴지통 */}
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>휴지통 (삭제된 채널)</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-gray-400">삭제 후 30일간 보관되며, 복구할 수 있습니다.</p>
            <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
              {trashChannels.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-gray-400">휴지통이 비어 있습니다.</div>
              ) : trashChannels.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate flex items-center gap-1">
                      {c.labelText ? <span className="text-white text-[10px] font-bold rounded px-1.5 py-0.5" style={{ backgroundColor: c.labelColor || "#6b7280" }}>{c.labelText}</span> : <Hash size={12} className="text-gray-400" />}
                      {c.name}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      {format(new Date(c.permanentlyDeletedAt), "M/d")}까지 보관
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => restoreChannel(c.id)}>복구</Button>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
