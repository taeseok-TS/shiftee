"use client";

import { useEffect, useState } from "react";

// 직원 수정 창 안내 — 포털 인원명부 자동 반영이 켜져 있으면 이 칸들은 매일 포털 값으로 맞춰진다.
// 여기서 고쳐도 다음 날 되돌아가므로 미리 알린다(관리자만 보임 — 원장은 현황 API 가 403 이라 조용히 숨는다).
export default function PortalSyncNote() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    fetch("/api/admin/portal-sync?brief=1").then((r) => (r.ok ? r.json() : null)).then((d) => setOn(!!(d?.configured && d?.autoApply))).catch(() => {});
  }, []);
  if (!on) return null;
  return (
    <p className="col-span-full text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
      이름·지점·직책·직급·입사일은 매일 포털 인원명부 기준으로 맞춰집니다. 바꿀 일이 있으면 포털 인원명부에서 고쳐주세요.
    </p>
  );
}
