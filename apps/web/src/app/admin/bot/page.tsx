"use client";

// 개발자 › 봇 알림 담당자(최고 관리자) — 결재 알림 강제 발송 + 종류별 봇 알림 받는 담당자.
// 2026-11-02 디렉터 회의 4번: 브리핑(추가 · 수정 · 발송)은 설정 › 봇 브리핑(/admin/bot-briefings, 모든 관리자)으로 옮기고,
// 「봇 알림 받는 담당자 설정, 체크는 개발자 자리에 두고」 — 이 화면에 남겼다.
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Bot, BellRing } from "lucide-react";
import { Box, tableClass } from "@/components/kit";

// 봇 알림 종류(서버 lib/notify-targets NOTIFY_TOPICS 가 원천 — 화면은 받은 목록을 그대로 그린다)
type NotifyTopicRow = { key: string; label: string; hint: string };

export default function AdminBotPage() {
  const [loading, setLoading] = useState(true);
  // 봇 알림 받는 담당자 (2026-09-03 시스템 알림 → 2026-10-26 종류별) — 담당자가 바뀌면 여기서 체크만 바꾸면 된다
  const [admins, setAdmins] = useState<{ id: string; name: string; email: string }[]>([]);
  const [topics, setTopics] = useState<NotifyTopicRow[]>([]);
  const [targets, setTargets] = useState<Record<string, string[] | null>>({}); // 종류별. null = 미지정(관리자 전원)
  // 화면에 안 보이는 수신자(개발자 영역 계정)가 지정에 들어 있다 — 보이는 체크가 비어도 「전원」이 아니다(2026-10-17)
  const [hiddenTopics, setHiddenTopics] = useState<Record<string, boolean>>({});
  const [tgtSaving, setTgtSaving] = useState(false); // 저장 중 연타하면 옛 값으로 계산돼 토글이 유실된다
  const [forceNotify, setForceNotify] = useState(false);

  const fetchAll = useCallback(async () => {
    const p = await fetch("/api/admin/notify-policy");
    if (p.ok) {
      const d = await p.json();
      setForceNotify(d.forceApprovalNotify || false);
      setAdmins(d.admins || []);
      setTopics(d.topics || []);
      setTargets(d.targets || {});
      setHiddenTopics(d.hiddenTopics || {});
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

  // 체크 하나 바꾸면 **그 종류만** 저장한다
  async function toggleTarget(topic: NotifyTopicRow, id: string, on: boolean) {
    if (tgtSaving) return;
    setTgtSaving(true);
    try {
      const cur = targets[topic.key] ?? null;
      const base = cur ?? admins.map((a) => a.id); // 미지정 상태에서 첫 체크 해제면 전원에서 빼는 것
      const next = on ? [...new Set([...base, id])] : base.filter((x) => x !== id);
      const res = await fetch("/api/admin/notify-policy", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targets: { [topic.key]: next } }),
      });
      if (res.ok) {
        const d = await res.json();
        const saved: string[] = d.targets?.[topic.key] ?? next;
        const hiddenAny = !!d.hiddenTopics?.[topic.key];
        setTargets((prev) => ({ ...prev, [topic.key]: saved }));
        setHiddenTopics((prev) => ({ ...prev, [topic.key]: hiddenAny }));
        toast.success(saved.length ? `${topic.label} — ${saved.length}명이 받습니다.` : hiddenAny ? `${topic.label} — 지정된 수신자만 받습니다(일부는 표시 안 됨).` : `${topic.label} — 아무도 고르지 않아 관리자 전원에게 갑니다.`);
      } else toast.error("변경 실패");
    } finally { setTgtSaving(false); }
  }

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) return <div className="p-8 text-gray-400">불러오는 중…</div>;

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Bot className="text-indigo-500" /> 봇 알림 담당자</h1>
        <p className="text-sm text-gray-500 mt-1">봇이 관리자에게 보내는 알림의 받는 사람과 결재 알림 정책입니다. 브리핑은 <a href="/admin/bot-briefings" className="text-indigo-600 underline">설정 › 봇 브리핑</a>에서 관리합니다.</p>
      </div>

      {/* 결재 알림 정책 */}
      <Card>
        <CardContent className="pt-4 pb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">✅ 결재 결과 알림 강제 발송</p>
            <p className="text-xs text-gray-500 mt-0.5">
              켜면 직원 개인 설정과 무관하게 휴가·근무일정 결재 결과를 항상 푸시로 알립니다.
              끄면 푸시 수신 여부를 각 직원이 앱/웹 설정에서 선택합니다. 결과 메시지는 어느 쪽이든 봇 대화방에 남습니다. (기본: 직원 선택)
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer shrink-0">
            <input type="checkbox" checked={forceNotify} onChange={(e) => toggleForceNotify(e.target.checked)} />
            강제 발송
          </label>
        </CardContent>
      </Card>

      {/* 봇 알림 받는 담당자 (2026-09-03 시스템 알림 하나 → 2026-10-26 디렉터 지시로 종류별) — 종전에는 관리자 전원에게 뿌렸다.
          담당자는 바뀌므로 코드가 아니라 여기서 고른다. 줄 = 알림 종류, 열 = 관리자. */}
      <Box icon={<BellRing />} title="봇 알림 받는 담당자" sub="종류별로 봇 DM 을 받을 관리자를 고릅니다. 아무도 고르지 않은 종류는 관리자 전원에게 갑니다." className="mb-0" bodyClassName="p-0">
        {/* 아무도 안 받는 상태를 만들면 알림이 조용히 사라진다 — 그게 가장 위험하다. 그래서 빈 줄은 「전원」으로 되돌린다 */}
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead>
              <tr>
                <th className="min-w-[220px]">알림 종류</th>
                {admins.map((a) => <th key={a.id} className="whitespace-nowrap text-center">{a.name}</th>)}
                <th className="whitespace-nowrap text-right">받는 사람</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => {
                const cur = targets[t.key] ?? null;
                const hiddenAny = !!hiddenTopics[t.key];
                const everyone = cur === null || (cur.length === 0 && !hiddenAny);
                const tally = everyone ? "전원" : cur.length === 0 ? "지정(표시 안 됨)" : `${cur.length}명${hiddenAny ? " +" : ""}`;
                return (
                  <tr key={t.key}>
                    <td>
                      <p className="font-semibold text-[#0f172a]">{t.label}</p>
                      <p className="mt-0.5 text-[12.5px] text-[#596578]">{t.hint}</p>
                    </td>
                    {admins.map((a) => {
                      const on = cur === null ? true : cur.includes(a.id);
                      return (
                        <td key={a.id} className="text-center">
                          <input type="checkbox" className="h-4 w-4 cursor-pointer accent-[#4f46e5]" checked={on} disabled={tgtSaving}
                            aria-label={`${t.label} — ${a.name}`} title={`${t.label} — ${a.name}`}
                            onChange={(e) => toggleTarget(t, a.id, e.target.checked)} />
                        </td>
                      );
                    })}
                    <td className={`whitespace-nowrap text-right text-[13px] ${everyone ? "text-[#596578]" : "font-semibold text-[#4f46e5]"}`}>{tally}</td>
                  </tr>
                );
              })}
              {topics.length === 0 && (
                <tr><td colSpan={admins.length + 2} className="text-[#596578]">불러오는 중…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="px-6 py-3 text-[12.5px] text-[#596578]">
          아무도 고르지 않은 종류는 관리자 전원에게 갑니다. 「+」는 화면에 표시되지 않는 수신자가 더 있다는 뜻입니다.
          회사 연동 키 회수 알림은 최고 관리자에게만 가며 여기서 고르지 않습니다. 자료 제출 요청의 알림은 요청을 걸 때 고른 담당자가 받습니다.
        </p>
      </Box>
    </div>
  );
}
