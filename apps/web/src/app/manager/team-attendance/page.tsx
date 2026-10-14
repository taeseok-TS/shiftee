"use client";

import { useEffect, useState } from "react";
import AttendanceBoard from "@/components/attendance/AttendanceBoard";

// 원장 팀 출퇴근기록 — 담당 지점만, 보기만. 본부가 「지점 출퇴근 기록 열람」을 끄면(권한 설정 #39) 안내만 보인다(API 도 403)
export default function Page() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/me/permissions").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setAllowed(d?.permissions?.["manager.viewAttendance"] !== false); }).catch(() => { if (alive) setAllowed(true); });
    return () => { alive = false; };
  }, []);
  if (allowed === null) return <p className="text-sm text-gray-400 p-6">불러오는 중…</p>;
  if (!allowed) return <div className="p-6 text-sm text-gray-600 border rounded-lg bg-amber-50 border-amber-200">본부가 원장의 지점 출퇴근 기록 열람을 꺼 두었습니다. 직원 출퇴근 기록은 본부에 문의해 주세요.</div>;
  return <AttendanceBoard scope="manager" />;
}
