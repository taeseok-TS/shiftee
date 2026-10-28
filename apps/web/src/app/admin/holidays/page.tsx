"use client";

import { PageHead } from "@/components/kit";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

type Holiday = { id: string; date: string; name: string; grantsLeave?: boolean };   // grantsLeave: 대체휴무 부여 지정(#56)

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export default function AdminHolidaysPage() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [newGrants, setNewGrants] = useState(false);   // 대체휴무 부여 지정(#56)

  const fetchHolidays = useCallback(async (y: number) => {
    setLoading(true);
    const res = await fetch(`/api/holidays?year=${y}`);
    if (res.ok) setHolidays((await res.json()).holidays || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchHolidays(year); }, [year, fetchHolidays]);

  async function addHoliday() {
    if (!newDate || !newName.trim()) { toast.error("날짜와 이름을 입력해주세요."); return; }
    const res = await fetch("/api/holidays", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: newDate, name: newName, grantsLeave: newGrants }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "등록 실패"); return; }
    toast.success("공휴일이 등록되었습니다.");
    setNewDate(""); setNewName(""); setNewGrants(false);
    fetchHolidays(year);
  }

  // 대체휴무 부여 지정 켜고 끄기(#56) — 지정된 공휴일(평일)에 근무 기록이 있으면 대체휴일 1일이 자동 부여된다
  async function toggleGrants(h: Holiday) {
    const post = (extra: Record<string, unknown> = {}) => fetch("/api/holidays", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: h.date, name: h.name, grantsLeave: !h.grantsLeave, ...extra }),
    });
    let res = await post();
    let d = await res.json().catch(() => ({}));
    // 끌 때는 부여 N명·사용 M명을 보여 주고 확인받는다. 사용자가 있으면 서버가 409 로 막는다
    if (res.ok && d.needConfirm) {
      if (!window.confirm(`${h.date} ${h.name}의 「대체휴무 부여」를 끕니다.\n부여 ${d.granted}명 · 이미 사용 0명${d.granted ? `\n(${(d.names || []).join(", ")})` : ""}\n끄면 이 날 부여분 ${d.granted}건을 회수하고 이력을 남깁니다. 계속할까요?`)) return;
      res = await post({ confirm: true }); d = await res.json().catch(() => ({}));
    }
    if (res.ok) { if (d.revoked) toast.success(`지정을 끄고 부여분 ${d.revoked}건을 회수했습니다.`); fetchHolidays(year); }
    else toast.error(d.error || "변경 실패", { duration: 10000 });
  }

  async function removeHoliday(h: Holiday) {
    if (!window.confirm(`${h.date} ${h.name}을(를) 삭제할까요?\n삭제하면 이 날짜는 근무일로 계산됩니다.`)) return;
    const res = await fetch(`/api/holidays?id=${h.id}`, { method: "DELETE" });
    if (res.ok) { toast.success("삭제되었습니다."); fetchHolidays(year); }
    else toast.error((await res.json()).error || "삭제 실패");
  }

  return (
    <div className="max-w-3xl space-y-4">
      {/* 머리(R15 — 설정 화면 모두 같은 머리) */}
      <div>
        <PageHead crumb="설정 › 공휴일" title="공휴일">
          <select className="rounded-[10px] border border-[#e2e8f0] bg-white px-3 py-2 text-[13.5px]" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="연도">
            {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
        </PageHead>
        <p className="-mt-2 text-[13px] text-[#596578]">
          공휴일은 휴가 일수 계산에서 제외되고, 공휴일 출근 시 지각·조퇴 판정을 하지 않습니다. 임시공휴일이 지정되면 여기서 추가하세요.
        </p>
      </div>

      {/* 추가 폼 */}
      <Card>
        <CardContent className="pt-4 pb-4 flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-xs text-gray-500">날짜</label>
            <Input type="date" max="9999-12-31" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-40" />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs text-gray-500">이름</label>
            <Input placeholder="예: 임시공휴일" value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addHoliday(); }} />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 h-10 cursor-pointer select-none" title="이 날(평일)에 근무하면 대체휴일 1일 자동 부여">
            <input type="checkbox" checked={newGrants} onChange={(e) => setNewGrants(e.target.checked)} />대체휴무도 부여
          </label>
          <Button onClick={addHoliday} className="gap-1 bg-[#4f46e5] text-white hover:bg-[#4338ca]"><Plus size={14} />추가</Button>
        </CardContent>
      </Card>

      {/* 목록 */}
      {loading ? (
        <p className="text-gray-400 py-8 text-center">불러오는 중…</p>
      ) : holidays.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-gray-400">{year}년 등록된 공휴일이 없습니다.</CardContent></Card>
      ) : (
        <div className="border rounded-lg bg-white divide-y">
          {holidays.map((h) => {
            const d = new Date(h.date + "T00:00:00");
            const dow = WEEKDAYS[d.getDay()];
            return (
              <div key={h.id} className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {/* 날짜는 「10월 3일 (금)」, 토 · 일은 회색 글자(2026-10-23 ■4) */}
                <span className="w-28 shrink-0 tabular-nums text-gray-700">{d.getMonth() + 1}월 {d.getDate()}일 <span className="text-gray-400">({dow})</span></span>
                <span className="flex-1 min-w-[8rem] font-medium">{h.name}</span>
                {/* 대체휴무(#56) — 켜 두면 이 날(평일) 근무 기록에 대체휴일 1일이 자동 부여된다. 주말은 대상이 아니고 5/1 은 보상휴가로 계산.
                    표시와 버튼을 나눈다(2026-10-23 본부 요청 ■3): 이미 부여 = 「대체휴무 있음」 알약 + 「끄기」, 아니면 「대체휴무 부여」 버튼 */}
                {dow === "토" || dow === "일" ? (
                  <span className="text-[12.5px] text-gray-400" title="주말 공휴일은 대체휴무 대상이 아닙니다">주말 — 대상 아님</span>
                ) : h.date.endsWith("-05-01") ? (
                  <span className="text-[12.5px] text-gray-500" title="5/1 근로자의 날 근무는 지정 없이 보상휴가로 계산됩니다">보상휴가 자동</span>
                ) : h.grantsLeave ? (
                  <span className="flex items-center gap-1">
                    <span className="rounded-full bg-[#eef2ff] px-2.5 py-0.5 text-[12.5px] font-bold text-[#4f46e5]">대체휴무 있음</span>
                    <button type="button" onClick={() => toggleGrants(h)} className="min-h-11 px-2 text-[12.5px] font-semibold text-gray-500 hover:underline" title="이 날 대체휴무를 끕니다(부여분 회수)">끄기</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => toggleGrants(h)} title="이 날(평일)에 근무하면 대체휴일 1일 자동 부여"
                    className="inline-flex min-h-11 sm:min-h-9 items-center rounded-[10px] border border-[#c7d2fe] bg-white px-3 text-[12.5px] font-semibold text-[#4f46e5] hover:bg-[#eef2ff]">대체휴무 부여</button>
                )}
                <button onClick={() => removeHoliday(h)} className="inline-flex h-11 w-11 items-center justify-center text-gray-400 hover:text-red-500" title="삭제" aria-label={`${h.name} 삭제`}>
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-gray-400">2026~2027년 법정공휴일(대체공휴일 포함)은 기본 등록되어 있습니다. 이미 승인된 과거 휴가의 차감 일수는 소급 변경되지 않습니다.<br />
        「대체휴무 있음」인 공휴일(평일)에 출퇴근 기록이 있으면 대체휴일 1일이 자동 부여됩니다(휴가 관리 → 종류별 잔여). 5/1 근로자의 날 근무는 지정 없이 보상휴가로 계산됩니다.</p>
    </div>
  );
}
