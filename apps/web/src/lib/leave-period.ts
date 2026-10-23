// 휴가 · 일정 기간 표기와 이어진 날 묶기 (2026-10-23 오픈 전 요청 ■2 · ■3 · ■4) — 화면 전용 순수 함수(서버 · 화면 둘 다 써도 된다)
//
//  · fmtDayKo("2026-10-31")            → 「10월 31일 (토)」
//  · fmtRangeKo("2026-11-02","2026-11-04") → 「11월 2일 (월) ~ 4일 (수)」, 달이 바뀌면 「10월 26일 (월) ~ 11월 30일 (월)」,
//    해가 바뀌면 양쪽에 연도 「2026년 8월 4일 (화) ~ 2027년 6월 30일 (수)」, 하루면 「10월 30일 (금)」
//  · groupContiguous(list): 같은 사람 · 같은 유형 · 같은 상태이고, 사이에 주말 · 공휴일만 끼어 있으면 한 묶음(DB 는 그대로 — 화면에서만)
//
// 날짜는 「YYYY-MM-DD」 또는 ISO 문자열(앞 10자리)을 받는다 — 달력 날짜로만 다룬다(시간대 영향 없게 UTC 로 계산)

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

export const ymdOf = (v: string | Date): string => (typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10));

function parts(v: string | Date) {
  const [y, m, d] = ymdOf(v).split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, dow };
}

/** 「10월 31일 (토)」 — withYear 면 「2026년 10월 31일 (토)」 */
export function fmtDayKo(v: string | Date, withYear = false): string {
  const p = parts(v);
  return `${withYear ? `${p.y}년 ` : ""}${p.m}월 ${p.d}일 (${DOW[p.dow]})`;
}

/** 좁은 칸용 「10/31 (토)」 */
export function fmtDayShort(v: string | Date): string {
  const p = parts(v);
  return `${p.m}/${p.d} (${DOW[p.dow]})`;
}

/** 기간 — 해가 바뀌는 기간만 연도. 같은 달이면 끝 날짜는 「4일 (수)」 */
export function fmtRangeKo(start: string | Date, end: string | Date): string {
  const a = parts(start), b = parts(end);
  if (ymdOf(start) === ymdOf(end)) return fmtDayKo(start);
  if (a.y !== b.y) return `${fmtDayKo(start, true)} ~ ${fmtDayKo(end, true)}`;
  if (a.m === b.m) return `${fmtDayKo(start)} ~ ${b.d}일 (${DOW[b.dow]})`;
  return `${fmtDayKo(start)} ~ ${fmtDayKo(end)}`;
}

/** 좁은 칸용 기간 「11/2 (월) ~ 11/4 (수)」 — 해가 바뀌면 「2026/12/28 (월) ~ 2027/1/2 (토)」 */
export function fmtRangeShort(start: string | Date, end: string | Date): string {
  const a = parts(start), b = parts(end);
  if (ymdOf(start) === ymdOf(end)) return fmtDayShort(start);
  if (a.y !== b.y) return `${a.y}/${fmtDayShort(start)} ~ ${b.y}/${fmtDayShort(end)}`;
  return `${fmtDayShort(start)} ~ ${fmtDayShort(end)}`;
}

const addDay = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const isWeekendYmd = (ymd: string) => { const w = parts(ymd).dow; return w === 0 || w === 6; };

/** a 가 끝난 다음 날부터 b 시작 전날까지가 모두 주말 · 공휴일(또는 없음)이면 이어진 것으로 본다. 겹치거나 맞닿아도 이어진 것 */
export function isContiguous(aEnd: string, bStart: string, holidays?: Set<string>): boolean {
  if (bStart <= addDay(aEnd, 1)) return true;
  let d = addDay(aEnd, 1);
  for (let i = 0; i < 14 && d < bStart; i++, d = addDay(d, 1)) {
    if (!isWeekendYmd(d) && !holidays?.has(d)) return false;
  }
  return d >= bStart;
}

export type GroupableLeave = { id: string; userId: string; type: string; status: string; startDate: string; endDate: string; days?: number | null };
export type LeaveGroup<T> = { key: string; items: T[]; first: T; startDate: string; endDate: string; days: number };

/**
 * 같은 사람 · 같은 유형 · 같은 상태 + 날짜가 이어진(사이 주말 · 공휴일만) 신청을 한 묶음으로.
 * 돌려주는 순서는 받은 목록에서 묶음의 첫 건이 처음 나온 자리 그대로(부르는 쪽이 정렬을 정한다).
 * 묶음 안 items 는 날짜 오름차순.
 */
export function groupContiguous<T extends GroupableLeave>(list: T[], holidays?: Set<string>): LeaveGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const r of list) {
    const k = `${r.userId}|${r.type}|${r.status}`;
    const arr = byKey.get(k); if (arr) arr.push(r); else byKey.set(k, [r]);
  }
  const groupOf = new Map<string, LeaveGroup<T>>();   // 신청 id → 묶음
  for (const [k, arr] of byKey) {
    const sorted = [...arr].sort((x, y) => ymdOf(x.startDate).localeCompare(ymdOf(y.startDate)) || ymdOf(x.endDate).localeCompare(ymdOf(y.endDate)));
    let cur: LeaveGroup<T> | null = null;
    for (const r of sorted) {
      const s = ymdOf(r.startDate), e = ymdOf(r.endDate);
      if (cur && isContiguous(cur.endDate, s, holidays)) {
        cur.items.push(r);
        if (e > cur.endDate) cur.endDate = e;
        cur.days += Number(r.days ?? 0);
      } else {
        cur = { key: `${k}|${s}`, items: [r], first: r, startDate: s, endDate: e, days: Number(r.days ?? 0) };
      }
      groupOf.set(r.id, cur);
    }
  }
  const out: LeaveGroup<T>[] = [];
  const seen = new Set<LeaveGroup<T>>();
  for (const r of list) {
    const g = groupOf.get(r.id);
    if (g && !seen.has(g)) { seen.add(g); out.push(g); }
  }
  return out;
}

/** 「11월 2일 (월) ~ 4일 (수)」 처럼 묶음 기간 */
export const fmtGroupRange = (g: { startDate: string; endDate: string }) => fmtRangeKo(g.startDate, g.endDate);

/** 오늘 → 다가오는 순(지난 것은 뒤로, 지난 것끼리는 최근부터) — 원장 지점 휴가 목록(■2) */
export function upcomingFirst<T extends { startDate: string; endDate: string }>(list: T[], todayYmd: string): T[] {
  return [...list].sort((a, b) => {
    const aPast = ymdOf(a.endDate) < todayYmd, bPast = ymdOf(b.endDate) < todayYmd;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return aPast ? ymdOf(b.startDate).localeCompare(ymdOf(a.startDate)) : ymdOf(a.startDate).localeCompare(ymdOf(b.startDate));
  });
}
