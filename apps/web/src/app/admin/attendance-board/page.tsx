"use client";

import AttendanceBoard from "@/components/attendance/AttendanceBoard";

// 전 직원 출퇴근기록 — 달력형·목록형(2026-10-07 QA #27 #28)
export default function AttendanceBoardPage() {
  return <AttendanceBoard scope="admin" />;
}
