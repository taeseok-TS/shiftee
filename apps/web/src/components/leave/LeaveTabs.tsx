"use client";
// 휴가 › 휴가 관리 알약 탭 한 줄(2026-10-21 본부 시안 R13) — 옛 안쪽 탭(신청 관리 · 내 결재함 · 결재라인 설정 · …)과
// 위 탭(휴가 관리 · 휴가 유형) 두 겹을 한 줄로. 「내 결재함」은 결재 › 결재함, 「결재라인 설정」은 결재 › 결재 규칙으로 옮겼다.
// 휴가 관리 화면은 탭을 화면 안에서 바꾸고(onSelect), 휴가 유형 화면은 링크로 돌아온다(/admin/leave?tab=).
import { useEffect, useState } from "react";
import { PillTabs, type PillTab } from "@/components/kit";

export type LeaveTab = "list" | "balance" | "grants" | "report" | "settlement" | "import" | "types";

// mainOnly = 메인(최고) 관리자만(User.isSuperAdmin — 설정 › 관리자 「메인」). 「휴가 가져오기」는 시프티 이관용이라
// 이관이 끝날 때까지 메인 관리자에게만 보이고, 끝나면 이 줄을 지워 숨긴다(2026-10-23 오픈 전 요청 ■3 · 시안 S4 ④)
const ALL: { key: LeaveTab; label: string; adminOnly?: boolean; mainOnly?: boolean }[] = [
  { key: "list", label: "신청 목록" },
  { key: "balance", label: "직원별 잔여" },
  { key: "grants", label: "종류별 잔여", adminOnly: true },
  { key: "report", label: "휴가 리포트" },
  { key: "settlement", label: "연차 정산", adminOnly: true },
  { key: "import", label: "휴가 가져오기", adminOnly: true, mainOnly: true },
  { key: "types", label: "휴가 유형", adminOnly: true },
];
export const isLeaveTab = (v: string | null): v is LeaveTab => !!v && ALL.some((t) => t.key === v && t.key !== "types");

// superAdmin = 본부(ADMIN) — 종류별 잔여·연차 정산·휴가 가져오기·휴가 유형은 본부만(원장도 isAdmin 이 참이라 role 로 가른다)
// mainAdmin = 메인 관리자 여부. 부르는 쪽이 주지 않으면(휴가 유형 화면) 여기서 /api/auth/me 로 확인한다
export default function LeaveTabs({ active, superAdmin, mainAdmin, onSelect }: { active: LeaveTab; superAdmin: boolean; mainAdmin?: boolean; onSelect?: (t: LeaveTab) => void }) {
  const [fetchedMain, setFetchedMain] = useState(false);
  useEffect(() => {
    if (mainAdmin !== undefined || !superAdmin) return;
    let alive = true;
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setFetchedMain(!!d?.user?.isSuperAdmin); }).catch(() => {});
    return () => { alive = false; };
  }, [mainAdmin, superAdmin]);
  const isMain = mainAdmin ?? fetchedMain;
  const tabs: PillTab[] = ALL.filter((t) => (superAdmin || !t.adminOnly) && (isMain || !t.mainOnly)).map((t) => ({
    key: t.key, label: t.label,
    href: t.key === "types" ? "/admin/leave-types" : onSelect ? undefined : `/admin/leave?tab=${t.key}`,
  }));
  return <PillTabs tabs={tabs} value={active} onChange={(k) => onSelect?.(k as LeaveTab)} />;
}
