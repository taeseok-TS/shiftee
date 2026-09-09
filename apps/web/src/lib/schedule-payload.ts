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

/** 하루 휴게시간 — 신청 화면과 **같은 규칙**이어야 한다(다르면 화면과 기록이 어긋난다). */
export function breakHours(spanHours: number): number {
  if (spanHours >= 9) return 1;
  if (spanHours >= 4.5) return 0.5;
  return 0;
}

/** 값이 "HH:MM" 문자열인지 본다. 문자열이 아니면 애초에 거절한다 —
 *  String(v) 로 억지로 바꾸면 `{toString:1}` 같은 값에서 **메시지를 만들다 던져** 500 이 되고,
 *  통과시켜도 검증한 값이 아니라 원본이 DB 로 들어간다(2026-09-09 검증에서 실증). */
export function asHhmm(v: unknown): string | null {
  return typeof v === "string" && TIME_RE.test(v) ? v : null;
}

/** 근무 유형 — enum 밖의 값이 그대로 들어가면 Prisma 가 던져 500 이 된다. */
export function asScheduleType(v: unknown): "WORK" | "OFF" | "HOLIDAY" | null {
  if (v === undefined || v === null || v === "") return "WORK";
  return v === "WORK" || v === "OFF" || v === "HOLIDAY" ? v : null;
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
      // ⚠ String(date) 를 쓰면 안 된다. `{toString: 1}` 같은 값이 오면 **메시지를 만들다**
      //   TypeError 를 던지고, 이 함수 호출은 try 밖이라 미처리 500 이 된다
      //   (2026-09-09 검증에서 실증 — 500 하나 막고 하나 새로 만들었다).
      const shown = typeof date === "string" ? date.slice(0, 40) : `(${typeof date})`;
      return { ok: false, error: `날짜 형식이 올바르지 않습니다: ${shown}` };
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
    // 총 근무시간은 **실근무시간**(구속시간 − 휴게)으로 센다. 화면이 그렇게 보여주고
    // 기존 기록 15건도 전부 그 기준이다 — 여기만 구속시간으로 세면 결재자가 예전 건과
    // 비교할 수 없다(2026-09-09 검증에서 적발).
    const span = (en - s) / 60;
    totalMin += Math.max(span - breakHours(span), 0) * 60;
    entries.push({ date, startTime: st, endTime: et });
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : 1));
  // 총 근무시간은 **서버가 계산한다.** 신청자가 보낸 값을 그대로 믿으면
  // 결재자가 보는 유일한 정량 정보가 신청자 자유입력이 된다.
  // (승인된 휴가 차감은 DB 조회가 필요해 호출부에서 뺀다 — deductLeaveHours)
  return { ok: true, entries, totalHours: Math.round((totalMin / 60) * 10) / 10 };
}
