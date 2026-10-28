"use client";

import { jobGroupLabel } from "@/lib/job-group-label";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock } from "lucide-react";
import { Box, Btn, StatusPill } from "@/components/kit";
import { dayState, hasIn, kstNow, type BoardCell, type DayState } from "@/components/attendance/board-state";

/**
 * 원장 「지점 출퇴근기록」 폰 첫 화면(2026-10-23 본부 요청 ■2 → 시안 S2-3) — 한 달(31칸) 표 대신 **오늘 · 이번 주** 목록.
 *  · 오늘: 문제 있는 사람부터(미출근 · 누락 → 지각 → 승인 대기 → 휴가), 정상(출근 · 퇴근 · 출근 전)은 접어 둔다
 *  · 이번 주(월~일): 문제 있었던 날만 사람별 한 줄 — 「10/23 (금) 퇴근 누락」
 *  · 시각은 보이지 않는다(■0-11). 일정 시간(「13:00–22:00」)은 근무일정이라 보인다
 * 데이터: GET /api/attendance/board(이번 주 월~일). 한 달 표는 부르는 쪽이 「한 달 표 보기」로 연다(PC 권장)
 */

type User = { id: string; name: string; position: string | null; jobGroup: string | null; branch: string | null };
type WeekBoard = { days: string[]; users: User[]; cells: Record<string, Record<string, BoardCell>> };

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const short = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8))} (${WEEK[dow(ymd)]})`;
const plus = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (ymd: string) => plus(ymd, -((dow(ymd) + 6) % 7));

export default function BoardPhoneToday({ branches, onShowMonth }: { branches: string[]; onShowMonth: () => void }) {
  const [{ today, nowMin }] = useState(kstNow);
  const [board, setBoard] = useState<WeekBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const mon = mondayOf(today), sun = plus(mon, 6);
  const query = `from=${mon}&to=${sun}&emp=active${branches.length ? `&branches=${encodeURIComponent(branches.join(","))}` : ""}`;

  useEffect(() => {
    let alive = true;
    fetch(`/api/attendance/board?${query}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { setError(d.error || "불러오지 못했습니다"); return; }
        setError(null);
        setBoard(d as WeekBoard);
      })
      .catch(() => { if (alive) setError("불러오지 못했습니다"); });
    return () => { alive = false; };
  }, [query]);

  // 오늘 — 근무일정 · 기록 · 휴가가 있는 사람만, 문제 있는 사람부터
  const todayRows = useMemo(() => {
    if (!board) return [];
    const out: { u: User; s: DayState; sched?: string; onLeave: boolean }[] = [];
    for (const u of board.users) {
      const c = board.cells[u.id]?.[today];
      const s = dayState(c, today, today, nowMin);
      // 휴가(출근 기록 없이 휴가만)인 사람은 「근무 N명」에 세지 않는다 — 따로 「휴가 N명」
      if (s) out.push({ u, s, sched: c?.sched, onLeave: !!c?.leave && !hasIn(c) && !c.pending });
    }
    return out.sort((a, b) => a.s.rank - b.s.rank || a.u.name.localeCompare(b.u.name, "ko"));
  }, [board, today, nowMin]);
  const leaveCount = todayRows.filter((r) => r.onLeave).length;
  const workCount = todayRows.length - leaveCount;
  const problems = todayRows.filter((r) => r.s.rank <= 3);
  const normals = todayRows.filter((r) => r.s.rank > 3);

  // 이번 주 — 오늘까지 문제 있었던 날
  const weekRows = useMemo(() => {
    if (!board) return [];
    return board.users.map((u) => ({
      u,
      days: board.days.filter((d) => d <= today)
        .map((d) => ({ d, s: dayState(board.cells[u.id]?.[d], d, today, nowMin) }))
        .filter((x): x is { d: string; s: DayState } => !!x.s && x.s.problem),
    })).filter((r) => r.days.length > 0);
  }, [board, today, nowMin]);

  const who = (u: User) => [jobGroupLabel(u.jobGroup || u.position), branches.length !== 1 && u.branch].filter(Boolean).join(" · ");

  return (
    <div className="sm:hidden">
      <Box icon={<Clock />} title="오늘" sub={`${short(today)}${board ? ` · 근무 ${workCount}명${leaveCount ? ` · 휴가 ${leaveCount}명` : ""}` : ""}`}>
        {error ? <p className="px-6 py-5 text-[14px] text-[#596578]">{error}</p>
          : !board ? <p className="px-6 py-5 text-[14px] text-[#596578]">불러오는 중…</p>
          : todayRows.length === 0 ? <p className="px-6 py-5 text-[14px] text-[#596578]">오늘 근무일정이 있는 직원이 없습니다.</p>
          : (
            <ul className="px-4 py-1">
              {[...problems, ...(showAll ? normals : [])].map(({ u, s, sched }) => (
                <li key={u.id} className="flex min-h-[52px] items-center gap-3 border-t border-[#f1f5f9] py-2.5 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[15px] font-bold text-[#0f172a]">{u.name}</b>
                    <span className="block truncate text-[13.5px] text-[#475569]">{[sched && `${sched.replace("-", "–")} 근무`, who(u)].filter(Boolean).join(" · ")}</span>
                  </div>
                  <StatusPill tone={s.tone}>{s.label}</StatusPill>
                </li>
              ))}
              {normals.length > 0 && (
                <li className="border-t border-[#f1f5f9]">
                  <button type="button" className="min-h-[44px] w-full text-left text-[14px] font-semibold text-[#4f46e5]" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "정상 접기 ‹" : `정상 ${normals.length}명 더 보기 ›`}
                  </button>
                </li>
              )}
            </ul>
          )}
      </Box>

      <Box icon={<CalendarDays />} tone="sl" title="이번 주" sub={`${short(mon)} ~ ${short(sun)}`}>
        {!board ? null : weekRows.length === 0 ? (
          <p className="px-6 py-5 text-[14px] text-[#596578]">이번 주에 미출근 · 지각 · 누락이 없습니다.</p>
        ) : (
          <ul className="px-4 py-1">
            {weekRows.map(({ u, days }) => (
              <li key={u.id} className="border-t border-[#f1f5f9] py-2.5 first:border-t-0">
                <b className="text-[15px] font-bold text-[#0f172a]">{u.name}</b>
                <span className="ml-1.5 text-[13.5px] text-[#475569]">{who(u)}</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {days.map(({ d, s }) => <StatusPill key={d} tone={s.tone}>{short(d)} {s.label}</StatusPill>)}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-[#eef1f5] px-4 py-2">
          <Btn kind="text" className="min-h-[44px] text-[14px]" onClick={onShowMonth}>한 달 표 보기 (PC에서 보기 좋습니다) ›</Btn>
        </div>
      </Box>
    </div>
  );
}
