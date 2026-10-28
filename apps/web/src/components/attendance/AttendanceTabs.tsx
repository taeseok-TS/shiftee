"use client";
// 근태 › 출퇴근 현황 머리 + 알약 탭 한 줄(2026-10-21 본부 시안 R10) — 옛 「출퇴근 관리」 제목 · 밑줄 탭(오늘 출퇴근 · 기간별 통계)과
// 위 탭(출퇴근 · 출퇴근기록) 두 겹을 한 줄로: 오늘 · 달력·목록 · 기간별 통계 · 주말 근무 엑셀.
// 출퇴근 현황 화면(/admin/attendance)은 오늘 · 기간별 통계 · 주말 근무 엑셀을 화면 안에서 바꾸고(onSelect), 달력·목록은 다른 주소다.
import { PageHead, PillTabs, type PillTab } from "@/components/kit";

// calendar · list = 출퇴근기록(/admin/attendance-board) 달력 · 목록 — 위 탭에서 바로 나눈다(안쪽 「달력형 | 목록형」 알약 없앰, 2026-10-28 이예지 디자인 ②)
export type AttendanceTab = "today" | "calendar" | "list" | "stats" | "geo" | "weekend";

// geo = 「지점 밖 · 위치 실패」(2026-10-27 이예지 — 출근 · 퇴근 위치 판정 시도 기록, components/attendance/GeofenceAttemptsBox)
const LABEL: Record<AttendanceTab, string> = { today: "오늘", calendar: "달력", list: "목록", stats: "지난 기록", geo: "지점 밖 · 위치 실패", weekend: "주말 근무 엑셀" };
const BOARD_HREF: Partial<Record<AttendanceTab, string>> = { calendar: "/admin/attendance-board", list: "/admin/attendance-board?view=list" };
export const isAttendanceTab = (v: string | null): v is AttendanceTab => !!v && Object.hasOwn(LABEL, v) && !BOARD_HREF[v as AttendanceTab];   // in 은 constructor·toString 도 통과시킨다

export default function AttendanceTabs({ active, note, onSelect, children }: {
  active: AttendanceTab; note?: React.ReactNode; onSelect?: (t: AttendanceTab) => void; children?: React.ReactNode;
}) {
  const tabs: PillTab[] = (Object.keys(LABEL) as AttendanceTab[]).map((k) => ({
    key: k, label: LABEL[k],
    href: BOARD_HREF[k] ?? (onSelect ? undefined : `/admin/attendance${k === "today" ? "" : `?tab=${k}`}`),
  }));
  return (
    <>
      <PageHead crumb="근태 › 출퇴근 현황" title="출퇴근 현황" note={note}>{children}</PageHead>
      <PillTabs tabs={tabs} value={active} onChange={(k) => onSelect?.(k as AttendanceTab)} />
    </>
  );
}
