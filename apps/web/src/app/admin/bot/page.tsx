"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Send, Bot, Paperclip, X, Folder, ChevronDown, ChevronRight } from "lucide-react";

type Attachment = { url: string; name: string; type: string };
type Briefing = {
  id: string;
  name: string;
  folder: string | null;
  time: string;
  repeat: string;
  repeatValue: string | null;
  channelId: string | null;
  branch: string | null;
  enabled: boolean;
  showLeaves: boolean;
  showEvents: boolean;
  showAnniv: boolean;
  showBirthday: boolean;
  customText: string | null;
  attachments: Attachment[] | null;
  monthlyAttach: boolean;
  lastSentAt: string | null;
};

// 파일명에서 월(1~12) 추출 — 서버(lib/bot.ts monthFromFileName)와 동일 규칙
function monthFromFileName(name: string): number | null {
  const kr = name.match(/(\d{1,2})\s*월/);
  if (kr) { const n = parseInt(kr[1]); if (n >= 1 && n <= 12) return n; }
  const ym = name.match(/^20\d{2}[-_.년\s]+(\d{1,2})(?!\d)/);
  if (ym) { const n = parseInt(ym[1]); if (n >= 1 && n <= 12) return n; }
  const lead = name.match(/^(\d{1,2})(?!\d)/);
  if (lead) { const n = parseInt(lead[1]); if (n >= 1 && n <= 12) return n; }
  return null;
}
type Channel = { id: string; name: string; isDefault: boolean };

const ITEM_LABELS: { key: "showLeaves" | "showEvents" | "showAnniv" | "showBirthday"; label: string; desc: string }[] = [
  { key: "showLeaves", label: "🌴 오늘 휴가자", desc: "승인된 휴가 중 오늘 해당자" },
  { key: "showEvents", label: "📅 오늘 일정", desc: "캘린더의 오늘 일정" },
  { key: "showAnniv", label: "🎊 입사기념일", desc: "입사일이 오늘인 직원" },
  { key: "showBirthday", label: "🎂 오늘 생일", desc: "직원관리에 생일 입력 필요" },
];

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const REPEAT_LABEL: Record<string, string> = { DAILY: "매일", WEEKLY: "매주", MONTHLY: "매월", YEARLY: "매년" };

export default function AdminBotPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  // 시스템 알림 수신자 (2026-09-03) — 담당자가 바뀌면 여기서 체크만 바꾸면 된다
  const [admins, setAdmins] = useState<{ id: string; name: string; email: string }[]>([]);
  const [sysTargets, setSysTargets] = useState<string[] | null>(null); // null = 미지정(관리자 전원)
  const [sysSaving, setSysSaving] = useState(false); // 저장 중 연타하면 옛 값으로 계산돼 토글이 유실된다
  const [newName, setNewName] = useState("");
  const [newTime, setNewTime] = useState("09:00");
  const [newFolder, setNewFolder] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // 폴더 이동 (드롭다운의 "+ 새 폴더" 선택 시 이름 입력)
  function moveFolder(b: Briefing, value: string) {
    if (value === "__new__") {
      const name = window.prompt("새 폴더 이름을 입력하세요 (예: 지점별, TM, 원장)");
      if (!name?.trim()) return;
      patch(b.id, { folder: name.trim() }, true);
    } else {
      patch(b.id, { folder: value || null }, true);
    }
  }

  function toggleFolder(f: string) {
    setCollapsed((prev) => {
      const n = new Set(prev);
      n.has(f) ? n.delete(f) : n.add(f);
      return n;
    });
  }
  const uploadForRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [forceNotify, setForceNotify] = useState(false);

  const fetchAll = useCallback(async () => {
    const res = await fetch("/api/admin/bot-briefings");
    if (res.ok) {
      const d = await res.json();
      setBriefings(d.briefings || []);
      setChannels(d.channels || []);
      setBranches(d.branches || []);
    }
    const p = await fetch("/api/admin/notify-policy");
    if (p.ok) {
      const d = await p.json();
      setForceNotify(d.forceApprovalNotify || false);
      setAdmins(d.admins || []);
      setSysTargets(d.systemTargets ?? null);
    }
    setLoading(false);
  }, []);

  async function toggleForceNotify(v: boolean) {
    const res = await fetch("/api/admin/notify-policy", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ forceApprovalNotify: v }),
    });
    if (res.ok) { setForceNotify(v); toast.success(v ? "결재 알림을 강제 발송합니다 (직원 설정 무시)." : "직원 개인 설정을 따릅니다."); }
    else toast.error("변경 실패");
  }

  async function toggleSysTarget(id: string, on: boolean) {
    if (sysSaving) return;
    setSysSaving(true);
    try {
    const base = sysTargets ?? admins.map((a) => a.id); // 미지정 상태에서 첫 체크 해제면 전원에서 빼는 것
    const next = on ? [...new Set([...base, id])] : base.filter((x) => x !== id);
    const res = await fetch("/api/admin/notify-policy", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemTargets: next }),
    });
    if (res.ok) {
      setSysTargets((await res.json()).systemTargets ?? next);
      toast.success(next.length ? `${next.length}명이 시스템 알림을 받습니다.` : "아무도 고르지 않아 관리자 전원에게 갑니다.");
    } else toast.error("변경 실패");
    } finally { setSysSaving(false); }
  }

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function patch(id: string, data: Record<string, unknown>, silent = false) {
    const res = await fetch(`/api/admin/bot-briefings/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "저장 실패"); return false; }
    if (!silent) toast.success("저장되었습니다.");
    fetchAll();
    return true;
  }

  async function addBriefing() {
    if (!newName.trim()) { toast.error("브리핑 이름을 입력해주세요."); return; }
    const res = await fetch("/api/admin/bot-briefings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, time: newTime, folder: newFolder || null }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "추가 실패"); return; }
    toast.success("브리핑이 추가되었습니다.");
    setAddOpen(false); setNewName(""); setNewTime("09:00"); setNewFolder("");
    fetchAll();
  }

  async function removeBriefing(b: Briefing) {
    if (!window.confirm(`"${b.name}" 브리핑을 삭제할까요?`)) return;
    const res = await fetch(`/api/admin/bot-briefings/${b.id}`, { method: "DELETE" });
    if (res.ok) { toast.success("삭제되었습니다."); fetchAll(); }
    else toast.error("삭제 실패");
  }

  async function sendNow(b: Briefing) {
    const res = await fetch(`/api/admin/bot-briefings/${b.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sendNow: true }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "발송 실패"); return; }
    if (d.result === "sent") toast.success("브리핑을 게시했습니다.");
    else if (d.result === "empty") toast.info("오늘은 알릴 내용이 없어 게시하지 않았습니다. (커스텀 문구나 첨부가 있으면 항상 발송됩니다)");
    else toast.info("브리핑이 비활성 상태이거나 발송 채널이 없습니다.");
    fetchAll();
  }

  // 첨부 업로드 (기존 채팅 업로드 재사용) — 여러 파일 한 번에 선택 가능 (12개월치 카드뉴스 등)
  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const briefingId = uploadForRef.current;
    e.target.value = "";
    if (!files.length || !briefingId) return;
    const b = briefings.find((x) => x.id === briefingId);
    if (!b) return;
    const added: Attachment[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/work/upload", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) { toast.error(`${file.name}: ${d.error || "업로드 실패"}`); continue; }
      added.push({ url: d.fileUrl, name: d.fileName, type: d.fileType });
    }
    if (!added.length) return;
    const next = [...(b.attachments || []), ...added];
    await patch(briefingId, { attachments: next });
  }

  function toggleWeekday(b: Briefing, day: number) {
    const cur = (b.repeatValue || "").split(",").map((s) => parseInt(s)).filter((n) => !isNaN(n));
    const next = cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort();
    patch(b.id, { repeatValue: next.join(",") }, true);
  }

  if (loading) return <div className="p-8 text-gray-400">불러오는 중…</div>;

  // 폴더 목록 (브리핑에 지정된 폴더들, 가나다순)
  const folders = Array.from(new Set(briefings.map((b) => b.folder).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "ko"));

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
      <input ref={fileRef} type="file" multiple className="hidden" onChange={onFilePicked} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bot className="text-indigo-500" /> 큐브티 봇 설정</h1>
          <p className="text-sm text-gray-500 mt-1">브리핑별로 발송 채널·주기·시간·포함 항목·첨부를 설정합니다.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-1 bg-indigo-500 hover:bg-indigo-600"><Plus size={15} />브리핑 추가</Button>
      </div>

      {/* 결재 알림 정책 */}
      <Card>
        <CardContent className="pt-4 pb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">✅ 결재 결과 알림 강제 발송</p>
            <p className="text-xs text-gray-500 mt-0.5">
              켜면 직원 개인 설정과 무관하게 휴가·근무일정 결재 결과를 항상 알립니다.
              끄면 각 직원이 앱/웹 설정에서 수신 여부를 선택합니다. (기본: 직원 선택)
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer shrink-0">
            <input type="checkbox" checked={forceNotify} onChange={(e) => toggleForceNotify(e.target.checked)} />
            강제 발송
          </label>
        </CardContent>
      </Card>

      {/* 시스템 알림 수신자 (2026-09-03) — 종전에는 관리자 전원 7명에게 뿌렸다.
          담당자는 바뀌므로 코드가 아니라 여기서 고른다. */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div>
            <p className="text-sm font-semibold">🩺 시스템 점검·오류 알림을 받을 사람</p>
            <p className="text-xs text-gray-500 mt-0.5">
              서버 오류·디스크·실패 응답 알림을 봇 DM 으로 받습니다. 담당자가 바뀌면 여기서 바꾸세요.
              {/* 아무도 안 받는 상태를 만들면 알림이 조용히 사라진다 — 그게 가장 위험하다 */}
              <br />아무도 고르지 않으면 <b>관리자 전원</b>에게 갑니다. (개선 제안 접수 알림은 전원 그대로)
            </p>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {admins.map((a) => {
              const on = sysTargets === null ? true : sysTargets.includes(a.id);
              return (
                <label key={a.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={on} disabled={sysSaving} onChange={(e) => toggleSysTarget(a.id, e.target.checked)} />
                  {a.name}
                </label>
              );
            })}
            {admins.length === 0 && <span className="text-xs text-gray-400">불러오는 중…</span>}
          </div>
          {sysTargets !== null && sysTargets.length === 0 && (
            <p className="text-xs text-amber-600">아무도 고르지 않아 관리자 전원에게 갑니다.</p>
          )}
        </CardContent>
      </Card>

      {["", ...folders].map((folderKey) => {
        const list = briefings.filter((b) => (b.folder || "") === folderKey);
        if (!list.length) return null;
        const isCollapsed = collapsed.has(folderKey);
        return (
          <div key={folderKey || "__none__"} className="space-y-3">
            <button onClick={() => toggleFolder(folderKey)}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 w-full">
              {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              <Folder size={14} className="text-indigo-400" />
              {folderKey || "미분류"}
              <span className="text-xs text-gray-400 font-normal">({list.length})</span>
            </button>
            {!isCollapsed && list.map((b) => (
        <Card key={b.id} className={b.enabled ? "" : "opacity-60"}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-base">
                <Input className="w-44 h-8 font-semibold" defaultValue={b.name}
                  onBlur={(e) => { if (e.target.value.trim() && e.target.value !== b.name) patch(b.id, { name: e.target.value }); }} />
              </CardTitle>
              <div className="flex items-center gap-2 shrink-0">
                <select className="rounded-md border px-2 py-1.5 text-xs bg-white text-gray-500 max-w-[130px]"
                  value={b.folder || ""} onChange={(e) => moveFolder(b, e.target.value)} title="폴더 이동">
                  <option value="">📂 미분류</option>
                  {folders.map((f) => <option key={f} value={f}>📂 {f}</option>)}
                  <option value="__new__">＋ 새 폴더…</option>
                </select>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={b.enabled} onChange={(e) => patch(b.id, { enabled: e.target.checked }, true)} />
                  사용
                </label>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => sendNow(b)}><Send size={13} />지금 발송</Button>
                <Button variant="ghost" size="sm" className="text-red-500" onClick={() => removeBriefing(b)}><Trash2 size={14} /></Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 발송 채널 + 대상 범위 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500">발송 채널</label>
                <select className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-white"
                  value={b.channelId || ""} onChange={(e) => patch(b.id, { channelId: e.target.value || null }, true)}>
                  {channels.map((c) => (
                    <option key={c.id} value={c.isDefault ? "" : c.id}>{c.isDefault ? "# 전체 (기본)" : `# ${c.name}`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">대상 범위 (휴가자/기념일/생일 필터)</label>
                <select className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-white"
                  value={b.branch || ""} onChange={(e) => patch(b.id, { branch: e.target.value || null }, true)}>
                  <option value="">전사 (모든 지점)</option>
                  {branches.map((br) => <option key={br} value={br}>{br}</option>)}
                </select>
              </div>
            </div>

            {/* 반복 주기 + 시간 */}
            <div className="flex items-center gap-2 flex-wrap">
              <select className="rounded-md border px-3 py-2 text-sm bg-white"
                value={b.repeat} onChange={(e) => {
                  const r = e.target.value;
                  const dv = r === "WEEKLY" ? "1,2,3,4,5" : r === "MONTHLY" ? "1" : r === "YEARLY" ? "01-01" : null;
                  patch(b.id, { repeat: r, repeatValue: dv }, true);
                }}>
                {Object.entries(REPEAT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>

              {b.repeat === "WEEKLY" && (
                <div className="flex gap-1">
                  {WEEKDAYS.map((d, i) => {
                    const on = (b.repeatValue || "").split(",").includes(String(i));
                    return (
                      <button key={d} onClick={() => toggleWeekday(b, i)}
                        className={`w-8 h-8 rounded-full text-xs font-semibold border ${on ? "bg-indigo-500 text-white border-indigo-500" : "bg-white text-gray-500"}`}>
                        {d}
                      </button>
                    );
                  })}
                </div>
              )}
              {b.repeat === "MONTHLY" && (
                <span className="flex items-center gap-1 text-sm">
                  매월 <Input type="number" min={1} max={31} className="w-16 h-9" defaultValue={b.repeatValue || "1"}
                    onBlur={(e) => { const v = Math.min(31, Math.max(1, parseInt(e.target.value) || 1)); patch(b.id, { repeatValue: String(v) }, true); }} /> 일
                  <span className="text-xs text-gray-400">(짧은 달은 말일 발송)</span>
                </span>
              )}
              {b.repeat === "YEARLY" && (
                <span className="flex items-center gap-1 text-sm">
                  매년 <Input type="text" placeholder="MM-DD" className="w-24 h-9" defaultValue={b.repeatValue || "01-01"}
                    onBlur={(e) => { if (/^\d{2}-\d{2}$/.test(e.target.value)) patch(b.id, { repeatValue: e.target.value }, true); else toast.error("MM-DD 형식으로 입력해주세요 (예: 03-02)"); }} />
                </span>
              )}

              <span className="text-sm text-gray-400">시간</span>
              <Input type="time" className="w-28 h-9" defaultValue={b.time}
                onBlur={(e) => { if (e.target.value && e.target.value !== b.time) patch(b.id, { time: e.target.value }); }} />
            </div>

            {/* 포함 항목 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {ITEM_LABELS.map((item) => (
                <label key={item.key} className="flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" className="mt-0.5" checked={b[item.key]}
                    onChange={(e) => patch(b.id, { [item.key]: e.target.checked }, true)} />
                  <span>
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="block text-[11px] text-gray-400">{item.desc}</span>
                  </span>
                </label>
              ))}
            </div>

            {/* 커스텀 문구 */}
            <div>
              <label className="text-xs font-medium text-gray-500">📢 커스텀 문구 (매번 포함, 비우면 미포함)</label>
              <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm resize-y min-h-[56px]"
                defaultValue={b.customText || ""} placeholder="예: 이번 주 금요일은 전사 회식입니다 🍻"
                onBlur={(e) => { if ((e.target.value.trim() || null) !== (b.customText || null)) patch(b.id, { customText: e.target.value }); }} />
            </div>

            {/* 첨부 (이미지/파일 — 브리핑과 함께 자동 발송) */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-500">📎 첨부 (브리핑과 함께 발송 — 카드뉴스 이미지 등)</label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={b.monthlyAttach}
                      onChange={(e) => patch(b.id, { monthlyAttach: e.target.checked })} />
                    🗓️ 월별 자동 매칭
                  </label>
                  <Button variant="outline" size="sm" className="gap-1 h-7 text-xs"
                    onClick={() => { uploadForRef.current = b.id; fileRef.current?.click(); }}>
                    <Paperclip size={12} />첨부 추가
                  </Button>
                </div>
              </div>
              {b.monthlyAttach && (
                <p className="mt-1 text-[11px] text-indigo-500">
                  파일명에서 월을 읽어 해당 월에만 발송합니다 (예: &quot;3월 카드뉴스&quot;, &quot;03_카드뉴스&quot;). 월을 읽지 못한 파일은 매번 발송됩니다.
                </p>
              )}
              {(b.attachments?.length ?? 0) > 0 && (
                <div className="mt-2 space-y-1.5">
                  {b.attachments!.map((a, i) => {
                    const month = b.monthlyAttach ? monthFromFileName(a.name || "") : null;
                    return (
                    <div key={i} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-1.5">
                      {a.type === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.url} alt="" className="w-9 h-9 rounded object-cover" />
                      ) : (
                        <Paperclip size={14} className="text-gray-400" />
                      )}
                      <span className="flex-1 truncate">{a.name}</span>
                      {b.monthlyAttach && (
                        month !== null ? (
                          <span className="shrink-0 text-[11px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">{month}월</span>
                        ) : (
                          <span className="shrink-0 text-[11px] text-gray-500 bg-gray-50 border rounded-full px-2 py-0.5">매번</span>
                        )
                      )}
                      <button onClick={() => patch(b.id, { attachments: b.attachments!.filter((_, idx) => idx !== i) }, true)}
                        className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                    </div>
                  );})}
                </div>
              )}
            </div>

            {b.lastSentAt && (
              <p className="text-[11px] text-gray-400">마지막 발송: {new Date(b.lastSentAt).toLocaleString("ko-KR")}</p>
            )}
          </CardContent>
        </Card>
            ))}
          </div>
        );
      })}

      <p className="text-xs text-gray-400">
        ℹ️ 대상 범위를 지점으로 지정하면 그 지점 구성원의 휴가·기념일·생일만 브리핑됩니다 (일정은 전사 일정 + 해당 지점 일정).
        예) "1월 업무 카드뉴스"를 매년 01-01로 12개 만들어두면 매월 자동 발송됩니다.
        결재 결과 DM과 중요 공지 재알림(매일 09:00)은 브리핑과 별개로 항상 동작합니다.
      </p>

      {/* 브리핑 추가 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>브리핑 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="브리핑 이름 (예: A지점 아침 브리핑)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <div className="flex items-center gap-2 text-sm">
              매일 <Input type="time" className="w-32" value={newTime} onChange={(e) => setNewTime(e.target.value)} /> 발송
            </div>
            <div>
              <label className="text-xs text-gray-500">폴더 (선택 — 새 이름을 입력하면 폴더가 만들어집니다)</label>
              <Input className="mt-1" placeholder="예: 지점별, TM, 원장" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} list="folder-options" />
              <datalist id="folder-options">
                {folders.map((f) => <option key={f} value={f} />)}
              </datalist>
            </div>
            <p className="text-xs text-gray-400">추가 후 카드에서 채널/주기/항목을 세부 설정할 수 있습니다.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>취소</Button>
              <Button size="sm" onClick={addBriefing} className="bg-indigo-500 hover:bg-indigo-600">추가</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
