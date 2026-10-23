"use client";
// 근태 › 출퇴근 현황 머리 + 알약 탭 한 줄(2026-10-21 본부 시안 R10) — 옛 「출퇴근 관리」 제목 · 밑줄 탭(오늘 출퇴근 · 기간별 통계)과
// 위 탭(출퇴근 · 출퇴근기록) 두 겹을 한 줄로: 오늘 · 달력·목록 · 기간별 통계 · 주말 근무 엑셀.
// 출퇴근 현황 화면(/admin/attendance)은 오늘 · 기간별 통계 · 주말 근무 엑셀을 화면 안에서 바꾸고(onSelect), 달력·목록은 다른 주소다.
import { PageHead, PillTabs, type PillTab } from "@/components/kit";

export type AttendanceTab = "today" | "board" | "stats" | "weekend";

const LABEL: Record<AttendanceTab, string> = { today: "오늘", board: "달력 · 목록", stats: "지난 기록", weekend: "주말 근무 엑셀" };
export const isAttendanceTab = (v: string | null): v is AttendanceTab => !!v && Object.hasOwn(LABEL, v) && v !== "board";   // in 은 constructor·toString 도 통과시킨다

export default function AttendanceTabs({ active, note, onSelect, children }: {
  active: AttendanceTab; note?: React.ReactNode; onSelect?: (t: AttendanceTab) => void; children?: React.ReactNode;
}) {
  const tabs: PillTab[] = (Object.keys(LABEL) as AttendanceTab[]).map((k) => ({
    key: k, label: LABEL[k],
    href: k === "board" ? "/admin/attendance-board" : onSelect ? undefined : `/admin/attendance${k === "today" ? "" : `?tab=${k}`}`,
  }));
  return (
    <>
      <PageHead crumb="근태 › 출퇴근 현황" title="출퇴근 현황" note={note}>{children}</PageHead>
      <PillTabs tabs={tabs} value={active} onChange={(k) => onSelect?.(k as AttendanceTab)} />
    </>
  );
}
