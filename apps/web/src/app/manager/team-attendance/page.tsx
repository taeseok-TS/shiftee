"use client";

import AttendanceBoard from "@/components/attendance/AttendanceBoard";

// 원장 팀 출퇴근기록 — 담당 지점만, 보기만(2026-10-07 QA #17)
export default function TeamAttendancePage() {
  return <AttendanceBoard scope="manager" />;
}
