"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CalendarDays, Plus, Trash2 } from "lucide-react";

type Holiday = { id: string; date: string; name: string };

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export default function AdminHolidaysPage() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");

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
      body: JSON.stringify({ date: newDate, name: newName }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "등록 실패"); return; }
    toast.success("공휴일이 등록되었습니다.");
    setNewDate(""); setNewName("");
    fetchHolidays(year);
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
                <button onClick={() => removeHoliday(h)} className="text-gray-400 hover:text-red-500" title="삭제">
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-gray-400">2026~2027년 법정공휴일(대체공휴일 포함)은 기본 등록되어 있습니다. 이미 승인된 과거 휴가의 차감 일수는 소급 변경되지 않습니다.</p>
    </div>
  );
}
