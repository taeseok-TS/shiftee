"use client";

import WorkReport from "@/components/attendance/WorkReport";

// 근로시간 리포트 — 원장 담당 지점만(2026-10-08 QA76 #41)
export default function ManagerWorkReportPage() {
  return <WorkReport scope="manager" />;
}
