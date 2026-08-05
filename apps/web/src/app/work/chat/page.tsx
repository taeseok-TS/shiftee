"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Send, Plus, Hash, User as UserIcon, Search, Smile, Paperclip, X, Bell, BellOff, AtSign, Download, Link as LinkIcon, ExternalLink, Pin, Settings, UserPlus, Trash2, EyeOff, Reply, Pencil, Megaphone, BarChart3, Star, Share2, Clock, AlarmClock, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

// 자주쓰는 6개만 기본 노출, "+"로 전체 그리드
const EMOJIS = ["👍", "✅", "🙏", "😂", "❤️", "🫡"];
const EMOJIS_ALL = [
  "👍", "✅", "🙏", "😂", "❤️", "🫡",
  "😢", "😮", "👌", "🎉", "👏", "🔥",
  "💯", "😊", "😅", "🤣", "😭", "🥹",
  "🙇", "💪", "🤝", "🙌", "😍", "☕",
];

// 이모지만으로 된 짧은 메시지(3개 이하)는 크게 표시 (카톡식)
function isEmojiOnly(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  try {
    // 픽토그래프 + (변형선택자/스킨톤) + (ZWJ 결합) 을 이모지 1개로 계산
    const seq = "\\p{Extended_Pictographic}(?:\\uFE0F)?(?:[\\u{1F3FB}-\\u{1F3FF}])?";
    const re = new RegExp(`${seq}(?:\\u200D${seq})*`, "gu");
    const matches = t.match(re);
    if (!matches || matches.length === 0 || matches.length > 3) return false;
    return t.replace(re, "").replace(/\s/g, "") === "";
  } catch {
    return false;
  }
}
const NOTIFY_LABEL: Record<string, string> = { ALL: "모든 메시지", MENTION: "멘션만", MUTE: "음소거" };

// @멘션 하이라이트 렌더링
const URL_RE = /(https?:\/\/[^\s]+)/g;

function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/);
  return m ? m[0].replace(/[.,)\]]+$/, "") : null;
}

function renderContent(text: string) {
  if (!text) return null;
  // @멘션과 URL을 동시에 분리
  const parts = text.split(/(@[가-힣A-Za-z0-9_]+|https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => {
    if (p.startsWith("@"))
      return <span key={i} className="text-indigo-300 font-semibold bg-indigo-500/20 rounded px-0.5">{p}</span>;
    if (URL_RE.test(p)) {
      URL_RE.lastIndex = 0;
      return <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline break-all">{p}</a>;
    }
    return <span key={i}>{p}</span>;
  });
}

// 링크 미리보기 카드 (OG 메타). 모듈 레벨 캐시로 중복 조회 방지.
type LinkPreviewData = { url: string; title: string | null; description: string | null; image: string | null; siteName: string | null } | null;
const linkPreviewCache = new Map<string, LinkPreviewData>();
function LinkPreview({ url, mine }: { url: string; mine: boolean }) {
  const [data, setData] = useState<LinkPreviewData>(linkPreviewCache.get(url) ?? undefined as unknown as LinkPreviewData);
  useEffect(() => {
    if (linkPreviewCache.has(url)) { setData(linkPreviewCache.get(url)!); return; }
    let alive = true;
    fetch(`/api/work/link-preview?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((j) => { linkPreviewCache.set(url, j.preview ?? null); if (alive) setData(j.preview ?? null); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [url]);
  if (!data) return null;
  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer"
      className={`mt-1.5 flex overflow-hidden rounded-xl border max-w-[320px] ${mine ? "bg-indigo-400/20 border-indigo-300/40" : "bg-gray-50 border-gray-200"} hover:opacity-90`}>
      {data.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.image} alt="" className="w-20 h-20 object-cover shrink-0" />
      )}
      <div className="p-2 min-w-0">
        {data.siteName && <div className={`text-[10px] truncate ${mine ? "text-indigo-100" : "text-gray-400"}`}>{data.siteName}</div>}
        {data.title && <div className={`text-xs font-semibold line-clamp-2 ${mine ? "text-white" : "text-gray-800"}`}>{data.title}</div>}
        {data.description && <div className={`text-[11px] line-clamp-2 ${mine ? "text-indigo-100" : "text-gray-500"}`}>{data.description}</div>}
      </div>
    </a>
  );
}

// 이름 기반 이니셜 아바타
const AVATAR_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
function Avatar({ name, size = 32, src }: { name: string; size?: number; src?: string | null }) {
  const n = name || "?";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={n} className="rounded-full object-cover shrink-0 bg-gray-100" style={{ width: size, height: size }} />;
  }
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return (
    <div className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.42, backgroundColor: AVATAR_COLORS[h % AVATAR_COLORS.length] }}>
      {n.trim().charAt(0) || "?"}
    </div>
  );
}

type Channel = { id: string; name: string; avatarUrl?: string | null; type: "CHANNEL" | "DM"; isDefault: boolean; memberCount: number; unread: number; notify: string; pinned: boolean; canManage: boolean; amCreator: boolean; labelText: string | null; labelColor: string | null; lastMessage: { content: string; createdAt: string } | null };
type TrashChannel = { id: string; name: string; deletedAt: string; permanentlyDeletedAt: string; labelText: string | null; labelColor: string | null };
const LABEL_COLORS = ["#eab308", "#ef4444", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899", "#6b7280"];
type ChannelMember = { userId: string; name: string; branch?: string | null; position?: string | null; isCreator: boolean; isManager: boolean };
type ChannelFile = { messageId: string; fileUrl: string; fileName: string | null; fileType: string | null; userName: string; createdAt: string };
type Reaction = { emoji: string; count: number; mine: boolean; names?: string[] };
type Message = { id: string; userId: string; userName: string; userAvatar?: string | null; userBranch?: string | null; system?: boolean; content: string; fileUrl: string | null; fileName: string | null; fileType: string | null; albumUrls?: string[] | null; createdAt: string; mine: boolean; reactions: Reaction[]; replyCount: number; editedAt?: string | null; deleted?: boolean; replyTo?: { id: string; userName: string; content: string; deleted: boolean } | null; unreadBy?: number; bookmarked?: boolean; poll?: { id: string; question: string; options: string[]; multiple: boolean; closed: boolean; closesAt?: string | null; counts: number[]; myVotes: number[]; totalVoters: number; creatorId: string; creatorName: string } | null };
type Employee = { id: string; name: string; branch?: string | null; role?: string | null };

export default function WorkChatPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [readWatermark, setReadWatermark] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pickerMore, setPickerMore] = useState(false); // 리액션 이모지 전체 그리드 펼침
  useEffect(() => { setPickerMore(false); }, [pickerFor]);
  const [inputEmojiOpen, setInputEmojiOpen] = useState(false); // 입력창 이모지 선택기
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
  const [inviteOpen, setInviteOpen] = useState(false);
  // 읽음/안읽음 명단
  type ReaderEntry = { userId: string; name: string; branch: string | null; avatarUrl: string | null };
  const [readersOpen, setReadersOpen] = useState(false);
  const [readers, setReaders] = useState<{ read: ReaderEntry[]; unread: ReaderEntry[] } | null>(null);
  const [readersTab, setReadersTab] = useState<"unread" | "read">("unread");
  // 채널 고정 공지
  const [notice, setNotice] = useState<{ content: string; imageUrl?: string | null; by: string | null; at: string | null; important?: boolean; unreadCount?: number } | null>(null);
  const [noticeCollapsed, setNoticeCollapsed] = useState(true); // 기본 접힘 — 긴 공지가 화면을 덮지 않게
  const [noticeDlgFor, setNoticeDlgFor] = useState<Message | null>(null); // 공지 등록 다이얼로그 대상 메시지
  const [noticeImportantChk, setNoticeImportantChk] = useState(false);
  // 링크 모아보기
  const [linksOpen, setLinksOpen] = useState(false);
  const [links, setLinks] = useState<{ url: string; userName: string; createdAt: string }[] | null>(null);
  // 투표 만들기
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQ, setPollQ] = useState("");
  const [pollOpts, setPollOpts] = useState<string[]>(["", ""]);
  const [pollCloses, setPollCloses] = useState(""); // datetime-local 값, "" = 종료 시간 없음
  const [pollMulti, setPollMulti] = useState(false);
  const [pollSubmitting, setPollSubmitting] = useState(false);
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
  const [myId, setMyId] = useState("");
  const [myRole, setMyRole] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadEtaSec, setUploadEtaSec] = useState<number | null>(null); // 업로드 남은 시간(초) 추정
  // 대기 첨부 — 파일 선택/드롭/붙여넣기 시 바로 전송하지 않고 입력창 위에 대기, 전송 버튼으로 발송
  const [pendingFiles, setPendingFiles] = useState<{ file: File; preview: string | null }[]>([]);
  const [dragOver, setDragOver] = useState(false);
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

  // 긴 메시지 접기: "전체 보기"를 누른 메시지 ID 집합
  const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  activeIdRef.current = activeId;

  // 데스크톱(브라우저) 알림 토글 — 실제 알림 발송은 전역 컴포넌트(WorkDesktopNotifier)가 담당해
  // 큐브티 어느 화면에 있어도 알림이 온다. 여기는 켜기/끄기 UI + 상태 연동만.
  const [desktopNotify, setDesktopNotify] = useState(false);
  useEffect(() => {
    const on = typeof window !== "undefined" && localStorage.getItem("workDesktopNotify") === "on"
      && typeof Notification !== "undefined" && Notification.permission === "granted";
    setDesktopNotify(on);
  }, []);
  const toggleDesktopNotify = async () => {
    if (desktopNotify) {
      setDesktopNotify(false);
      localStorage.setItem("workDesktopNotify", "off");
      window.dispatchEvent(new Event("workDesktopNotifyChanged"));
      toast.success("데스크톱 알림을 껐습니다.");
      return;
    }
    if (typeof Notification === "undefined") { toast.error("이 브라우저는 알림을 지원하지 않습니다."); return; }
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm !== "granted") {
      toast.error("브라우저 알림이 차단되어 있습니다. 주소창의 사이트 설정에서 알림을 허용해주세요.");
      return;
    }
    setDesktopNotify(true);
    localStorage.setItem("workDesktopNotify", "on");
    window.dispatchEvent(new Event("workDesktopNotifyChanged"));
    toast.success("데스크톱 알림을 켰습니다. 큐브티 어느 화면에서든 새 메시지를 알려드립니다.");
  };
  // 전역 알림기와 연동: 보고 있는 채널 노출(그 방 알림 생략용) + 알림 클릭 시 채널 열기 + ?channel= 진입
  useEffect(() => {
    (window as unknown as { __workActiveChannelId?: string | null }).__workActiveChannelId = activeId;
    // 다른 탭의 전역 알림기도 알 수 있게 "보고 있는 방"을 localStorage로 공유.
    // "채널ID|타임스탬프"를 10초마다 갱신(하트비트) — 알림기는 25초 내 값만 유효로 봐서
    // 탭 강제종료로 남은 잔류값이 채널 알림을 영구 차단하는 일을 막는다.
    const clearViewing = () => {
      try {
        const v = localStorage.getItem("workViewingChannel");
        if (activeId && v && v.split("|")[0] === activeId) localStorage.removeItem("workViewingChannel");
      } catch { /* noop */ }
    };
    const syncViewing = () => {
      try {
        if (activeId && !document.hidden && document.hasFocus()) {
          localStorage.setItem("workViewingChannel", `${activeId}|${Date.now()}`);
        } else {
          clearViewing();
        }
      } catch { /* noop */ }
    };
    syncViewing();
    const heartbeat = window.setInterval(syncViewing, 10000);
    window.addEventListener("focus", syncViewing);
    window.addEventListener("blur", syncViewing);
    document.addEventListener("visibilitychange", syncViewing);
    window.addEventListener("pagehide", clearViewing);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("focus", syncViewing);
      window.removeEventListener("blur", syncViewing);
      document.removeEventListener("visibilitychange", syncViewing);
      window.removeEventListener("pagehide", clearViewing);
      clearViewing();
      (window as unknown as { __workActiveChannelId?: string | null }).__workActiveChannelId = null;
    };
  }, [activeId]);
  useEffect(() => {
    const openCh = (e: Event) => setActiveId((e as CustomEvent<string>).detail);
    window.addEventListener("workOpenChannel", openCh);
    const q = new URLSearchParams(window.location.search).get("channel");
    if (q) setActiveId(q);
    return () => window.removeEventListener("workOpenChannel", openCh);
  }, []);

  const fetchChannels = useCallback(async (): Promise<Channel[]> => {
    const res = await fetch("/api/work/channels");
    if (res.ok) {
      const data = await res.json();
      setChannels(data.channels || []);
      setActiveId((cur) => cur ?? data.channels?.[0]?.id ?? null);
      return data.channels || [];
    }
    return [];
  }, []);

  const fetchMessages = useCallback(async (channelId: string) => {
    const res = await fetch(`/api/work/channels/${channelId}/messages`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages || []);
      setReadWatermark(data.readWatermark || null);
      setNotice(data.notice || null);
    }
  }, []);

  const markRead = useCallback(async (channelId: string) => {
    await fetch(`/api/work/channels/${channelId}/read`, { method: "POST" });
  }, []);

  useEffect(() => {
    fetchChannels();
    fetch("/api/work/members").then(r => r.ok ? r.json() : { members: [] }).then(d => setEmployees(d.members || [])).catch(() => {});
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => { if (d?.user) { setIsAdmin(d.user.role === "ADMIN"); setMyName(d.user.name || ""); setMyId(d.user.id || ""); setMyRole(d.user.role || ""); } }).catch(() => {});
  }, [fetchChannels]);

  // 활성 채널 진입 시 메시지 로드 + 읽음 처리
  useEffect(() => {
    if (!activeId) return;
    fetchMessages(activeId).then(() => markRead(activeId).then(fetchChannels));
    // 멘션 자동완성용: 현재 채널 멤버 로드(멘션은 채널 구성원만)
    fetch(`/api/work/channels/${activeId}/members`).then(r => r.ok ? r.json() : { members: [] }).then(d => setChannelMembers(d.members || [])).catch(() => {});
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
        fetchChannels(); // 데스크톱 알림은 전역 WorkDesktopNotifier가 처리
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

  // 자동 스크롤은 "맨 아래 근처에 있을 때"와 "내가 방금 보냈을 때"만.
  // 목록은 SSE·폴링으로 수시로 갱신되므로 무조건 내리면 위로 올려 읽는 중에 강제로 끌려 내려간다.
  const nearBottomRef = useRef(true);
  useEffect(() => {
    nearBottomRef.current = true; // 방을 열면 맨 아래(최신)부터
    setNoticeCollapsed(true); // 방 전환 시 공지 배너도 접힘으로
  }, [activeId]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const last = messages[messages.length - 1];
    if (nearBottomRef.current || (last && last.mine)) el.scrollTo({ top: el.scrollHeight });
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

  function startReply(m: Message) { setReplyTo(m); setEditingId(null); }
  function startEdit(m: Message) { setEditingId(m.id); setReplyTo(null); setInput(m.content); }
  function cancelReplyEdit() { const wasEdit = !!editingId; setReplyTo(null); setEditingId(null); if (wasEdit) setInput(""); }
  async function deleteMsg(m: Message) {
    if (!confirm("이 메시지를 삭제할까요?")) return;
    const res = await fetch(`/api/work/messages/${m.id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || "삭제 실패"); return; }
    if (activeId) fetchMessages(activeId);
  }

  async function send() {
    if ((!input.trim() && pendingFiles.length === 0) || !activeId) return;
    setSending(true);
    // 전송 후 입력창 높이를 한 줄로 복귀
    if (inputRef.current) inputRef.current.style.height = "auto";
    try {
      if (editingId) {
        const res = await fetch(`/api/work/messages/${editingId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: input }),
        });
        const data = await res.json();
        if (!res.ok) { toast.error(data.error || "수정 실패"); return; }
        setInput(""); setEditingId(null);
        fetchMessages(activeId);
      } else if (pendingFiles.length > 0) {
        // 대기 첨부 업로드 → 글(캡션)과 함께 발송. 이미지 2장 이상은 앨범 묶음, 나머지는 개별
        setUploadProgress(0);
        const ups: { fileUrl: string; fileName: string; fileType: string }[] = [];
        for (let i = 0; i < pendingFiles.length; i++) {
          const u = await uploadOne(pendingFiles[i].file);
          if (!u) { setUploadProgress(null); return; } // 실패 시 대기 첨부 유지 — 다시 전송 시도 가능
          ups.push(u);
        }
        setUploadProgress(null);
        const images = ups.filter((u) => u.fileType === "image");
        const others = ups.filter((u) => u.fileType !== "image");
        let caption = input.trim();
        const post = (body: Record<string, unknown>) =>
          fetch(`/api/work/channels/${activeId}/messages`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
        if (images.length >= 2) {
          const res = await post({ content: caption, albumUrls: images.slice(0, 10).map((u) => u.fileUrl), replyToId: replyTo?.id ?? null });
          if (!res.ok) { const d = await res.json().catch(() => ({} as any)); toast.error(d.error || "전송 실패"); return; }
          caption = "";
        }
        const singles = images.length >= 2 ? others : [...images, ...others];
        for (const u of singles) {
          const res = await post({ content: caption, fileUrl: u.fileUrl, fileName: u.fileName, fileType: u.fileType, replyToId: caption ? replyTo?.id ?? null : null });
          if (!res.ok) { const d = await res.json().catch(() => ({} as any)); toast.error(d.error || "전송 실패"); return; }
          caption = "";
        }
        pendingFiles.forEach((p) => { if (p.preview) URL.revokeObjectURL(p.preview); });
        setPendingFiles([]); setInput(""); setReplyTo(null);
        fetchMessages(activeId); fetchChannels();
      } else {
        const res = await fetch(`/api/work/channels/${activeId}/messages`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: input, replyToId: replyTo?.id ?? null }),
        });
        const data = await res.json();
        if (!res.ok) { toast.error(data.error || "전송 실패"); return; }
        setInput(""); setReplyTo(null);
        setMessages((m) => [...m, data.message]);
      }
    } finally { setSending(false); }
  }

  // 파일 1개 업로드 (진행률 표시를 위해 XHR 사용 — fetch는 업로드 진행 이벤트 미지원). 실패 시 null
  async function uploadOne(file: File): Promise<{ fileUrl: string; fileName: string; fileType: string } | null> {
    const fd = new FormData();
    fd.append("file", file);
    const started = Date.now();
    const upData: any = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/work/upload");
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        setUploadProgress(pct);
        // 남은 시간 추정: 지금까지 걸린 시간 기준
        if (pct > 0 && pct < 100) {
          const elapsed = (Date.now() - started) / 1000;
          setUploadEtaSec(Math.ceil((elapsed / pct) * (100 - pct)));
        } else {
          setUploadEtaSec(null);
        }
      };
      xhr.onload = () => {
        try { const j = JSON.parse(xhr.responseText); resolve(xhr.status >= 200 && xhr.status < 300 ? j : { _error: j.error }); }
        catch { resolve({ _error: "업로드 실패" }); }
      };
      xhr.onerror = () => resolve({ _error: "네트워크 오류" });
      xhr.send(fd);
    });
    if (!upData || upData._error) { toast.error(upData?._error || "업로드 실패"); return null; }
    return upData;
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

  // 답글은 카톡처럼 인용답장(replyToId)으로 전송 → 채팅 맨 아래 최신글로 표시 (앱과 동일 동작)
  async function sendReply() {
    if (!threadInput.trim() || !threadId || !activeId) return;
    await fetch(`/api/work/channels/${activeId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: threadInput, replyToId: threadId }),
    });
    setThreadInput("");
    closeThread();
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
  // 공지 등록 (메시지 → 채널 공지, 이미지 메시지는 이미지 공지로. 중요 여부는 다이얼로그에서 선택)
  async function setChannelNoticeFrom(m: Message, important: boolean) {
    const imageUrl = m.fileType === "image" ? m.fileUrl : null;
    if (!activeId || (!m.content.trim() && !imageUrl)) return;
    const res = await fetch(`/api/work/channels/${activeId}/notice`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: m.content, imageUrl, important }),
    });
    if (res.ok) { toast.success(important ? "중요 공지로 등록했습니다. (미확인자에게 매일 재알림)" : "공지로 등록했습니다."); setNoticeDlgFor(null); fetchMessages(activeId); }
    else { const d = await res.json(); toast.error(d.error || "공지 등록 실패"); }
  }

  // 공지 미확인자 명단 (읽음 확인 다이얼로그 재사용)
  async function openNoticeReaders() {
    if (!activeId) return;
    setReadersTab("unread");
    setReaders(null);
    setReadersOpen(true);
    const res = await fetch(`/api/work/channels/${activeId}/notice/readers`);
    if (res.ok) setReaders(await res.json());
  }
  async function clearChannelNotice() {
    if (!activeId) return;
    if (!window.confirm("채팅방 공지를 내릴까요?")) return;
    const res = await fetch(`/api/work/channels/${activeId}/notice`, { method: "DELETE" });
    if (res.ok) { setNotice(null); toast.success("공지를 내렸습니다."); }
    else { const d = await res.json(); toast.error(d.error || "공지 내리기 실패"); }
  }

  // 링크 모아보기
  async function openLinks() {
    if (!activeId) return;
    setLinks(null); setLinksOpen(true);
    const res = await fetch(`/api/work/channels/${activeId}/links`);
    if (res.ok) setLinks((await res.json()).links || []);
  }

  // 투표 생성/투표/마감
  async function createPoll() {
    if (!activeId) return;
    setPollSubmitting(true);
    try {
      const res = await fetch(`/api/work/channels/${activeId}/polls`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: pollQ, options: pollOpts, multiple: pollMulti, closesAt: pollCloses ? new Date(pollCloses).toISOString() : undefined }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || "투표 생성 실패"); return; }
      setPollOpen(false); setPollQ(""); setPollOpts(["", ""]); setPollMulti(false); setPollCloses("");
      fetchMessages(activeId);
    } finally {
      setPollSubmitting(false);
    }
  }
  async function votePoll(pollId: string, optionIndex: number) {
    if (!activeId) return;
    const res = await fetch(`/api/work/polls/${pollId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ optionIndex }),
    });
    if (res.ok) fetchMessages(activeId);
    else { const d = await res.json(); toast.error(d.error || "투표 실패"); }
  }
  async function closePoll(pollId: string) {
    if (!activeId) return;
    const res = await fetch(`/api/work/polls/${pollId}`, { method: "PATCH" });
    if (res.ok) { toast.success("투표를 마감했습니다."); fetchMessages(activeId); }
    else { const d = await res.json(); toast.error(d.error || "마감 실패"); }
  }

  // 파일 선택/드롭/붙여넣기 → 바로 전송하지 않고 입력창 위에 대기 (글을 쓰고 전송 버튼으로 발송)
  function handleFiles(files: File[]) {
    setPendingFiles((prev) => [
      ...prev,
      ...files.map((f) => ({ file: f, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null })),
    ]);
    inputRef.current?.focus();
  }
  function removePending(i: number) {
    setPendingFiles((prev) => {
      const t = prev[i];
      if (t?.preview) URL.revokeObjectURL(t.preview);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  // 북마크 토글
  async function toggleBookmark(m: Message) {
    const res = await fetch(`/api/work/messages/${m.id}/bookmark`, { method: "POST" });
    if (res.ok) {
      const d = await res.json();
      setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, bookmarked: d.bookmarked } : x));
      toast.success(d.bookmarked ? "보관함에 담았습니다." : "보관함에서 뺐습니다.");
    }
  }

  // 메시지 전달
  const [forwardFor, setForwardFor] = useState<Message | null>(null);
  const [forwardSearch, setForwardSearch] = useState("");
  // 구성원 선택 시: DM 찾기/생성 후 그 채널로 전달
  async function forwardToMember(userId: string) {
    const res = await fetch("/api/work/channels", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "DM", memberIds: [userId] }),
    });
    const d = await res.json();
    if (!res.ok || !d.channel?.id) { toast.error(d.error || "대화방 생성 실패"); return; }
    await forwardTo(d.channel.id);
  }
  async function forwardTo(channelId: string) {
    if (!forwardFor) return;
    const res = await fetch(`/api/work/channels/${channelId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: forwardFor.content,
        fileUrl: forwardFor.fileUrl, fileName: forwardFor.fileName, fileType: forwardFor.fileType,
        albumUrls: forwardFor.albumUrls || undefined,
      }),
    });
    if (res.ok) { toast.success("전달했습니다."); setForwardFor(null); fetchChannels(); if (channelId === activeId) fetchMessages(activeId); }
    else { const d = await res.json(); toast.error(d.error || "전달 실패"); }
  }

  // 보관함 / 멘션 모아보기
  type SavedItem = { messageId: string; channelId: string; channelName: string; userName: string; content: string; fileUrl?: string | null; fileName?: string | null; fileType?: string | null; createdAt: string };
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedItems, setSavedItems] = useState<SavedItem[] | null>(null);
  const [mentionsOpen, setMentionsOpen] = useState(false);
  const [mentionItems, setMentionItems] = useState<SavedItem[] | null>(null);
  async function openSaved() {
    setSavedItems(null); setSavedOpen(true);
    const res = await fetch("/api/work/bookmarks");
    if (res.ok) setSavedItems((await res.json()).bookmarks || []);
  }
  async function openMentions() {
    setMentionItems(null); setMentionsOpen(true);
    const res = await fetch("/api/work/mentions");
    if (res.ok) setMentionItems((await res.json()).mentions || []);
  }

  // 예약 전송
  type ScheduledItem = { id: string; content: string; sendAt: string };
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduledList, setScheduledList] = useState<ScheduledItem[] | null>(null);
  async function openSchedule() {
    if (!activeId) return;
    // 기본값: 1시간 후 (datetime-local 로컬 표기)
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    setScheduleAt(d.toISOString().slice(0, 16));
    setScheduledList(null);
    setScheduleOpen(true);
    const res = await fetch(`/api/work/channels/${activeId}/scheduled`);
    if (res.ok) setScheduledList((await res.json()).scheduled || []);
  }
  async function submitSchedule() {
    if (!activeId || !input.trim() || !scheduleAt) return;
    const res = await fetch(`/api/work/channels/${activeId}/scheduled`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: input, sendAt: new Date(scheduleAt).toISOString() }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "예약 실패"); return; }
    toast.success("메시지를 예약했습니다.");
    setInput(""); if (inputRef.current) inputRef.current.style.height = "auto";
    setScheduleOpen(false);
  }
  async function cancelScheduled(sid: string) {
    const res = await fetch(`/api/work/scheduled/${sid}`, { method: "DELETE" });
    if (res.ok) { setScheduledList((prev) => (prev || []).filter((s) => s.id !== sid)); toast.success("예약을 취소했습니다."); }
  }

  // 메시지 리마인더
  const [reminderFor, setReminderFor] = useState<Message | null>(null);
  const [reminderAt, setReminderAt] = useState("");
  async function submitReminder(at: Date) {
    if (!reminderFor) return;
    const res = await fetch(`/api/work/messages/${reminderFor.id}/reminder`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remindAt: at.toISOString() }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "리마인더 등록 실패"); return; }
    toast.success("리마인더를 등록했습니다. 시간이 되면 큐브티 봇이 알려드립니다.");
    setReminderFor(null);
  }
  function tomorrowNine(): Date {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // 읽음/안읽음 명단 열기 (노란 숫자 클릭)
  async function openReaders(messageId: string) {
    setReadersTab("unread");
    setReaders(null);
    setReadersOpen(true);
    const res = await fetch(`/api/work/messages/${messageId}/readers`);
    if (res.ok) setReaders(await res.json());
  }

  // 멤버 초대 (권한자 아닌 일반 구성원도 사용) — 관리 패널과 별개의 간단 모달
  async function openInvite() {
    if (!activeId) return;
    setAddIds([]); setAddSearch(""); setAddHistory("all");
    setInviteOpen(true);
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
  // DM 나만 숨기기 (상대에겐 영향 없음, 새 메시지 오면 다시 표시)
  async function deleteDM(ch: Channel) {
    if (!confirm("이 대화를 목록에서 숨기시겠습니까?\n새 메시지가 오면 다시 표시됩니다.")) return;
    const res = await fetch(`/api/work/channels/${ch.id}/hide`, { method: "POST" });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "숨기기 실패"); return; }
    toast.success("대화를 숨겼습니다.");
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
    setInviteOpen(false);
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
  // 기본 목록엔 관리자(ADMIN) 숨김, 검색하면 전체(관리자 포함) 노출
  const filteredEmps = employees.filter((e) => empSearch ? e.name.includes(empSearch) : e.role !== "ADMIN");
  const memberIdSet = new Set(channelMembers.map((m) => m.userId));
  const addCandidates = employees.filter((e) => !memberIdSet.has(e.id) && (addSearch ? e.name.includes(addSearch) : e.role !== "ADMIN"));

  // 브라우저가 자체 표시 못 하는 오피스 문서(PPT/엑셀/워드)는 MS Office 온라인 뷰어로 열기
  const openHref = (fileUrl: string, fileName: string | null) => {
    if (/\.(pptx?|xlsx?|docx?)$/i.test(fileName || fileUrl))
      return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(window.location.origin + fileUrl)}`;
    return fileUrl;
  };

  const copyLink = (url: string) => {
    const full = `${window.location.origin}${url}`;
    navigator.clipboard?.writeText(full).then(
      () => toast.success("링크가 복사되었습니다."),
      () => toast.error("링크 복사에 실패했습니다.")
    );
  };

  // 인앱 사진 뷰어(라이트박스) — 카톡처럼 채팅창 안에서 열고 ←→로 채팅방의 모든 사진을 넘겨 본다.
  // 같은 사진을 전달하면 URL이 중복되므로 위치 식별은 (메시지id#순번) 키로 한다
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);
  const openLightbox = (messageId: string | undefined, urlIndex: number, url: string) => {
    const keys: string[] = [];
    const urls: string[] = [];
    for (const msg of messages) {
      if (msg.deleted) continue;
      if (msg.albumUrls && msg.albumUrls.length > 0) msg.albumUrls.forEach((u, i) => { keys.push(`${msg.id}#${i}`); urls.push(u); });
      else if (msg.fileType === "image" && msg.fileUrl) { keys.push(`${msg.id}#0`); urls.push(msg.fileUrl); }
    }
    const idx = messageId ? keys.indexOf(`${messageId}#${urlIndex}`) : -1;
    // 목록에 없으면(스레드 답글 등) 클릭한 사진 한 장만 표시
    if (idx < 0) setLightbox({ urls: [url], index: 0 });
    else setLightbox({ urls, index: idx });
  };
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      else if (e.key === "ArrowLeft") setLightbox((p) => p && { ...p, index: Math.max(0, p.index - 1) });
      else if (e.key === "ArrowRight") setLightbox((p) => p && { ...p, index: Math.min(p.urls.length - 1, p.index + 1) });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const renderAttachment = (m: { id?: string; fileUrl: string | null; fileName: string | null; fileType: string | null; albumUrls?: string[] | null }) => {
    // 사진 앨범(여러 장 묶음) — 2열 격자, 클릭 시 원본
    if (m.albumUrls && m.albumUrls.length > 0) {
      const urls = m.albumUrls;
      const shown = urls.slice(0, 9);
      return (
        <div className="mt-1 grid grid-cols-2 gap-1 max-w-[260px]">
          {shown.map((u, i) => (
            <button key={i} type="button" onClick={() => openLightbox(m.id, i, u)} className="relative block cursor-zoom-in">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" className="w-full h-[124px] object-cover rounded-lg" />
              {i === shown.length - 1 && urls.length > shown.length && (
                <span className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center text-white font-bold text-lg">
                  +{urls.length - shown.length}
                </span>
              )}
            </button>
          ))}
        </div>
      );
    }
    if (!m.fileUrl) return null;
    const isImg = m.fileType === "image";
    return (
      <div className="mt-1">
        {isImg ? (
          <button type="button" onClick={() => openLightbox(m.id, 0, m.fileUrl!)} className="cursor-zoom-in">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.fileUrl} alt={m.fileName || ""} className="max-w-[220px] rounded-lg" />
          </button>
        ) : m.fileType === "video" ? (
          <video controls preload="metadata" className="max-w-[280px] rounded-lg" src={m.fileUrl} />
        ) : m.fileType === "audio" ? (
          // 음성 메시지 (앱에서 녹음한 .m4a 등)
          <audio controls preload="metadata" className="max-w-[260px] h-9" src={m.fileUrl} />
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
          <a href={openHref(m.fileUrl, m.fileName)} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:underline">
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
            {/* 데스크톱 알림 토글 — 카카오 PC처럼 켜면 새 메시지 브라우저 알림 */}
            <Button size="sm" variant="ghost" onClick={toggleDesktopNotify}
              className={`gap-1 ${desktopNotify ? "text-indigo-600 hover:text-indigo-700" : "text-gray-400 hover:text-gray-700"}`}
              title={desktopNotify ? "데스크톱 알림 끄기" : "데스크톱 알림 켜기"}>
              {desktopNotify ? <Bell size={15} /> : <BellOff size={15} />}
            </Button>
            <Button size="sm" variant="ghost" onClick={openMentions} className="gap-1" title="나를 멘션한 메시지"><AtSign size={15} /></Button>
            <Button size="sm" variant="ghost" onClick={() => setNewOpen(true)} className="gap-1" title="새 채팅"><Plus size={16} /></Button>
            {/* 나머지 기능은 ⋮ 안으로 — 헤더가 좁아 "채팅" 타이틀·이름이 깨지지 않게 */}
            <DropdownMenu>
              <DropdownMenuTrigger className="px-2 py-1.5 rounded-md hover:bg-gray-100 text-gray-500 outline-none" title="더보기">
                <span className="text-base leading-none">⋮</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={openSaved}><Star size={14} className="mr-2" /> 내 보관함</DropdownMenuItem>
                <DropdownMenuItem onClick={openTrash}><Trash2 size={14} className="mr-2" /> 휴지통</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
              {c.type === "DM" ? <div className="mt-0.5"><Avatar name={c.name} src={c.avatarUrl} size={28} /></div>
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

      {/* 메시지 영역 — 파일 드래그앤드롭으로 첨부 */}
      <div className="flex-1 flex flex-col bg-gray-50 min-w-0 relative"
        onDragOver={(e) => { if (active && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
        onDrop={(e) => {
          if (!active) return;
          e.preventDefault(); setDragOver(false);
          const fs = Array.from(e.dataTransfer.files || []);
          if (fs.length) handleFiles(fs);
        }}>
        {dragOver && active && (
          <div className="absolute inset-0 z-30 bg-indigo-500/10 border-4 border-dashed border-indigo-400 rounded-lg flex items-center justify-center pointer-events-none">
            <div className="bg-white rounded-xl shadow-lg px-6 py-4 flex items-center gap-2 text-indigo-600 font-semibold">
              <Paperclip size={18} /> 여기에 놓으면 첨부됩니다
            </div>
          </div>
        )}
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
              {/* DM 나만 숨기기 */}
              {active.type === "DM" && (
                <button onClick={() => deleteDM(active)} title="대화 숨기기"
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"><EyeOff size={16} /></button>
              )}
              {/* 링크 모아보기 */}
              <button onClick={openLinks} title="공유된 링크"
                className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"><LinkIcon size={15} /></button>
              {/* 멤버 초대 (비기본 그룹채널은 구성원 누구나) */}
              {active.type === "CHANNEL" && !active.isDefault && (
                <button onClick={openInvite} title="멤버 초대"
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><UserPlus size={16} /></button>
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

            {/* 채널 고정 공지 */}
            {notice && (
              <div className={`mx-6 mt-3 rounded-lg border px-4 py-2.5 flex items-start gap-2 ${notice.important ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                <span className="shrink-0 mt-0.5">📌</span>
                {notice.important && <span className="shrink-0 mt-0.5 text-[10px] font-bold text-white bg-red-500 rounded px-1.5 py-0.5">중요</span>}
                {/* 본문 클릭=펼치기만 (펼친 뒤 스크롤 드래그 중 실수로 접히지 않게, 접기는 ∧ 버튼) */}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => noticeCollapsed && setNoticeCollapsed(false)}>
                  {/* 펼쳐도 화면의 40%까지만 — 넘치면 내부 스크롤 */}
                  <div className={noticeCollapsed ? "" : "max-h-[40vh] overflow-y-auto"}>
                    {/* 접힘일 땐 truncate(한 줄)와 충돌하는 pre-wrap을 빼야 실제로 한 줄이 된다 */}
                    {notice.content && <p className={`text-sm text-amber-900 ${noticeCollapsed ? "truncate" : "whitespace-pre-wrap"}`}>{notice.content}</p>}
                    {notice.imageUrl && !noticeCollapsed && (
                      <a href={notice.imageUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={notice.imageUrl} alt="공지 이미지" className="mt-1 max-h-40 rounded-lg border border-amber-200" />
                      </a>
                    )}
                    {notice.imageUrl && noticeCollapsed && !notice.content && <p className="text-sm text-amber-900">🖼️ 이미지 공지</p>}
                  </div>
                  {!noticeCollapsed && (
                    <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-2">
                      {notice.by && <span>{notice.by} 등록</span>}
                      {(notice.unreadCount ?? 0) > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); openNoticeReaders(); }} className="text-red-500 font-semibold hover:underline">
                          미확인 {notice.unreadCount}명
                        </button>
                      )}
                    </p>
                  )}
                </div>
                <button onClick={() => setNoticeCollapsed((v) => !v)} title={noticeCollapsed ? "공지 펼치기" : "공지 접기"} className="text-amber-500 hover:text-amber-700 shrink-0">
                  {noticeCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </button>
                <button onClick={clearChannelNotice} title="공지 내리기" className="text-amber-400 hover:text-amber-700 shrink-0"><X size={14} /></button>
              </div>
            )}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-1"
              onScroll={() => {
                const el = scrollRef.current;
                if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}>
              {messages.length === 0 ? (
                <div className="text-center text-gray-400 mt-10 text-sm">아직 메시지가 없습니다. 첫 메시지를 보내보세요!</div>
              ) : (
                messages.map((m, mi) => {
                  // 일자별 날짜 구분선 — 이전 메시지와 날짜(로컬 기준)가 바뀌면 표시
                  const dayLabel = (iso: string) => {
                    const d = new Date(iso);
                    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${["일", "월", "화", "수", "목", "금", "토"][d.getDay()]}요일`;
                  };
                  const showDate = mi === 0 || new Date(m.createdAt).toDateString() !== new Date(messages[mi - 1].createdAt).toDateString();
                  const dateDivider = showDate ? (
                    <div className="flex items-center gap-3 my-3" key={`date-${m.id}`}>
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-[11px] text-gray-400 bg-gray-100 rounded-full px-3 py-1">{dayLabel(m.createdAt)}</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>
                  ) : null;
                  // 시스템 알림(이름 변경 등)은 중앙 회색 문구로
                  if (m.system) {
                    return (
                      <div key={m.id}>
                        {dateDivider}
                        <div className="flex justify-center my-2">
                          <span className="text-[11px] text-gray-400 bg-gray-100 rounded-full px-3 py-1">{m.content}</span>
                        </div>
                      </div>
                    );
                  }
                  const read = active.type === "DM" && m.mine && readWatermark && new Date(m.createdAt) <= new Date(readWatermark);
                  return (
                    <div key={m.id}>
                    {dateDivider}
                    <div className={`group flex gap-2 ${m.mine ? "justify-end" : "justify-start"}`}>
                      {!m.mine && <Avatar name={m.userName} src={m.userAvatar} />}
                      <div className={`max-w-[70%] flex flex-col ${m.mine ? "items-end" : "items-start"}`}>
                        {!m.mine && <span className="text-xs text-gray-500 mb-0.5 ml-1">{m.userName}{m.userBranch && <span className="text-gray-400"> · {m.userBranch}</span>}</span>}
                        <div className="flex items-center gap-1">
                          {m.mine && (
                            <span className="text-[10px] text-gray-400 flex flex-col items-end mr-1 leading-tight">
                              {read && <span className="text-indigo-500">읽음</span>}
                              {!m.deleted && !!m.unreadBy && <button onClick={() => openReaders(m.id)} title="읽음 확인" className="text-yellow-500 font-bold hover:underline">{m.unreadBy}</button>}
                              {format(new Date(m.createdAt), "HH:mm")}
                            </span>
                          )}
                          <div className={
                            // 이모지 단독 메시지는 말풍선 배경 없이 (카톡식)
                            !m.deleted && !m.poll && !m.fileUrl && !m.albumUrls?.length && !m.replyTo && !!m.content && isEmojiOnly(m.content)
                              ? "text-sm"
                              : `rounded-2xl px-4 py-2 text-sm ${m.mine ? "bg-indigo-500 text-white" : "bg-white border"}`
                          }>
                            {m.deleted ? (
                              <span className="italic opacity-70">삭제된 메시지입니다</span>
                            ) : (
                              <>
                                {m.replyTo && (
                                  <div className={`mb-1 pl-2 border-l-2 ${m.mine ? "border-indigo-200 text-indigo-100" : "border-indigo-300 text-gray-500"} text-xs`}>
                                    <span className="font-semibold">{m.replyTo.userName}</span>{" "}
                                    <span className="opacity-80">{m.replyTo.deleted ? "삭제된 메시지" : m.replyTo.content}</span>
                                  </div>
                                )}
                                {m.poll ? (
                                  <div className="min-w-[240px]">
                                    <div className="flex items-center gap-1.5 font-semibold mb-2">📊 {m.poll.question}</div>
                                    <div className="space-y-1.5">
                                      {m.poll.options.map((opt, i) => {
                                        const cnt = m.poll!.counts[i] || 0;
                                        const total = Math.max(...m.poll!.counts, 1);
                                        const mineVote = m.poll!.myVotes.includes(i);
                                        return (
                                          <button key={i} disabled={m.poll!.closed} onClick={() => votePoll(m.poll!.id, i)}
                                            className={`w-full text-left relative rounded-lg border px-3 py-1.5 text-xs overflow-hidden ${mineVote ? "border-indigo-400" : m.mine ? "border-indigo-300/40" : "border-gray-200"} ${m.poll!.closed ? "cursor-default" : "hover:opacity-80"}`}>
                                            <div className={`absolute inset-y-0 left-0 ${mineVote ? "bg-indigo-200/50" : "bg-gray-200/40"}`} style={{ width: `${(cnt / total) * 100}%` }} />
                                            <span className="relative flex items-center justify-between gap-2">
                                              <span>{mineVote ? "✓ " : ""}{opt}</span>
                                              <span className="font-semibold">{cnt}</span>
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <div className="flex items-center justify-between mt-2 text-[11px] opacity-70">
                                      <span>{m.poll.totalVoters}명 참여{m.poll.multiple ? " · 복수선택" : ""}{m.poll.closed ? " · 마감됨" : m.poll.closesAt ? ` · ${format(new Date(m.poll.closesAt), "M/d HH:mm")} 마감` : ""}</span>
                                      {!m.poll.closed && (m.poll.creatorId === myId || isAdmin || myRole === "MANAGER") && (
                                        <button onClick={() => closePoll(m.poll!.id)} className="underline hover:opacity-70">마감</button>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {m.content && (() => {
                                      // 이모지만 보낸 메시지는 크게 (카톡식)
                                      if (isEmojiOnly(m.content)) {
                                        return <span className="block text-[52px] leading-[1.25] py-0.5">{m.content.trim()}</span>;
                                      }
                                      // 긴 글은 접어서 보여주고 "전체 보기"로 펼친다 (카톡식)
                                      const lines = m.content.split("\n");
                                      const isLong = m.content.length > 500 || lines.length > 12;
                                      const expanded = expandedMsgs.has(m.id);
                                      const shown = !isLong || expanded
                                        ? m.content
                                        : (lines.length > 12 ? lines.slice(0, 12).join("\n") : m.content).slice(0, 500) + " …";
                                      return (
                                        <>
                                          <span className="whitespace-pre-wrap">{renderContent(shown)}{m.editedAt && <span className="text-[10px] opacity-60"> (수정됨)</span>}</span>
                                          {isLong && !expanded && (
                                            <button
                                              onClick={() => setExpandedMsgs((prev) => new Set(prev).add(m.id))}
                                              className={`block w-full text-center text-xs font-medium mt-2 pt-2 border-t ${m.mine ? "border-white/25 text-white/90" : "border-gray-200 text-indigo-600"} hover:opacity-80`}>
                                              전체 보기
                                            </button>
                                          )}
                                        </>
                                      );
                                    })()}
                                    {renderAttachment(m)}
                                    {!m.fileUrl && firstUrl(m.content) && <LinkPreview url={firstUrl(m.content)!} mine={m.mine} />}
                                  </>
                                )}
                              </>
                            )}
                          </div>
                          {/* 호버 액션 */}
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 relative">
                            {!m.deleted && <button onClick={() => startReply(m)} title="답장" className="text-gray-400 hover:text-gray-700"><Reply size={15} /></button>}
                            {!m.deleted && !m.poll && <button onClick={() => setForwardFor(m)} title="전달" className="text-gray-400 hover:text-gray-700"><Share2 size={14} /></button>}
                            {!m.deleted && !m.poll && <button onClick={() => toggleBookmark(m)} title={m.bookmarked ? "보관함에서 빼기" : "보관함에 담기"} className={m.bookmarked ? "text-yellow-500" : "text-gray-400 hover:text-yellow-500"}><Star size={14} className={m.bookmarked ? "fill-yellow-400" : ""} /></button>}
                            {!m.deleted && !m.poll && <button onClick={() => { const d = new Date(Date.now() + 60 * 60 * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); setReminderAt(d.toISOString().slice(0, 16)); setReminderFor(m); }} title="리마인더" className="text-gray-400 hover:text-indigo-600"><AlarmClock size={14} /></button>}
                            {!m.deleted && !m.poll && (m.content || m.fileType === "image") && <button onClick={() => { setNoticeImportantChk(false); setNoticeDlgFor(m); }} title="공지로 등록" className="text-gray-400 hover:text-amber-600"><Megaphone size={14} /></button>}
                            <button onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)} className="text-gray-400 hover:text-gray-700"><Smile size={15} /></button>
                            {m.mine && !m.deleted && !m.fileUrl && !m.poll && <button onClick={() => startEdit(m)} title="수정" className="text-gray-400 hover:text-gray-700"><Pencil size={14} /></button>}
                            {m.mine && !m.deleted && <button onClick={() => deleteMsg(m)} title="삭제" className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>}
                            {pickerFor === m.id && (
                              <div className={`absolute top-7 ${m.mine ? "right-0" : "left-0"} z-10 bg-white border shadow ${pickerMore ? "rounded-xl p-2 grid grid-cols-6 gap-1 w-56" : "rounded-full px-2 py-1 flex gap-1"}`}>
                                {(pickerMore ? EMOJIS_ALL : EMOJIS).map((e) => (
                                  <button key={e} onClick={() => toggleReaction(m.id, e)} className="hover:scale-125 transition-transform text-center">{e}</button>
                                ))}
                                {!pickerMore && (
                                  <button onClick={(ev) => { ev.stopPropagation(); setPickerMore(true); }} title="이모지 더보기" className="text-gray-400 hover:text-gray-700 px-0.5"><Plus size={14} /></button>
                                )}
                              </div>
                            )}
                          </div>
                          {!m.mine && (
                            <span className="text-[10px] text-gray-400 flex flex-col items-start ml-1 leading-tight">
                              {!m.deleted && !!m.unreadBy && <button onClick={() => openReaders(m.id)} title="읽음 확인" className="text-yellow-500 font-bold hover:underline text-left">{m.unreadBy}</button>}
                              {format(new Date(m.createdAt), "HH:mm")}
                            </span>
                          )}
                        </div>
                        {/* 반응 칩 */}
                        {m.reactions.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {m.reactions.map((r) => (
                              <button key={r.emoji} onClick={() => toggleReaction(m.id, r.emoji)}
                                title={r.names?.length ? r.names.join(", ") : undefined}
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
                  {uploadEtaSec != null && uploadProgress > 0 && uploadProgress < 100 && (
                    <span className="text-gray-400">
                      · 약 {uploadEtaSec >= 60 ? `${Math.floor(uploadEtaSec / 60)}분 ${uploadEtaSec % 60}초` : `${uploadEtaSec}초`} 남음
                    </span>
                  )}
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}

            {/* 대기 첨부 미리보기 — 전송을 눌러야 발송 */}
            {pendingFiles.length > 0 && (
              <div className="px-4 pt-2 pb-1 bg-white border-t flex items-center gap-2 flex-wrap">
                {pendingFiles.map((p, i) => (
                  <div key={i} className="relative border rounded-lg p-1.5 flex items-center gap-1.5 bg-gray-50">
                    {p.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.preview} alt="" className="w-12 h-12 object-cover rounded" />
                    ) : (
                      <>
                        <Paperclip size={14} className="text-gray-400 shrink-0" />
                        <span className="text-xs max-w-[140px] truncate">{p.file.name}</span>
                      </>
                    )}
                    <button onClick={() => removePending(i)} title="첨부 취소"
                      className="absolute -top-1.5 -right-1.5 bg-gray-600 hover:bg-red-500 text-white rounded-full p-0.5">
                      <X size={10} />
                    </button>
                  </div>
                ))}
                <span className="text-[11px] text-gray-400">메시지를 쓰고 전송을 누르면 함께 발송됩니다</span>
              </div>
            )}

            {(replyTo || editingId) && (
              <div className="px-4 pt-2 bg-white border-t flex items-center gap-2">
                <div className="flex-1 min-w-0 border-l-2 border-indigo-400 pl-2">
                  <div className="text-xs font-semibold text-indigo-600">
                    {editingId ? "메시지 수정 중" : `${replyTo?.userName}님에게 답장`}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {editingId ? messages.find((m) => m.id === editingId)?.content : (replyTo?.content || "첨부파일")}
                  </div>
                </div>
                <button onClick={cancelReplyEdit} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
              </div>
            )}

            <div className="px-4 py-3 border-t bg-white flex gap-2 items-end relative">
              {/* @멘션 자동완성 드롭다운 */}
              {mentionQuery !== null && (() => {
                // 멘션 대상은 현재 채널 구성원만 (채팅방에 없는 사람은 노출 안 됨)
                const cands = channelMembers.filter((m) => m.name.includes(mentionQuery)).slice(0, 6);
                if (cands.length === 0) return null;
                return (
                  <div className="absolute bottom-14 left-12 z-20 bg-white border rounded-lg shadow w-48 max-h-52 overflow-y-auto">
                    <div className="px-3 py-1.5 text-[10px] text-gray-400 border-b flex items-center gap-1"><AtSign size={11} />멘션할 사람</div>
                    {cands.map((m) => (
                      <button key={m.userId} onClick={() => pickMention(m.name)} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50">
                        {m.name}{m.branch && <span className="text-xs text-gray-400"> · {m.branch}</span>}
                      </button>
                    ))}
                  </div>
                );
              })()}
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) handleFiles(fs); e.target.value = ""; }} />
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} className="shrink-0"><Paperclip size={16} /></Button>
              <Button variant="ghost" size="sm" onClick={() => setPollOpen(true)} title="투표 만들기" className="shrink-0"><BarChart3 size={16} /></Button>
              <Button variant="ghost" size="sm" onClick={openSchedule} title="예약 전송" className="shrink-0"><Clock size={16} /></Button>
              <div className="relative shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setInputEmojiOpen((v) => !v)} title="이모지" className="shrink-0"><Smile size={16} /></Button>
                {inputEmojiOpen && (
                  <div className="absolute bottom-10 left-0 z-20 bg-white border rounded-xl shadow p-2 grid grid-cols-6 gap-1 w-60">
                    {EMOJIS_ALL.map((e) => (
                      <button key={e} className="text-xl hover:scale-125 transition-transform text-center"
                        onClick={() => {
                          // 커서 위치에 이모지 삽입
                          const ta = inputRef.current;
                          const pos = ta?.selectionStart ?? input.length;
                          const next = input.slice(0, pos) + e + input.slice(pos);
                          onInputChange(next);
                          setTimeout(() => { ta?.focus(); ta?.setSelectionRange(pos + e.length, pos + e.length); }, 0);
                        }}>{e}</button>
                    ))}
                  </div>
                )}
              </div>
              <textarea ref={inputRef} value={input} rows={1}
                className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring max-h-40 overflow-y-auto leading-5"
                onChange={(e) => {
                  onInputChange(e.target.value);
                  // 내용에 맞춰 입력창 자동 확장 (최대 10줄쯤, 이후 내부 스크롤)
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && mentionQuery === null) { e.preventDefault(); send(); } }}
                onPaste={(e) => {
                  // 클립보드의 이미지(스크린샷 등) 붙여넣기 → 대기 첨부로 추가 (전송 버튼으로 발송). 텍스트는 기본 동작 유지.
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  for (const item of items) {
                    if (item.type.startsWith("image/")) {
                      const file = item.getAsFile();
                      if (file) {
                        e.preventDefault();
                        const ext = file.type.split("/")[1] || "png";
                        handleFiles([new File([file], `paste-${Date.now()}.${ext}`, { type: file.type })]);
                      }
                      return;
                    }
                  }
                }}
                placeholder="메시지를 입력하세요... (@로 멘션)" />
              <Button onClick={send} disabled={sending || uploadProgress !== null || (!input.trim() && pendingFiles.length === 0)} className="gap-1 bg-indigo-500 hover:bg-indigo-600"><Send size={16} /></Button>
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
          <div className="px-3 py-3 border-t flex gap-2 items-end">
            <textarea value={threadInput} rows={1}
              className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring max-h-32 overflow-y-auto leading-5"
              onChange={(e) => {
                setThreadInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + "px";
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).style.height = "auto"; sendReply(); } }}
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
                  <Button size="sm" variant="outline" className="text-xs h-7 border-blue-300 bg-blue-50 text-blue-600 hover:bg-blue-100 shrink-0" onClick={() => startDM(e.id)}>1:1 대화</Button>
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

      {/* 예약 전송 */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>⏰ 예약 전송</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {input.trim() ? (
              <div className="rounded-lg bg-gray-50 border px-3 py-2 text-sm text-gray-700 max-h-24 overflow-y-auto whitespace-pre-wrap">{input}</div>
            ) : (
              <p className="text-xs text-amber-600">⚠️ 먼저 채팅 입력창에 보낼 메시지를 작성한 뒤 예약해주세요.</p>
            )}
            <div className="flex items-center gap-2 text-sm">
              발송 시각 <Input type="datetime-local" className="flex-1" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={submitSchedule} disabled={!input.trim() || !scheduleAt} className="bg-indigo-500 hover:bg-indigo-600 gap-1">
                <Clock size={13} />예약하기
              </Button>
            </div>
            <div className="border-t pt-2">
              <p className="text-xs font-medium text-gray-500 mb-1.5">이 채팅방의 대기 중 예약</p>
              {!scheduledList ? (
                <p className="text-xs text-gray-400">불러오는 중…</p>
              ) : scheduledList.length === 0 ? (
                <p className="text-xs text-gray-400">대기 중인 예약이 없습니다.</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {scheduledList.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 text-xs border rounded-lg px-2.5 py-1.5">
                      <span className="text-indigo-600 font-medium shrink-0">{format(new Date(s.sendAt), "MM/dd HH:mm")}</span>
                      <span className="flex-1 truncate text-gray-600">{s.content}</span>
                      <button onClick={() => cancelScheduled(s.id)} className="text-gray-400 hover:text-red-500"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 메시지 리마인더 */}
      <Dialog open={!!reminderFor} onOpenChange={(v) => { if (!v) setReminderFor(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>⏰ 이 메시지 다시 알림</DialogTitle></DialogHeader>
          {reminderFor && (
            <div className="space-y-3">
              <div className="rounded-lg bg-gray-50 border px-3 py-2 text-sm text-gray-700 max-h-20 overflow-y-auto whitespace-pre-wrap">
                {reminderFor.content || `📎 ${reminderFor.fileName || "첨부"}`}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={() => submitReminder(new Date(Date.now() + 60 * 60 * 1000))}>1시간 후</Button>
                <Button variant="outline" size="sm" onClick={() => submitReminder(tomorrowNine())}>내일 오전 9시</Button>
              </div>
              <div className="flex items-center gap-2 text-sm">
                직접 지정 <Input type="datetime-local" className="flex-1" value={reminderAt} onChange={(e) => setReminderAt(e.target.value)} />
                <Button size="sm" onClick={() => reminderAt && submitReminder(new Date(reminderAt))} className="bg-indigo-500 hover:bg-indigo-600">등록</Button>
              </div>
              <p className="text-[11px] text-gray-400">시간이 되면 큐브티 봇이 1:1 채팅으로 알려드립니다.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 메시지 전달 — 채팅방/구성원 검색 선택 */}
      <Dialog open={!!forwardFor} onOpenChange={(v) => { if (!v) { setForwardFor(null); setForwardSearch(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>메시지 전달</DialogTitle></DialogHeader>
          {forwardFor && (
            <div className="space-y-3">
              <div className="rounded-lg bg-gray-50 border px-3 py-2 text-sm text-gray-700 max-h-24 overflow-y-auto whitespace-pre-wrap">
                {forwardFor.content || (forwardFor.albumUrls?.length ? `🖼️ 사진 ${forwardFor.albumUrls.length}장` : forwardFor.fileType === "image" ? "🖼️ 사진" : forwardFor.fileType === "video" ? "🎬 동영상" : forwardFor.fileType === "audio" ? "🎤 음성 메시지" : `📎 ${forwardFor.fileName || "파일"}`)}
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <Input className="pl-9" placeholder="채팅방 또는 구성원 검색" value={forwardSearch} onChange={(e) => setForwardSearch(e.target.value)} />
              </div>
              <div className="max-h-64 overflow-y-auto divide-y border rounded-lg">
                {channels
                  .filter((c) => !forwardSearch.trim() || c.name.toLowerCase().includes(forwardSearch.trim().toLowerCase()))
                  .map((c) => (
                    <button key={c.id} onClick={() => forwardTo(c.id)}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-indigo-50 flex items-center gap-2">
                      {c.type === "DM" ? <Avatar name={c.name} src={c.avatarUrl} size={22} /> : <Hash size={14} className="text-gray-400" />}
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))}
                {forwardSearch.trim() &&
                  employees
                    .filter((e) => e.name.includes(forwardSearch.trim()))
                    .map((e) => (
                      <button key={`emp-${e.id}`} onClick={() => forwardToMember(e.id)}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-indigo-50 flex items-center gap-2">
                        <Avatar name={e.name} size={22} />
                        <span className="truncate">{e.name}</span>
                        {e.branch && <span className="text-xs text-gray-400">· {e.branch}</span>}
                        <span className="ml-auto text-[10px] text-indigo-400">1:1 전달</span>
                      </button>
                    ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 내 보관함 */}
      <Dialog open={savedOpen} onOpenChange={setSavedOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>⭐ 내 보관함</DialogTitle></DialogHeader>
          {!savedItems ? (
            <div className="py-8 text-center text-sm text-gray-400">불러오는 중…</div>
          ) : savedItems.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">보관한 메시지가 없습니다. 메시지에 마우스를 올려 ⭐를 눌러보세요.</div>
          ) : (
            <div className="max-h-96 overflow-y-auto divide-y">
              {savedItems.map((it) => (
                <button key={it.messageId} onClick={() => { setActiveId(it.channelId); setSavedOpen(false); }}
                  className="w-full text-left py-2.5 px-1 hover:bg-gray-50 rounded">
                  <div className="text-[11px] text-gray-400">{it.channelName} · {it.userName} · {format(new Date(it.createdAt), "MM/dd HH:mm")}</div>
                  <div className="text-sm text-gray-800 mt-0.5 line-clamp-2 whitespace-pre-wrap">
                    {it.content || (it.fileType === "image" ? "🖼️ 사진" : it.fileType === "video" ? "🎬 동영상" : it.fileType === "audio" ? "🎤 음성 메시지" : `📎 ${it.fileName || "파일"}`)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 나를 멘션한 메시지 */}
      <Dialog open={mentionsOpen} onOpenChange={setMentionsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>@ 나를 멘션한 메시지</DialogTitle></DialogHeader>
          {!mentionItems ? (
            <div className="py-8 text-center text-sm text-gray-400">불러오는 중…</div>
          ) : mentionItems.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">나를 멘션한 메시지가 없습니다.</div>
          ) : (
            <div className="max-h-96 overflow-y-auto divide-y">
              {mentionItems.map((it) => (
                <button key={it.messageId} onClick={() => { setActiveId(it.channelId); setMentionsOpen(false); }}
                  className="w-full text-left py-2.5 px-1 hover:bg-gray-50 rounded">
                  <div className="text-[11px] text-gray-400">{it.channelName} · {it.userName} · {format(new Date(it.createdAt), "MM/dd HH:mm")}</div>
                  <div className="text-sm text-gray-800 mt-0.5 line-clamp-2 whitespace-pre-wrap">{it.content}</div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 공지 등록 (일반/중요 선택) */}
      <Dialog open={!!noticeDlgFor} onOpenChange={(v) => { if (!v) setNoticeDlgFor(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>공지로 등록</DialogTitle></DialogHeader>
          {noticeDlgFor && (
            <div className="space-y-3">
              <div className="rounded-lg bg-gray-50 border px-3 py-2 text-sm text-gray-700 max-h-28 overflow-y-auto whitespace-pre-wrap">
                {noticeDlgFor.content || "🖼️ 이미지 공지"}
              </div>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={noticeImportantChk} onChange={(e) => setNoticeImportantChk(e.target.checked)} />
                <span>
                  <span className="font-semibold text-red-600">중요 공지</span>
                  <span className="block text-xs text-gray-500">전 멤버에게 즉시 푸시 + 확인 안 한 사람에게 매일 오전 9시 재알림</span>
                </span>
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setNoticeDlgFor(null)}>취소</Button>
                <Button size="sm" onClick={() => setChannelNoticeFrom(noticeDlgFor, noticeImportantChk)} className="bg-amber-500 hover:bg-amber-600">등록</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 공유된 링크 모아보기 */}
      <Dialog open={linksOpen} onOpenChange={setLinksOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>공유된 링크</DialogTitle></DialogHeader>
          {!links ? (
            <div className="py-8 text-center text-sm text-gray-400">불러오는 중…</div>
          ) : links.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">공유된 링크가 없습니다.</div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y">
              {links.map((l, i) => (
                <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="block py-2.5 hover:bg-gray-50 px-1 rounded">
                  <div className="text-sm text-indigo-600 truncate underline">{l.url}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{l.userName} · {format(new Date(l.createdAt), "MM/dd HH:mm")}</div>
                </a>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 투표 만들기 */}
      <Dialog open={pollOpen} onOpenChange={(o) => { setPollOpen(o); if (!o) setPollCloses(""); /* 닫을 때 리셋 — 다음에 열 때 과거 시각 잔존 방지 */ }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>투표 만들기</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="투표 질문 (예: 회식 날짜는?)" value={pollQ} onChange={(e) => setPollQ(e.target.value)} />
            <div className="space-y-2">
              {pollOpts.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input placeholder={`선택지 ${i + 1}`} value={o}
                    onChange={(e) => setPollOpts((prev) => prev.map((x, idx) => idx === i ? e.target.value : x))} />
                  {pollOpts.length > 2 && (
                    <button onClick={() => setPollOpts((prev) => prev.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-500"><X size={15} /></button>
                  )}
                </div>
              ))}
              {pollOpts.length < 10 && (
                <Button variant="outline" size="sm" onClick={() => setPollOpts((prev) => [...prev, ""])} className="gap-1"><Plus size={13} />선택지 추가</Button>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={pollMulti} onChange={(e) => setPollMulti(e.target.checked)} />
              복수 선택 허용
            </label>
            <div className="space-y-1">
              <label className="text-sm text-gray-600">종료 일시 (선택)</label>
              <Input type="datetime-local" value={pollCloses} min={format(new Date(), "yyyy-MM-dd'T'HH:mm")} onChange={(e) => setPollCloses(e.target.value)} />
              <p className="text-[11px] text-gray-400">설정하면 해당 시각에 자동 마감되고 채팅방에 알림이 올라갑니다. 전원이 투표하면 즉시 마감됩니다.</p>
            </div>
            <div className="flex justify-end">
              <Button onClick={createPoll} disabled={pollSubmitting || !pollQ.trim() || pollOpts.filter((o) => o.trim()).length < 2}
                className="bg-indigo-500 hover:bg-indigo-600">투표 올리기</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 읽음/안읽음 명단 */}
      <Dialog open={readersOpen} onOpenChange={setReadersOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>읽음 확인</DialogTitle></DialogHeader>
          {!readers ? (
            <div className="py-8 text-center text-sm text-gray-400">불러오는 중…</div>
          ) : (
            <div>
              <div className="flex border-b mb-2">
                {(["unread", "read"] as const).map((t) => (
                  <button key={t} onClick={() => setReadersTab(t)}
                    className={`flex-1 py-2 text-sm font-medium border-b-2 ${readersTab === t ? "border-indigo-500 text-indigo-600" : "border-transparent text-gray-400"}`}>
                    {t === "unread" ? `안 읽음 ${readers.unread.length}` : `읽음 ${readers.read.length}`}
                  </button>
                ))}
              </div>
              <div className="max-h-72 overflow-y-auto divide-y">
                {(readersTab === "unread" ? readers.unread : readers.read).length === 0 ? (
                  <div className="py-6 text-center text-sm text-gray-400">
                    {readersTab === "unread" ? "모두 읽었습니다." : "아직 읽은 사람이 없습니다."}
                  </div>
                ) : (readersTab === "unread" ? readers.unread : readers.read).map((r) => (
                  <div key={r.userId} className="flex items-center gap-2 py-2 text-sm">
                    <Avatar name={r.name} size={28} src={r.avatarUrl} />
                    <span>{r.name}</span>
                    {r.branch && <span className="text-xs text-gray-400">· {r.branch}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 멤버 초대 (구성원 누구나) */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>멤버 초대</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <Input className="pl-9" placeholder="직원 검색" value={addSearch} onChange={(e) => setAddSearch(e.target.value)} />
            </div>
            <div className="max-h-52 overflow-y-auto border rounded-lg divide-y">
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
            <div className="space-y-1 bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-medium text-gray-600">추가되는 멤버의 이전 채팅기록 열람</p>
              {([
                { v: "all", label: "이전 채팅기록 전체 보이기" },
                { v: "90days", label: "최근 90일 이내 채팅만 보이기" },
                { v: "none", label: "이전 채팅기록 없이 추가 (가입 이후만)" },
              ] as const).map((o) => (
                <label key={o.v} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
                  <input type="radio" name="inviteHistory" checked={addHistory === o.v} onChange={() => setAddHistory(o.v)} />
                  {o.label}
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={addMembers} disabled={addIds.length === 0}>{addIds.length > 0 ? `${addIds.length}명 초대` : "초대"}</Button>
            </div>
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

      {/* 인앱 사진 뷰어(라이트박스) — 채팅방의 모든 사진을 ←→로 넘겨 본다 (카톡식) */}
      {lightbox && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.urls[lightbox.index]}
            alt=""
            className="max-w-[92vw] max-h-[88vh] object-contain select-none"
            onClick={(e) => e.stopPropagation()}
          />
          {lightbox.index > 0 && (
            <button type="button" className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2"
              onClick={(e) => { e.stopPropagation(); setLightbox((p) => p && { ...p, index: p.index - 1 }); }}>
              <ChevronLeft size={26} />
            </button>
          )}
          {lightbox.index < lightbox.urls.length - 1 && (
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2"
              onClick={(e) => { e.stopPropagation(); setLightbox((p) => p && { ...p, index: p.index + 1 }); }}>
              <ChevronRight size={26} />
            </button>
          )}
          <div className="absolute top-4 left-0 right-0 flex items-center justify-between px-5" onClick={(e) => e.stopPropagation()}>
            <span className="text-white text-sm font-medium bg-black/50 rounded-full px-3 py-1">{lightbox.index + 1} / {lightbox.urls.length}</span>
            <div className="flex items-center gap-2">
              <a href={lightbox.urls[lightbox.index]} download className="bg-black/50 hover:bg-black/70 text-white rounded-full p-2" title="다운로드">
                <Download size={18} />
              </a>
              <button type="button" className="bg-black/50 hover:bg-black/70 text-white rounded-full p-2" onClick={() => setLightbox(null)} title="닫기 (Esc)">
                <X size={20} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
