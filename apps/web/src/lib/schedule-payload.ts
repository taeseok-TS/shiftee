// 근무일정 신청 payload 검증 — 결재 정책과 실제 반영이 **같은 값**을 보게 하는 것이 목적.
//
// ⚠ 2026-09-08 검증에서 드러난 것들:
//  · 날짜를 `2026-09-26` 대신 `2026-09-26T00:00:00Z` 로 보내면 형식 검사에서 탈락해
//    **공휴일 조회에서 빠지고 요일 계산도 NaN 이 되어 "주말 아님"** 으로 판정됐다.
//    그런데 실제 반영은 `new Date()` 가 정상 파싱해 그 날짜에 일정을 만들었다.
//    → 추석 근무를 관리자 결재 없이 넣을 수 있었다.
//  · 실제 반영이 신청 기간(startDate~endDate)이 아니라 payload 날짜를 그대로 썼다.
//    결재자는 기간만 보므로 **승인한 것과 반영된 것이 달랐다.**
//  · 시간(startTime/endTime)에 검증이 없어 `23:59` 을 넣으면 영구 지각 면제,
//    `00:00~23:59` 이면 퇴근 상한이 24시간을 넘었다.
//
// 그래서 **엄격하게** 받는다. 애매하면 통과시키지 않고 거절한다 —
// 근무일정은 지각.조퇴.퇴근상한의 기준이라 조용히 넘어가면 근태가 통째로 틀어진다.

export type ScheduleEntry = { date: string; startTime: string; endTime: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "YYYY-MM-DD" 이면서 **실재하는 날짜**인가 (2026-02-30 같은 것을 걸러낸다) */
export function isRealDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * 신청 payload 를 검사해 **정규화된 목록**을 돌려준다.
 * 실패하면 사람이 읽을 수 있는 사유를 돌려준다(그대로 화면에 띄운다).
 */
export function parseScheduleData(
  raw: unknown,
  startDate: unknown,
  endDate: unknown
): { ok: true; entries: ScheduleEntry[]; totalHours: number } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "근무일정을 선택해주세요." };
  }
  if (raw.length > 366) {
    return { ok: false, error: "한 번에 신청할 수 있는 날짜는 366일까지입니다." };
  }
  if (!isRealDate(startDate) || !isRealDate(endDate)) {
    return { ok: false, error: "신청 기간이 올바르지 않습니다." };
  }
  if (startDate > endDate) {
    return { ok: false, error: "시작일이 종료일보다 늦습니다." };
  }

  const seen = new Set<string>();
  const entries: ScheduleEntry[] = [];
  let totalMin = 0;

  for (const e of raw) {
    const date = (e as { date?: unknown })?.date;
    if (!isRealDate(date)) {
      return { ok: false, error: `날짜 형식이 올바르지 않습니다: ${String(date)}` };
    }
    // ⚠ 신청 기간 **안**이어야 한다. 결재자는 기간만 보므로, 범위 밖 날짜를 받으면
    //   승인한 것과 반영되는 것이 달라진다.
    if (date < startDate || date > endDate) {
      return { ok: false, error: `신청 기간(${startDate}~${endDate}) 밖의 날짜가 있습니다: ${date}` };
    }
    if (seen.has(date)) {
      return { ok: false, error: `같은 날짜가 두 번 들어 있습니다: ${date}` };
    }
    seen.add(date);

    const st = (e as { startTime?: unknown }).startTime ?? "09:00";
    const et = (e as { endTime?: unknown }).endTime ?? "18:00";
    if (typeof st !== "string" || !TIME_RE.test(st) || typeof et !== "string" || !TIME_RE.test(et)) {
      return { ok: false, error: `근무 시간 형식이 올바르지 않습니다 (${date}). 예: 09:00` };
    }
    const s = toMin(st), en = toMin(et);
    if (en <= s) {
      return { ok: false, error: `종료 시간이 시작 시간보다 빠릅니다 (${date}).` };
    }
    // 하루 근무는 최대 12시간까지만 신청받는다. 이 값이 퇴근 상한의 기준이 되므로
    // 열어두면 상한 자체가 무의미해진다.
    if (en - s > 12 * 60) {
      return { ok: false, error: `하루 근무는 12시간을 넘을 수 없습니다 (${date}).` };
    }
    totalMin += en - s;
    entries.push({ date, startTime: st, endTime: et });
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : 1));
  // 총 근무시간은 **서버가 계산한다.** 신청자가 보낸 값을 그대로 믿으면
  // 결재자가 보는 유일한 정량 정보가 신청자 자유입력이 된다.
  return { ok: true, entries, totalHours: Math.round((totalMin / 60) * 100) / 100 };
}
