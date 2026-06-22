"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Video, Plus, X, Users, Circle, Square, Send, Download, Trash2, Film, UserPlus, Search, PanelLeft } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Meeting = { id: string; room: string; title: string; channelId: string | null; createdBy: string; createdAt: string };
type Recording = { id: string; meetingTitle: string; room: string; fileUrl: string; fileName: string; sizeBytes: number; createdAt: string; canDelete: boolean };
type Msg = { id: string; userName: string; content: string; mine: boolean; createdAt: string };

function fmtSize(b: number) {
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}MB`;
  if (b > 1024) return `${(b / 1024).toFixed(0)}KB`;
  return `${b}B`;
}

/* 회의 중 사이드 채팅 */
function MeetingChat({ channelId }: { channelId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    const res = await fetch(`/api/work/channels/${channelId}/messages`);
    if (res.ok) setMessages((await res.json()).messages || []);
  }, [channelId]);

  useEffect(() => {
    fetchMessages();
    const es = new EventSource("/api/work/stream");
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data);
        if (e.type === "message" && e.channelId === channelId) fetchMessages();
      } catch { /* noop */ }
    };
    return () => es.close();
  }, [channelId, fetchMessages]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);

  async function send() {
    if (!input.trim()) return;
    const res = await fetch(`/api/work/channels/${channelId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: input }),
    });
    if (res.ok) { setInput(""); fetchMessages(); }
  }

  return (
    <div className="w-80 border-l bg-white flex flex-col shrink-0">
      <div className="px-4 py-3 border-b font-semibold text-sm">회의 채팅</div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 text-xs mt-6">회의 참석자와 대화하세요.</div>
        ) : messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.mine ? "items-end" : "items-start"}`}>
            {!m.mine && <span className="text-[11px] text-gray-500 ml-1">{m.userName}</span>}
            <div className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm ${m.mine ? "bg-indigo-500 text-white" : "bg-gray-100"}`}>{m.content}</div>
            <span className="text-[10px] text-gray-400 mx-1">{format(new Date(m.createdAt), "HH:mm")}</span>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 border-t flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }} placeholder="메시지..." className="h-9" />
        <Button size="sm" onClick={send} disabled={!input.trim()} className="bg-indigo-500 hover:bg-indigo-600"><Send size={14} /></Button>
      </div>
    </div>
  );
}

export default function WorkMeetingPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [active, setActive] = useState<Meeting | null>(null);
  const [title, setTitle] = useState("");
  const [me, setMe] = useState<{ id: string; name: string; role: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [isSecure, setIsSecure] = useState(true); // HTTPS(보안 컨텍스트) 여부 — 화상회의/녹화 필요
  // 직원 초대
  const [employees, setEmployees] = useState<{ id: string; name: string; branch?: string | null }[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteIds, setInviteIds] = useState<string[]>([]);
  const [inviteSearch, setInviteSearch] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  const fetchMeetings = useCallback(async () => {
    const res = await fetch("/api/work/meetings");
    if (res.ok) setMeetings((await res.json()).meetings || []);
  }, []);
  const fetchRecordings = useCallback(async () => {
    const res = await fetch("/api/work/recordings");
    if (res.ok) setRecordings((await res.json()).recordings || []);
  }, []);

  useEffect(() => {
    setIsSecure(typeof window !== "undefined" && window.isSecureContext);
    fetchMeetings(); fetchRecordings();
    fetch("/api/auth/me").then(r => r.json()).then(d => setMe(d.user ? { id: d.user.id, name: d.user.name, role: d.user.role } : null)).catch(() => {});
    fetch("/api/employees").then(r => r.ok ? r.json() : { employees: [] }).then(d => setEmployees(d.employees || [])).catch(() => {});
    const t = setInterval(fetchMeetings, 5000);
    return () => clearInterval(t);
  }, [fetchMeetings, fetchRecordings]);

  // 회의 입장 중에는 주기적으로 신호 전송(자동 종료 방지)
  useEffect(() => {
    if (!active) return;
    const ping = () => fetch(`/api/work/meetings/${active.id}/heartbeat`, { method: "POST" }).catch(() => {});
    ping();
    const t = setInterval(ping, 60000);
    return () => clearInterval(t);
  }, [active]);

  // 화상회의 화면에서 큐브티워크 사이드바 접기/펼치기 토글
  function toggleSidebar() {
    const n = localStorage.getItem("work_sidebar_collapsed") !== "1";
    localStorage.setItem("work_sidebar_collapsed", n ? "1" : "0");
    window.dispatchEvent(new Event("work-sidebar-changed"));
  }

  async function createMeeting() {
    const res = await fetch("/api/work/meetings", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim() || "화상회의" }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "개설 실패"); return; }
    setTitle(""); await fetchMeetings(); setActive(data.meeting);
  }

  async function sendInvite() {
    if (!active || inviteIds.length === 0) return;
    const res = await fetch(`/api/work/meetings/${active.id}/invite`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inviteIds }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "초대 실패"); return; }
    toast.success(`${d.invited}명에게 초대를 보냈습니다.`);
    setInviteOpen(false); setInviteIds([]); setInviteSearch("");
  }

  async function endMeeting(m: Meeting) {
    await fetch(`/api/work/meetings/${m.id}`, { method: "PATCH" });
    if (active?.id === m.id) { if (recording) stopRecording(); setActive(null); }
    fetchMeetings();
  }

  /* ── 녹화: 화면 + 시스템 오디오 + 마이크 ── */
  async function startRecording() {
    if (!active) return;
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      let mic: MediaStream | null = null;
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { /* 마이크 거부 시 화면+시스템음만 */ }

      // 오디오 믹싱 (시스템 + 마이크)
      const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC();
      const dest = ctx.createMediaStreamDestination();
      if (display.getAudioTracks().length) ctx.createMediaStreamSource(display).connect(dest);
      if (mic) ctx.createMediaStreamSource(mic).connect(dest);
      const mixed = new MediaStream([display.getVideoTracks()[0], ...dest.stream.getAudioTracks()]);

      chunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
      const rec = new MediaRecorder(mixed, { mimeType: mime });
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        await uploadRecording(blob);
      };
      cleanupRef.current = () => {
        display.getTracks().forEach((t) => t.stop());
        mic?.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
      };
      // 사용자가 브라우저 공유중지 누르면 자동 종료
      display.getVideoTracks()[0].addEventListener("ended", () => stopRecording());
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      toast.success("녹화를 시작했습니다.");
    } catch {
      toast.error("녹화를 시작할 수 없습니다. 화면 공유를 허용해주세요.");
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    cleanupRef.current?.(); cleanupRef.current = null;
    setRecording(false);
  }

  async function uploadRecording(blob: Blob) {
    if (!active) return;
    const fd = new FormData();
    fd.append("file", blob, "recording.webm");
    fd.append("meetingTitle", active.title);
    fd.append("room", active.room);
    const res = await fetch("/api/work/recordings", { method: "POST", body: fd });
    if (res.ok) { toast.success("녹화본이 저장되었습니다. (녹화 기록에서 다운로드)"); fetchRecordings(); }
    else toast.error("녹화본 저장에 실패했습니다.");
  }

  async function deleteRecording(id: string) {
    const res = await fetch(`/api/work/recordings/${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("삭제되었습니다."); fetchRecordings(); }
    else toast.error("삭제 실패");
  }

  // ── 회의 참여 화면 ──
  if (active) {
    const displayName = encodeURIComponent(me?.name || "");
    const src = `https://meet.jit.si/${active.room}#userInfo.displayName=%22${displayName}%22&config.prejoinPageEnabled=false`;
    return (
      <div className="h-screen flex flex-col">
        <div className="px-6 py-3 border-b bg-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={toggleSidebar} title="사이드바 접기/펼치기" className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><PanelLeft size={16} /></button>
            <Video size={18} className="text-indigo-500" />
            <span className="font-semibold">{active.title}</span>
            <span className="text-xs text-gray-400">방: {active.room}</span>
            {recording && <span className="flex items-center gap-1 text-xs text-red-500 font-medium ml-2"><Circle size={10} className="fill-red-500 animate-pulse" />녹화 중</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setInviteIds([]); setInviteSearch(""); setInviteOpen(true); }} className="gap-1 text-indigo-600 border-indigo-200"><UserPlus size={14} />초대</Button>
            {!recording ? (
              <Button variant="outline" size="sm" onClick={startRecording} className="gap-1 text-red-600 border-red-200"><Circle size={13} />녹화 시작</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={stopRecording} className="gap-1 text-red-600 border-red-300"><Square size={13} />녹화 중지</Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setShowChat((s) => !s)}>{showChat ? "채팅 숨기기" : "채팅 보기"}</Button>
            <Button variant="outline" size="sm" onClick={() => { if (recording) stopRecording(); setActive(null); }}>나가기</Button>
            {me?.id === active.createdBy && <Button variant="destructive" size="sm" onClick={() => endMeeting(active)}>회의 종료</Button>}
          </div>
        </div>
        <div className="flex-1 flex min-h-0">
          {isSecure ? (
            <iframe
              src={src}
              allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
              className="flex-1 w-full border-0"
              title={active.title}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 text-center px-6">
              <Video size={40} className="text-indigo-400 mb-4" />
              <p className="text-white text-lg font-semibold">화상회의는 보안 연결(HTTPS)에서만 사용할 수 있습니다.</p>
              <p className="text-gray-300 text-sm mt-2 leading-relaxed">
                브라우저 보안 정책상 카메라·마이크(WebRTC)는 HTTPS 주소에서만 동작합니다.<br />
                도메인 연결 + HTTPS 적용 후 정상 이용할 수 있습니다. (현재는 http 주소)
              </p>
            </div>
          )}
          {showChat && active.channelId && <MeetingChat channelId={active.channelId} />}
        </div>

        {/* 직원 초대 */}
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>직원 초대</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-xs text-gray-500">선택한 직원에게 채팅(DM)으로 회의 참여 링크를 보냅니다.</p>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <Input className="pl-9" placeholder="직원 검색" value={inviteSearch} onChange={(e) => setInviteSearch(e.target.value)} />
              </div>
              <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                {employees.filter((e) => e.id !== me?.id && (!inviteSearch || e.name.includes(inviteSearch))).map((e) => (
                  <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={inviteIds.includes(e.id)}
                      onChange={(ev) => setInviteIds((prev) => ev.target.checked ? [...prev, e.id] : prev.filter((x) => x !== e.id))} />
                    {e.name}{e.branch && <span className="text-xs text-gray-400">· {e.branch}</span>}
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setInviteOpen(false)}>취소</Button>
                <Button onClick={sendInvite} disabled={inviteIds.length === 0}>{inviteIds.length > 0 ? `${inviteIds.length}명 초대` : "초대"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-6"><Video size={22} className="text-indigo-500" />화상회의</h1>

      {/* 새 회의 개설 */}
      <div className="bg-white border rounded-xl p-5 mb-6">
        <p className="font-semibold mb-3">새 회의 시작</p>
        <div className="flex gap-2">
          <Input placeholder="회의 제목 (예: 주간 회의)" value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createMeeting(); }} />
          <Button onClick={createMeeting} className="gap-1 bg-indigo-500 hover:bg-indigo-600 shrink-0"><Plus size={16} />회의 개설</Button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Jitsi Meet(오픈소스·무료) 기반 · 회의 중 채팅·녹화 지원. 카메라·마이크 권한을 허용해주세요.</p>
      </div>

      {/* 진행 중인 회의 */}
      <p className="font-semibold mb-3 flex items-center gap-2"><Users size={16} />진행 중인 회의 <span className="text-sm text-gray-400">{meetings.length}개</span></p>
      {meetings.length === 0 ? (
        <div className="text-center text-gray-400 py-10 border rounded-xl bg-white mb-8">진행 중인 회의가 없습니다.</div>
      ) : (
        <div className="space-y-2 mb-8">
          {meetings.map((m) => (
            <div key={m.id} className="flex items-center justify-between bg-white border rounded-lg px-4 py-3">
              <div>
                <p className="font-medium">{m.title}</p>
                <p className="text-xs text-gray-400">{format(new Date(m.createdAt), "MM/dd HH:mm")} 개설 · 방 {m.room}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setActive(m)} className="gap-1 bg-indigo-500 hover:bg-indigo-600"><Video size={14} />참여</Button>
                {(me?.id === m.createdBy || me?.role === "ADMIN") && <Button size="sm" variant="ghost" className="text-red-500" onClick={() => endMeeting(m)} title="회의 종료"><X size={14} /></Button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 녹화 기록 */}
      <p className="font-semibold mb-3 flex items-center gap-2"><Film size={16} />녹화 기록 <span className="text-sm text-gray-400">{recordings.length}개</span></p>
      {recordings.length === 0 ? (
        <div className="text-center text-gray-400 py-10 border rounded-xl bg-white">저장된 녹화본이 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {recordings.map((r) => (
            <div key={r.id} className="flex items-center justify-between bg-white border rounded-lg px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium truncate">{r.meetingTitle}</p>
                <p className="text-xs text-gray-400">{format(new Date(r.createdAt), "yyyy.MM.dd HH:mm")} · {fmtSize(r.sizeBytes)}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <a href={r.fileUrl} download={r.fileName}><Button size="sm" variant="outline" className="gap-1"><Download size={14} />다운로드</Button></a>
                {r.canDelete && <Button size="sm" variant="ghost" className="text-red-500" onClick={() => deleteRecording(r.id)}><Trash2 size={14} /></Button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
