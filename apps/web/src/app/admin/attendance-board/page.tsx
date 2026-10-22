"use client";

import AttendanceBoard from "@/components/attendance/AttendanceBoard";
import AttendanceTabs from "@/components/attendance/AttendanceTabs";

// 전 직원 출퇴근기록 — 달력형·목록형(2026-10-07 QA #27 #28). 출퇴근 현황 알약 탭 「달력 · 목록」(R10)
export default function AttendanceBoardPage() {
  return (
    <div>
      <AttendanceTabs active="board" />
      <AttendanceBoard scope="admin" embedded />
    </div>
  );
}
