"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, LogIn, LogOut } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

type AttendanceRecord = {
  id: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  status: string;
  user?: { name: string };
};

const statusLabel: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
  NORMAL: { label: "정상", variant: "default" },
  LATE: { label: "지각", variant: "destructive" },
  EARLY_LEAVE: { label: "조기퇴근", variant: "secondary" },
  ABSENT: { label: "결근", variant: "destructive" },
  HOLIDAY: { label: "휴일", variant: "outline" },
};

export default function AttendancePage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(new Date());

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const fetchRecords = useCallback(async () => {
    const res = await fetch(`/api/attendance?year=${currentYear}&month=${currentMonth}`);
    const data = await res.json();
    setRecords(data.records || []);

    const todayStr = format(new Date(), "yyyy-MM-dd");
    const today = data.records?.find((r: AttendanceRecord) =>
      r.date.startsWith(todayStr)
    );
    setTodayRecord(today || null);
  }, [currentYear, currentMonth]);

  useEffect(() => {
    fetchRecords();
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [fetchRecords]);

  async function handleClockIn() {
    setLoading(true);
    try {
      const res = await fetch("/api/attendance/clock-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      toast.success("출근이 등록되었습니다.");
      fetchRecords();
    } finally { setLoading(false); }
  }

  async function handleClockOut() {
    setLoading(true);
    try {
      const res = await fetch("/api/attendance/clock-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      toast.success("퇴근이 등록되었습니다.");
      fetchRecords();
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">출퇴근 관리</h1>

      {/* 출퇴근 버튼 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock size={18} />
            오늘의 출퇴근
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-center gap-6">
            {/* 현재 시각 */}
            <div className="text-center">
              <p className="text-4xl font-mono font-bold text-gray-900">
                {format(now, "HH:mm:ss")}
              </p>
              <p className="text-gray-500 mt-1 text-sm">
                {format(now, "yyyy년 MM월 dd일 (EEEE)", { locale: ko })}
              </p>
            </div>

            {/* 출퇴근 현황 */}
            <div className="flex-1 grid grid-cols-2 gap-4">
              <div className="bg-green-50 rounded-xl p-4 text-center">
                <p className="text-sm text-green-700 font-medium">출근 시각</p>
                <p className="text-2xl font-bold text-green-800 mt-1">
                  {todayRecord?.clockIn ? format(new Date(todayRecord.clockIn), "HH:mm") : "--:--"}
                </p>
              </div>
              <div className="bg-blue-50 rounded-xl p-4 text-center">
                <p className="text-sm text-blue-700 font-medium">퇴근 시각</p>
                <p className="text-2xl font-bold text-blue-800 mt-1">
                  {todayRecord?.clockOut ? format(new Date(todayRecord.clockOut), "HH:mm") : "--:--"}
                </p>
              </div>
            </div>

            {/* 버튼 */}
            <div className="flex gap-3">
              <Button
                onClick={handleClockIn}
                disabled={loading || !!todayRecord?.clockIn}
                className="bg-green-600 hover:bg-green-700 gap-2"
                size="lg"
              >
                <LogIn size={18} />
                출근
              </Button>
              <Button
                onClick={handleClockOut}
                disabled={loading || !todayRecord?.clockIn || !!todayRecord?.clockOut}
                variant="outline"
                className="border-blue-500 text-blue-600 hover:bg-blue-50 gap-2"
                size="lg"
              >
                <LogOut size={18} />
                퇴근
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 이번 달 기록 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {currentYear}년 {currentMonth}월 출퇴근 기록
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-3 font-medium">날짜</th>
                  <th className="pb-3 font-medium">출근</th>
                  <th className="pb-3 font-medium">퇴근</th>
                  <th className="pb-3 font-medium">근무시간</th>
                  <th className="pb-3 font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-400">기록이 없습니다.</td></tr>
                ) : records.map((r) => {
                  const workMinutes = r.clockIn && r.clockOut
                    ? Math.round((new Date(r.clockOut).getTime() - new Date(r.clockIn).getTime()) / 60000)
                    : null;
                  const s = statusLabel[r.status] || { label: r.status, variant: "outline" as const };
                  return (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-3">{format(new Date(r.date), "MM월 dd일 (EEE)", { locale: ko })}</td>
                      <td className="py-3">{r.clockIn ? format(new Date(r.clockIn), "HH:mm") : "-"}</td>
                      <td className="py-3">{r.clockOut ? format(new Date(r.clockOut), "HH:mm") : "-"}</td>
                      <td className="py-3">
                        {workMinutes !== null ? `${Math.floor(workMinutes / 60)}시간 ${workMinutes % 60}분` : "-"}
                      </td>
                      <td className="py-3">
                        <Badge variant={s.variant}>{s.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
