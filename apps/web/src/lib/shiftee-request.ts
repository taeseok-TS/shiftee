// 시프티 요청·승인 이력(보관) 이름표·요약 — 서버·클라이언트 공용(순수 모듈, DB 의존 없음).
// 2026-10-26 디렉터 승인 「요청이력은 표+화면으로」. 종류·상태 코드는 시프티 원문(CSV 「요청종류」·「상태」)이고 여기서 한글로만 바꾼다.
// 표에 없는 코드는 원문 그대로 보인다 — 새 코드가 보이면 KIND_LABEL 에 더한다.

export const SHIFTEE_KIND_LABEL: Record<string, string> = {
  create_leaves: "휴가 신청",
  delete_leave: "휴가 취소",
  edit_leave: "휴가 수정",
  clock_in: "출근 기록",
  clock_out: "퇴근 기록",
  create_attendance: "출퇴근 추가",
  edit_attendance: "출퇴근 수정",
  delete_attendance: "출퇴근 삭제",
  create_shifts: "근무일정 신청",
  edit_shift: "근무일정 수정",
  edit_shifts: "근무일정 수정",   // 시프티 원문은 복수형(2021~2026 CSV 실측 895건)
  delete_shift: "근무일정 삭제",
  change_device: "기기 변경",
};

export const SHIFTEE_STATUS_LABEL: Record<string, string> = {
  approved: "승인",
  rejected: "반려",
  cancelled: "취소",
  pending: "대기",
};

/** 종류 고르기 목록 — 자주 쓰는 순서(CSV 건수 많은 것부터) */
export const SHIFTEE_KIND_OPTIONS: { key: string; label: string }[] = [
  "create_leaves", "clock_in", "clock_out", "edit_attendance", "create_shifts", "create_attendance", "edit_shifts",
  "change_device", "delete_leave", "edit_leave", "delete_shift", "delete_attendance",
].map((k) => ({ key: k, label: SHIFTEE_KIND_LABEL[k] }));

export const SHIFTEE_STATUS_OPTIONS: { key: string; label: string }[] = ["approved", "rejected", "cancelled", "pending"].map((k) => ({ key: k, label: SHIFTEE_STATUS_LABEL[k] }));

export const shifteeKindLabel = (kind: string) => SHIFTEE_KIND_LABEL[kind] ?? kind;
export const shifteeStatusLabel = (status: string) => SHIFTEE_STATUS_LABEL[status] ?? status;

/** 상태 알약 색(components/kit StatusPill) — 승인 파랑 · 반려 분홍 · 대기 주황 · 취소 회색 */
export type ShifteeStatusTone = "wait" | "done" | "rej" | "gray";
export function shifteeStatusTone(status: string): ShifteeStatusTone {
  if (status === "approved") return "done";
  if (status === "rejected") return "rej";
  if (status === "pending") return "wait";
  return "gray";
}

/* ── KST 표시(서버 TZ 가 UTC 라 getHours 를 쓰면 9시간 어긋난다 — lib/kst 와 같은 방식, 문자열 입력도 받게 여기서) ── */
const KST_MS = 9 * 60 * 60 * 1000;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");
/** ISO 날짜시각 문자열인지(시프티 요청내용의 "2024-01-04T06:11:48Z" 꼴) */
export const isIsoDateTime = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(v);

/** 시각 → "2024-01-04 (목) 15:11" (KST). 날짜가 아니면 null */
export function fmtKstDateTime(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const k = new Date(d.getTime() + KST_MS);
  return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} (${DOW[k.getUTCDay()]}) ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
}
/** 시각 → "HH:mm" (KST) */
export function fmtKstTime(v: Date | string): string | null {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const k = new Date(d.getTime() + KST_MS);
  return `${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
}
/** 시각 → "2024-01-04" (KST) */
export function fmtKstDate(v: Date | string): string | null {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);
}
/** 시작~끝 → "2024-01-04 (목) 13:00 ~ 17:30" · 날이 다르면 끝에도 날짜. 종일 휴가(KST 00:00~23:59:59)는 날짜만 */
export function fmtKstRange(a: string, b: string): string | null {
  const s = fmtKstDateTime(a), e = fmtKstDateTime(b);
  if (!s || !e) return null;
  const sd = fmtKstDate(a), ed = fmtKstDate(b);
  const allDay = fmtKstTime(a) === "00:00" && /T14:59:59/.test(b);   // 시프티 종일 휴가 = 전날 15:00Z ~ 당일 14:59:59Z
  if (allDay) return sd === ed ? `${sd} 종일` : `${sd} ~ ${ed} 종일`;
  return sd === ed ? `${s} ~ ${fmtKstTime(b)}` : `${s} ~ ${e}`;
}

/** KST 날짜("YYYY-MM-DD") 하루의 시작 시각(UTC Date). 형식이 틀리면 null */
export function kstDayStart(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
  const utc = Date.UTC(y, mo - 1, da);
  // 2024-13-45 같은 값은 Date.UTC 가 자리올림해 조용히 다른 날이 된다 — 되돌려 같은 날인지 본다(검증 지적)
  const chk = new Date(utc);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== da) return null;
  const d = new Date(utc - KST_MS);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ── 요청내용 요약(표 한 줄) — 종류별로 사람이 읽을 핵심만. 원문 전체는 상세에서 키 그대로 보인다 ── */
type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const note = (c: J) => str(c.note);
const timeOf = (v: unknown) => (isIsoDateTime(v) ? fmtKstDateTime(v) : null);

export function shifteeSummary(kind: string, content: unknown): string {
  const c = obj(content);
  const parts: string[] = [];
  switch (kind) {
    case "create_leaves": {
      const name = str(c.display_name) ?? str(c.name) ?? str(c.leave_type);
      if (name) parts.push(name);
      const times = Array.isArray(c.leave_times) ? c.leave_times : [];
      const ranges = times
        .map((t) => (Array.isArray(t) && isIsoDateTime(t[0]) && isIsoDateTime(t[1]) ? fmtKstRange(t[0], t[1]) : null))
        .filter((x): x is string => !!x);
      if (ranges.length) parts.push(ranges.length > 2 ? `${ranges[0]} 외 ${ranges.length - 1}건` : ranges.join(", "));
      break;
    }
    case "delete_leave":
    case "edit_leave": {
      // 휴가 수정은 이름이 previous_* 에만 있고 기간은 「이전 → 새」 — 둘 다 보여야 무엇을 바꿨는지 읽힌다
      const name = str(c.display_name) ?? str(c.name) ?? str(c.leave_type) ?? str(c.previous_display_name) ?? str(c.previous_name) ?? str(c.previous_leave_type);
      if (name) parts.push(name);
      const now = isIsoDateTime(c.start_time) && isIsoDateTime(c.end_time) ? fmtKstRange(c.start_time, c.end_time) : null;
      const prev = isIsoDateTime(c.previous_start_time) && isIsoDateTime(c.previous_end_time) ? fmtKstRange(c.previous_start_time, c.previous_end_time) : null;
      if (now) parts.push(prev && prev !== now ? `${prev} → ${now}` : now);
      break;
    }
    case "clock_in": {
      const t = timeOf(c.clock_in_time);
      if (t) parts.push(`출근 ${t}`);
      break;
    }
    case "clock_out": {
      const t = timeOf(c.clock_out_time);
      if (t) parts.push(`퇴근 ${t}`);
      break;
    }
    case "create_attendance":
    case "edit_attendance":
    case "delete_attendance": {
      const i = timeOf(c.clock_in_time), o = timeOf(c.clock_out_time);
      const pi = timeOf(c.previous_clock_in_time), po = timeOf(c.previous_clock_out_time);
      if (i) parts.push(`출근 ${pi && pi !== i ? `${pi} → ` : ""}${i}`);
      if (o) parts.push(`퇴근 ${po && po !== o ? `${po} → ` : ""}${o}`);
      break;
    }
    case "create_shifts":
    case "edit_shift":
    case "edit_shifts":
    case "delete_shift": {
      const times = Array.isArray(c.shift_times) ? c.shift_times : [];
      const ranges = times
        .map((t) => { const s = obj(t); return isIsoDateTime(s.start_time) && isIsoDateTime(s.end_time) ? fmtKstRange(s.start_time, s.end_time) : null; })
        .filter((x): x is string => !!x)
        .sort();
      if (ranges.length) parts.push(ranges.length > 2 ? `${ranges[0]} 외 ${ranges.length - 1}건` : ranges.join(", "));
      else if (isIsoDateTime(c.start_time) && isIsoDateTime(c.end_time)) parts.push(fmtKstRange(c.start_time, c.end_time) ?? "");
      break;
    }
    case "change_device": {
      // 시프티 원문 키: new_device_model("SM-G991N") · new_device_os("android") · new_device_version
      const model = str(c.new_device_model) ?? str(c.device_model) ?? str(c.device_name);
      const os = str(c.new_device_os);
      if (model || os) parts.push([model, os ? `(${os}${str(c.new_device_version) ? ` ${c.new_device_version}` : ""})` : null].filter(Boolean).join(" "));
      break;
    }
  }
  const n = note(c);
  if (n) parts.push(`「${n.length > 60 ? `${n.slice(0, 60)}…` : n}」`);
  return parts.filter(Boolean).join(" · ");
}
