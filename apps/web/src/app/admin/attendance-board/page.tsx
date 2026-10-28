import AttendanceBoard from "@/components/attendance/AttendanceBoard";
import AttendanceTabs from "@/components/attendance/AttendanceTabs";

// 전 직원 출퇴근기록 — 달력형·목록형(2026-10-07 QA #27 #28). 출퇴근 현황 알약 탭 「달력」 · 「목록」(?view=list) — 안쪽 알약 없이 위 탭에서 바로(2026-10-28 이예지 디자인 ②)
// ?branch=지점&focus=직원 — 출퇴근 현황 「확인 필요」 줄에서 누르면 그 사람 지점으로 걸러서 그 줄을 잠깐 강조(이예지 디자인 ⑧)
export default async function AttendanceBoardPage({ searchParams }: { searchParams: Promise<{ view?: string; branch?: string; focus?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : "calendar";
  const branch = typeof sp.branch === "string" && sp.branch.trim() ? sp.branch.trim().slice(0, 60) : undefined;
  const focus = typeof sp.focus === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(sp.focus) ? sp.focus : undefined;
  return (
    <div>
      <AttendanceTabs active={view} />
      {/* key — 탭을 바꾸면(같은 주소, 쿼리만 다름) 새 보기로 다시 그린다 */}
      <AttendanceBoard key={`${view}|${branch ?? ""}|${focus ?? ""}`} scope="admin" embedded initialView={view} initialBranch={branch} focusUser={focus} />
    </div>
  );
}
