"use client";

// 설정 › 근태 규칙(2026-10-20 본부 박정인 시안 v2 7번 · 디렉터 「추천대로」) — 「퇴근 기록이 없는 날 처리」를 하나만 고른다.
// 대시보드 누락 보정·출퇴근 관리 전일 미마감·직원 앱 「어제 퇴근 기록이 없어요」가 모두 이 규칙을 쓴다(lib/attendance-policy autoCloseTime).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Rule = "FIXED_2200" | "SCHEDULE" | "IN_10_5" | "IN_FALLBACK";
type Change = { id: string; actorName: string; detail: string | null; createdAt: string };

const OPTIONS: { v: Rule; title: string; tag?: string; desc: (fb: string) => string }[] = [
  { v: "FIXED_2200", title: "22:00 퇴근 동의", tag: "본부 안",
    desc: () => "다음 출근 때 「어제 퇴근 기록이 없어요. 22:00 퇴근으로 처리하는 데 동의합니다」 체크 → 22:00 퇴근. 동의 시각·사람이 기록되고, 22시가 아니면 보정 요청" },
  { v: "SCHEDULE", title: "근무일정 퇴근 시각",
    desc: (fb) => `그날 근무일정의 퇴근 시각으로(13:00~22:00 일정이면 22:00). 일정이 없는 날은 출근 + ${fb}` },
  { v: "IN_10_5", title: "출근 + 10.5시간",
    desc: () => "13:20 출근 → 23:50 퇴근으로 기록됨(실제 일하지 않은 시간이 들어갈 수 있음)" },
  { v: "IN_FALLBACK", title: "보정 시간 기준",
    desc: (fb) => `출근 시각 + ${fb}으로 자동 보정(보정 시간은 환경설정)` },
];
const LABEL: Record<Rule, string> = { FIXED_2200: "22:00 퇴근 동의", SCHEDULE: "근무일정 퇴근 시각", IN_10_5: "출근 + 10.5시간", IN_FALLBACK: "보정 시간 기준" };
const SCREENS = [
  "관리자 대시보드 · 출퇴근 누락 보정",
  "출퇴근 관리 · 전일 미마감 마감",
  "직원 앱 · 「어제 퇴근 기록이 없어요」 본인 동의",
  "근로시간 리포트 · 급여 자료 엑셀(위에서 마감된 기록을 셈)",
];

const fmtHours = (h: number) => (Number.isInteger(h) ? `${h}시간` : `${Math.floor(h)}시간 30분`);
const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function AttendanceRulesPage() {
  const [saved, setSaved] = useState<Rule | null>(null);
  const [pick, setPick] = useState<Rule | null>(null);
  const [fallbackHours, setFallbackHours] = useState(9);
  const [changes, setChanges] = useState<Change[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/admin/attendance-rules", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) { setFailed(true); return; }
        setSaved(d.rule); setPick(d.rule); setFallbackHours(d.fallbackHours); setChanges(d.changes || []);
      })
      .catch(() => setFailed(true));
  }, []);

  async function save() {
    if (!pick || pick === saved) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/attendance-rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rule: pick }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "저장하지 못했습니다."); return; }
      setSaved(d.rule); setChanges(d.changes || []);
      toast.success("근태 규칙을 저장했습니다. 모든 화면에 바로 적용됩니다.");
    } finally { setBusy(false); }
  }

  const fb = fmtHours(fallbackHours);
  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs text-gray-400 mb-1">설정 › 근태 규칙</p>
          <h1 className="text-2xl font-bold">근태 규칙</h1>
        </div>
        <Button onClick={save} disabled={busy || !pick || pick === saved} className="bg-indigo-600 hover:bg-indigo-700">{busy ? "저장 중..." : "저장"}</Button>
      </div>
      {failed ? (
        <p className="text-sm text-red-500">근태 규칙을 불러오지 못했습니다. 새로고침해 주세요.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
          <div className="space-y-6">
            <section className="bg-white rounded-xl border p-5">
              <h2 className="font-semibold mb-1">퇴근 기록이 없는 날 처리 <span className="text-xs font-normal text-gray-400">· 모든 화면에 같은 규칙이 적용돼요</span></h2>
              <p className="text-xs text-gray-400 mb-4">어느 규칙이든 근무 상한(평일 10.5시간, 주말·공휴일 승인 근무 + 45분)이나 퇴근 가능 시각을 넘으면: 직원 본인 동의는 막히고 「퇴근 처리 요청」(결재)으로 받으며, 관리자 보정·전일 미마감은 상한 시각까지만 기록합니다(조퇴로 보지 않음).</p>
              <div className="space-y-3" role="radiogroup">
                {OPTIONS.map((o) => {
                  const on = pick === o.v;
                  return (
                    <button key={o.v} type="button" role="radio" aria-checked={on} onClick={() => setPick(o.v)}
                      className={`w-full text-left rounded-xl border p-4 transition ${on ? "border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50/30" : "hover:bg-gray-50"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold flex items-center gap-2">
                          {o.title}{o.tag && <span className="text-[11px] font-normal text-gray-500">({o.tag})</span>}
                          {saved === o.v && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">적용 중</span>}
                        </div>
                        <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${on ? "border-indigo-600 bg-indigo-600" : "border-gray-300"}`} />
                      </div>
                      <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{o.desc(fb)}</p>
                    </button>
                  );
                })}
              </div>
            </section>
            <section className="bg-white rounded-xl border p-5">
              <h2 className="font-semibold mb-3">이 규칙을 쓰는 화면</h2>
              <table className="w-full text-sm">
                <tbody>
                  {SCREENS.map((s) => (
                    <tr key={s} className="border-t first:border-t-0">
                      <td className="py-2.5 text-gray-700">{s}</td>
                      <td className="py-2.5 text-right"><span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{saved ? LABEL[saved] : "-"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
          <aside className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-1">변경 로그</h2>
            <p className="text-xs text-gray-400 mb-3">관리자가 언제 무엇을 바꿨는지 남은 기록(지우거나 고칠 수 없음). 전체는 설정 › 변경 로그.</p>
            {changes.length === 0 ? (
              <p className="text-sm text-gray-400">아직 바꾼 기록이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {changes.map((c) => (
                  <li key={c.id} className="text-sm border-t pt-3 first:border-t-0 first:pt-0">
                    <div className="text-[11px] text-gray-400">{fmtTime(c.createdAt)} · {c.actorName}</div>
                    <div className="text-gray-700">{c.detail}</div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
