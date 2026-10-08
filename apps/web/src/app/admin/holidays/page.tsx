"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CalendarDays, Plus, Trash2 } from "lucide-react";

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
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarDays className="text-red-500" /> 공휴일 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            공휴일은 휴가 일수 계산에서 제외되고, 공휴일 출근 시 지각·조퇴 판정을 하지 않습니다. 임시공휴일이 지정되면 여기서 추가하세요.
          </p>
        </div>
        <select className="rounded-md border px-3 py-2 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
      </div>

      {/* 추가 폼 */}
      <Card>
        <CardContent className="pt-4 pb-4 flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-xs text-gray-500">날짜</label>
            <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-40" />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs text-gray-500">이름</label>
            <Input placeholder="예: 임시공휴일" value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addHoliday(); }} />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 h-10 cursor-pointer select-none" title="이 날(평일)에 근무하면 대체휴일 1일 자동 부여">
            <input type="checkbox" checked={newGrants} onChange={(e) => setNewGrants(e.target.checked)} />대체휴무 부여
          </label>
          <Button onClick={addHoliday} className="gap-1"><Plus size={14} />추가</Button>
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
              <div key={h.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span className="font-mono text-gray-600 w-28 shrink-0">{h.date}</span>
                <span className={`w-8 shrink-0 ${dow === "일" ? "text-red-500" : dow === "토" ? "text-blue-500" : "text-gray-400"}`}>({dow})</span>
                <span className="flex-1 font-medium">{h.name}</span>
                {/* 대체휴무 부여 지정(#56) — 켜 두면 이 날(평일) 근무 기록에 대체휴일 1일이 자동 부여된다. 주말은 부여 대상이 아니고 5/1 은 보상휴가로 계산 */}
                {dow === "토" || dow === "일" ? (
                  <span className="text-[11px] text-gray-300" title="주말 공휴일은 대체휴무 부여 대상이 아닙니다">주말</span>
                ) : h.date.endsWith("-05-01") ? (
                  <span className="text-[11px] text-gray-400" title="5/1 근로자의 날 근무는 지정 없이 보상휴가로 계산됩니다">보상휴가 자동</span>
                ) : (
                  <label className={`flex items-center gap-1 text-xs cursor-pointer select-none ${h.grantsLeave ? "text-emerald-700" : "text-gray-400"}`} title="이 날(평일)에 근무하면 대체휴일 1일 자동 부여">
                    <input type="checkbox" checked={!!h.grantsLeave} onChange={() => toggleGrants(h)} />대체휴무 부여
                  </label>
                )}
                <button onClick={() => removeHoliday(h)} className="text-gray-400 hover:text-red-500" title="삭제">
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-gray-400">2026~2027년 법정공휴일(대체공휴일 포함)은 기본 등록되어 있습니다. 이미 승인된 과거 휴가의 차감 일수는 소급 변경되지 않습니다.<br />
        「대체휴무 부여」를 켠 공휴일(평일)에 출퇴근 기록이 있으면 대체휴일 1일이 자동 부여됩니다(휴가 관리 → 종류별 잔여). 5/1 근로자의 날 근무는 지정 없이 보상휴가로 계산됩니다.</p>
    </div>
  );
}
