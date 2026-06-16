"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Video, Plus, X, Users } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Meeting = { id: string; room: string; title: string; createdBy: string; createdAt: string };

export default function WorkMeetingPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [active, setActive] = useState<Meeting | null>(null);
  const [title, setTitle] = useState("");
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);

  const fetchMeetings = useCallback(async () => {
    const res = await fetch("/api/work/meetings");
    if (res.ok) setMeetings((await res.json()).meetings || []);
  }, []);

  useEffect(() => {
    fetchMeetings();
    fetch("/api/auth/me").then(r => r.json()).then(d => setMe(d.user ? { id: d.user.id, name: d.user.name } : null)).catch(() => {});
    const t = setInterval(fetchMeetings, 5000);
    return () => clearInterval(t);
  }, [fetchMeetings]);

  async function createMeeting() {
    const res = await fetch("/api/work/meetings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() || "화상회의" }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "개설 실패"); return; }
    setTitle("");
    await fetchMeetings();
    setActive(data.meeting);
  }

  async function endMeeting(m: Meeting) {
    await fetch(`/api/work/meetings/${m.id}`, { method: "PATCH" });
    if (active?.id === m.id) setActive(null);
    fetchMeetings();
  }

  // 회의 참여 화면 (Jitsi iframe 임베드)
  if (active) {
    const displayName = encodeURIComponent(me?.name || "");
    const src = `https://meet.jit.si/${active.room}#userInfo.displayName=%22${displayName}%22&config.prejoinPageEnabled=false`;
    return (
      <div className="h-screen flex flex-col">
        <div className="px-6 py-3 border-b bg-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video size={18} className="text-indigo-500" />
            <span className="font-semibold">{active.title}</span>
            <span className="text-xs text-gray-400">방: {active.room}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setActive(null)}>나가기</Button>
            {(me?.id === active.createdBy) && (
              <Button variant="destructive" size="sm" onClick={() => endMeeting(active)}>회의 종료</Button>
            )}
          </div>
        </div>
        <iframe
          src={src}
          allow="camera; microphone; fullscreen; display-capture; autoplay"
          className="flex-1 w-full border-0"
          title={active.title}
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-6">
        <Video size={22} className="text-indigo-500" />화상회의
      </h1>

      {/* 새 회의 개설 */}
      <div className="bg-white border rounded-xl p-5 mb-6">
        <p className="font-semibold mb-3">새 회의 시작</p>
        <div className="flex gap-2">
          <Input placeholder="회의 제목 (예: 주간 회의)" value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createMeeting(); }} />
          <Button onClick={createMeeting} className="gap-1 bg-indigo-500 hover:bg-indigo-600 shrink-0"><Plus size={16} />회의 개설</Button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Jitsi Meet(오픈소스·무료) 기반. 카메라·마이크 권한을 허용해주세요.</p>
      </div>

      {/* 진행 중인 회의 */}
      <p className="font-semibold mb-3 flex items-center gap-2"><Users size={16} />진행 중인 회의 <span className="text-sm text-gray-400">{meetings.length}개</span></p>
      {meetings.length === 0 ? (
        <div className="text-center text-gray-400 py-12 border rounded-xl bg-white">진행 중인 회의가 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {meetings.map((m) => (
            <div key={m.id} className="flex items-center justify-between bg-white border rounded-lg px-4 py-3">
              <div>
                <p className="font-medium">{m.title}</p>
                <p className="text-xs text-gray-400">{format(new Date(m.createdAt), "MM/dd HH:mm")} 개설 · 방 {m.room}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setActive(m)} className="gap-1 bg-indigo-500 hover:bg-indigo-600"><Video size={14} />참여</Button>
                {(me?.id === m.createdBy) && (
                  <Button size="sm" variant="ghost" className="text-red-500" onClick={() => endMeeting(m)}><X size={14} /></Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
