"use client";
// 휴가 › 휴가 관리 알약 탭 한 줄(2026-10-21 본부 시안 R13) — 옛 안쪽 탭(신청 관리 · 내 결재함 · 결재라인 설정 · …)과
// 위 탭(휴가 관리 · 휴가 유형) 두 겹을 한 줄로. 「내 결재함」은 결재 › 결재함, 「결재라인 설정」은 결재 › 결재 규칙으로 옮겼다.
// 휴가 관리 화면은 탭을 화면 안에서 바꾸고(onSelect), 휴가 유형 화면은 링크로 돌아온다(/admin/leave?tab=).
import { PillTabs, type PillTab } from "@/components/kit";

export type LeaveTab = "list" | "balance" | "grants" | "report" | "settlement" | "import" | "types";

const ALL: { key: LeaveTab; label: string; adminOnly?: boolean }[] = [
  { key: "list", label: "신청 목록" },
  { key: "balance", label: "직원별 잔여" },
  { key: "grants", label: "종류별 잔여", adminOnly: true },
  { key: "report", label: "휴가 리포트" },
  { key: "settlement", label: "연차 정산", adminOnly: true },
  { key: "import", label: "휴가 가져오기", adminOnly: true },
  { key: "types", label: "휴가 유형", adminOnly: true },
];
export const isLeaveTab = (v: string | null): v is LeaveTab => !!v && ALL.some((t) => t.key === v && t.key !== "types");

// superAdmin = 본부(ADMIN) — 종류별 잔여·연차 정산·휴가 가져오기·휴가 유형은 본부만(원장도 isAdmin 이 참이라 role 로 가른다)
export default function LeaveTabs({ active, superAdmin, onSelect }: { active: LeaveTab; superAdmin: boolean; onSelect?: (t: LeaveTab) => void }) {
  const tabs: PillTab[] = ALL.filter((t) => superAdmin || !t.adminOnly).map((t) => ({
    key: t.key, label: t.label,
    href: t.key === "types" ? "/admin/leave-types" : onSelect ? undefined : `/admin/leave?tab=${t.key}`,
  }));
  return <PillTabs tabs={tabs} value={active} onChange={(k) => onSelect?.(k as LeaveTab)} />;
}
