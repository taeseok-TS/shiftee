"use client";

import { useEffect, useState } from "react";
import WorkReport from "@/components/attendance/WorkReport";
import { PageHead, Box } from "@/components/kit";

// 원장 근로시간 리포트 — 담당 지점만, 보기만. 본부가 「지점 출퇴근 기록 열람」을 끄면(권한 설정 #39) 안내만 보인다(API 도 403)
export default function Page() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/me/permissions").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setAllowed(d?.permissions?.["manager.viewAttendance"] !== false); }).catch(() => { if (alive) setAllowed(true); });
    return () => { alive = false; };
  }, []);
  if (allowed === null) return <p className="p-6 text-[14px] text-[#596578]">불러오는 중…</p>;
  // 꺼짐 안내 — 노랑 판 대신 같은 머리 + 박스 안 회색 한 줄(디자인 통일 10/21)
  if (!allowed) return (
    <div>
      <PageHead crumb="근태 › 근로시간 리포트" title="근로시간 리포트" />
      <Box><p className="px-6 py-5 text-[14px] text-[#596578]">본부가 원장의 지점 출퇴근 기록 열람을 꺼 두었습니다. 직원 출퇴근 기록은 본부에 문의해 주세요.</p></Box>
    </div>
  );
  return <WorkReport scope="manager" />;
}
