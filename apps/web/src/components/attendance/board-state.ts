import type { PillTone } from "@/components/kit";

// 출퇴근 보드 칸 → 상태 한 마디(2026-10-23 본부 요청 ■0-11 · ■2 「지점 출퇴근기록」) — 원장 화면은 시각 대신 상태만.
// 상태 = 출근 · 지각 · 퇴근 · 퇴근 누락 · 미출근 · 휴가(+ 승인 대기 · 출근 전). 조퇴는 따로 보이지 않는다(요청서의 상태 목록, 보드 #52 와 같음).
// 색(■4): 문제(미출근 · 지각 · 누락)만 분홍, 승인 대기 주황, 휴가 파랑, 출근 연인디고, 퇴근 · 출근 전 회색.
// 순서(rank, ■4 「문제 있는 사람부터」): 미출근 · 누락 → 지각 → 승인 대기 → 휴가 → 출근 · 퇴근 → 출근 전

export type BoardCell = {
  sched?: string; in?: string; out?: string; hasIn?: boolean; hasOut?: boolean;
  leave?: string; late?: boolean; missing?: boolean; absent?: boolean; pending?: boolean;
};
export type DayState = { label: string; tone: PillTone; rank: number; problem: boolean };

export const hasIn = (c: BoardCell) => !!c.in || !!c.hasIn;
export const hasOut = (c: BoardCell) => !!c.out || !!c.hasOut;
const toMin = (hhmm: string | undefined) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** 그날 칸의 상태. today = KST 오늘(YYYY-MM-DD), nowMin = KST 지금(분). 앞날 · 기록 없는 날은 null */
export function dayState(c: BoardCell | undefined, d: string, today: string, nowMin: number): DayState | null {
  if (!c) return null;
  const i = hasIn(c), o = hasOut(c);
  if (c.pending) return { label: "승인 대기", tone: "wait", rank: 2, problem: false };
  if (c.leave && !i) return { label: c.leave, tone: "done", rank: 3, problem: false };
  if (c.absent) return { label: "미출근", tone: "rej", rank: 0, problem: true };
  if (c.missing) return { label: i ? "퇴근 누락" : "출근 누락", tone: "rej", rank: 0, problem: true };
  if (i && c.late) return { label: "지각", tone: "rej", rank: 1, problem: true };
  if (i && o) return { label: "퇴근", tone: "gray", rank: 4, problem: false };
  if (i) return { label: "출근", tone: "ind", rank: 4, problem: false };
  if (d === today && c.sched) {
    const start = toMin(c.sched.split("-")[0]);
    return start != null && nowMin > start
      ? { label: "미출근", tone: "rej", rank: 0, problem: true }
      : { label: "출근 전", tone: "gray", rank: 5, problem: false };
  }
  return null;
}

/** KST 오늘 · 지금(분) */
export function kstNow(): { today: string; nowMin: number } {
  const k = new Date(Date.now() + 9 * 3600_000);
  return { today: k.toISOString().slice(0, 10), nowMin: k.getUTCHours() * 60 + k.getUTCMinutes() };
}
