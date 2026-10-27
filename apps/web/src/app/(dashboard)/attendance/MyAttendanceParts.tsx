"use client";

// 직원 「근태 › 내 출퇴근」 부품(2026-10-23 본부 요청 ■0-7 · ■0-11 · ■1 → 시안 S1-1)
//  · TodayPanel     — 오늘 내 근무(「13:00 – 22:00」) · 상태 점 · 지난 7일 상태 알약(퇴근 누락이면 「수정 요청」) · 「출퇴근 기록 요청」.
//                     출근 버튼은 화면 아래 큰 버튼 하나(폰은 아래 고정 띠) — 「출근하기」 ↔ 「퇴근하기」, 인디고.
//                     직원은 웹에서 찍지 않는다(등록 기기 앱만) — 버튼 대신 안내 한 줄
//  · StatusHistory  — 지난 기록(기간별) 날짜마다 상태 알약만. 시각 · 일한 시간은 본부만(서버가 빼고 보낸다)
//  · FixDialog      — 퇴근 누락 · 출근 누락 「수정 요청」(결재 「지점 원장 → 본부」, 시각은 본부가 확인)
//  · RecordRequestDialog — 「출퇴근 기록 요청」 → 본부(본부가 기록을 내준다)
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Box, Btn, StatusPill, inputClass, type PillTone } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LEAVE_LABELS } from "@/lib/leave-catalog";

export type MyRecord = {
  id: string; date: string; clockIn: string | null; clockOut: string | null; clockedIn?: boolean; clockedOut?: boolean;
  status: string; userName?: string; zeroMinutes?: boolean;
};
export type MyDay = { status: string; scheduleType: string | null; startTime: string | null; endTime: string | null; leaveType: string | null };

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");
export const kstYmd = (t = Date.now()) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
const kstNowMin = () => { const k = new Date(Date.now() + 9 * 3600_000); return k.getUTCHours() * 60 + k.getUTCMinutes(); };
const ymdOf = (d: string) => d.slice(0, 10);
/** 「YYYY-MM-DD」에서 n일 뒤(음수면 앞) */
const addYmd = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
/** 「10월 23일 (금)」 */
export const dayLong = (ymd: string) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일 (${WEEK[dow(ymd)]})`;
/** 「10/23 (금)」 */
const dayShort = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))} (${WEEK[dow(ymd)]})`;
const toMin = (hhmm: string | null) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const hhmmOf = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(11, 16) : null);
// 큐브티로 출퇴근을 찍기 시작한 날 — 그 전 기록은 시프티 원본이라 여기서 고치지 않는다(서버와 같은 날, api/attendance-requests)
const CUBETEE_START = "2026-10-26";

const inOf = (r: MyRecord) => r.clockedIn ?? !!r.clockIn;
const outOf = (r: MyRecord) => r.clockedOut ?? !!r.clockOut;

/** 기록 한 줄 → 상태 알약(출근 쪽 · 퇴근 쪽). 지난 날 한쪽만 있으면 누락 */
export function pillsOf(r: MyRecord, today: string): { label: string; tone: PillTone }[] {
  const d = ymdOf(r.date), past = d < today, i = inOf(r), o = outOf(r);
  if (r.zeroMinutes) return [{ label: "확인 필요", tone: "wait" }];
  const out: { label: string; tone: PillTone }[] = [];
  if (i) out.push(r.status === "LATE" ? { label: "지각", tone: "rej" } : { label: "출근", tone: "ind" });
  else if (o || past) out.push({ label: "출근 누락", tone: "rej" });
  if (o) out.push({ label: "퇴근", tone: "gray" });
  else if (i && past) out.push({ label: "퇴근 누락", tone: "rej" });
  return out;
}
/** 고칠 수 있는 누락인가 — 지난 날 · 큐브티 시작 뒤 · 31일 안 · 한쪽만 있음 */
const fixable = (r: MyRecord, today: string) => {
  const d = ymdOf(r.date);
  return d < today && d >= CUBETEE_START && (Date.parse(today) - Date.parse(d)) <= 31 * 86400_000 && inOf(r) !== outOf(r);
};

/** 지난 날 내 일정 · 휴가 — 「지난 7일」 기록 없는 날 알약용 */
type PastDay = { status: string; scheduleType: string | null; leaveType: string | null };
/** 지난 하루 알약 — 기록이 있으면 기록대로(+ 반차 등 휴가), 없으면 휴가 · 미출근 · 기록 없음 · 쉬는 날.
 *  info: undefined = 아직 받는 중, null = 못 읽음(기록만으로) */
function pastPills(r: MyRecord | null, info: PastDay | null | undefined, today: string): { label: string; tone: PillTone }[] {
  const leave = info?.leaveType ? LEAVE_LABELS[info.leaveType] ?? info.leaveType : info?.status === "LEAVE" ? "휴가" : null;
  if (r) {
    const out = pillsOf(r, today);
    return leave ? [...out, { label: leave, tone: "done" }] : out;
  }
  if (leave) return [{ label: leave, tone: "done" }];
  if (info === undefined) return [];
  if (info?.status === "ABSENT") return [{ label: "미출근", tone: "rej" }];
  if (info && info.scheduleType !== "WORK") return [{ label: "쉬는 날", tone: "gray" }];
  return [{ label: "기록 없음", tone: "gray" }];
}

/* ── 오늘 ───────────────────────────────────────────────────────────── */
export function TodayPanel({ role, today, recent, myDay, timesHidden, clockLoading, onClock, onFix, onRecordRequest }: {
  role: string; today: string; recent: MyRecord[]; myDay: MyDay | null | undefined; timesHidden: boolean;
  clockLoading: boolean; onClock: (type: "in" | "out") => void; onFix: (r: MyRecord) => void; onRecordRequest: () => void;
}) {
  const [nowMin, setNowMin] = useState<number | null>(null);   // 마운트 뒤에만(하이드레이션 어긋남 방지)
  useEffect(() => {
    const tick = () => setNowMin(kstNowMin());
    Promise.resolve().then(tick);
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  const rec = recent.find((r) => ymdOf(r.date) === today) ?? null;
  const clockedIn = !!rec && inOf(rec), clockedOut = !!rec && outOf(rec);
  const work = myDay?.scheduleType === "WORK" && myDay.startTime && myDay.endTime ? { start: myDay.startTime, end: myDay.endTime } : null;
  const leave = myDay?.status === "LEAVE" ? (myDay.leaveType ? LEAVE_LABELS[myDay.leaveType] ?? myDay.leaveType : "휴가") : null;
  const off = !work && !leave ? (myDay?.scheduleType === "OFF" || myDay?.scheduleType === "HOLIDAY" ? "오늘 휴무" : "오늘 근무일정 없음") : null;
  const startMin = toMin(work?.start ?? null);
  // 상태 점 — 출근 전 회색 · 출근(지각은 분홍) · 퇴근 회색
  const state = clockedOut ? { label: "퇴근", dot: "bg-[#94a3b8]" }
    : clockedIn ? (rec?.status === "LATE" ? { label: "지각 · 근무 중", dot: "bg-[#e11d48]" } : { label: "출근 · 근무 중", dot: "bg-[#4f46e5]" })
    : leave ? { label: leave, dot: "bg-[#60a5fa]" }
    : { label: work && startMin != null && nowMin != null && nowMin > startMin ? "출근 전 · 근무 시작 지남" : "출근 전", dot: "bg-[#cbd5e1]" };
  const canClock = role !== "EMPLOYEE";   // 직원은 등록된 휴대폰 앱에서만 찍는다(기기 잠금)
  const nowLabel = nowMin == null ? "" : `${pad(Math.floor(nowMin / 60))}:${pad(nowMin % 60)}`;
  const untilStart = !clockedIn && startMin != null && nowMin != null && nowMin <= startMin ? startMin - nowMin : null;
  const hint = clockedOut ? "오늘 퇴근을 찍었습니다"
    : untilStart != null ? `${work!.start} 출근까지 ${untilStart >= 60 ? `${Math.floor(untilStart / 60)}시간 ` : ""}${untilStart % 60}분 · 지금 ${nowLabel}`
    : clockedIn && work ? `${work.end} 퇴근 예정 · 지금 ${nowLabel}` : nowLabel ? `지금 ${nowLabel}` : "";
  // 지난 7일 = 어제부터 거꾸로 달력 7일 — 기록 없는 날 · 휴가 날도 한 줄씩(10/23 검증: 기록 있는 7건만 나와 빈 날이 빠졌다)
  const past7 = useMemo(() => Array.from({ length: 7 }, (_, i) => addYmd(today, -(i + 1))), [today]);
  // 그날 내 일정 · 휴가(GET /api/schedule/day?scope=self 의 내 줄). 못 읽은 날은 null — 기록만으로 그린다
  const [dayInfo, setDayInfo] = useState<Record<string, PastDay | null> | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all(past7.map((d) => fetch(`/api/schedule/day?date=${d}&scope=self`).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((list) => {
        if (!alive) return;
        const m: Record<string, PastDay | null> = {};
        past7.forEach((d, i) => { m[d] = list[i] ? ((list[i].employees?.[0] as PastDay | undefined) ?? { status: "NO_SCHEDULE", scheduleType: null, leaveType: null }) : null; });
        setDayInfo(m);
      });
    return () => { alive = false; };
  }, [past7]);

  return (
    <div className="pb-36 sm:pb-0">
      <Box>
        <div className="px-6 py-5">
          <div className="flex flex-wrap items-center gap-2 text-[14px] text-[#475569]">
            <span>오늘 내 근무 · {dayLong(today)}</span>
          </div>
          <p className="mt-1 text-[32px] font-extrabold leading-tight tracking-tight text-[#0f172a] tabular-nums">
            {work ? `${work.start} – ${work.end}` : leave ?? off}
          </p>
          <p className="mt-1.5 flex items-center gap-2 text-[14px] text-[#475569]">
            <i className={`inline-block h-2 w-2 rounded-full ${state.dot}`} aria-hidden />{state.label}
            {/* 찍은 시각은 본부만(■0-11) — 본부 계정으로 열었을 때만 보인다 */}
            {!timesHidden && rec && (hhmmOf(rec.clockIn) || hhmmOf(rec.clockOut)) && (
              <span className="text-[#596578]">· {[hhmmOf(rec.clockIn) && `출근 ${hhmmOf(rec.clockIn)}`, hhmmOf(rec.clockOut) && `퇴근 ${hhmmOf(rec.clockOut)}`].filter(Boolean).join(" · ")}</span>
            )}
          </p>
        </div>
        {/* PC — 카드 아래 큰 버튼(폰은 화면 아래 고정 띠) */}
        <div className="hidden border-t border-[#eef1f5] px-6 py-4 sm:block">
          <ClockAction canClock={canClock} clockedIn={clockedIn} clockedOut={clockedOut} loading={clockLoading} hint={hint} onClock={onClock} />
        </div>
      </Box>

      <Box title="지난 7일" sub={timesHidden ? "출근 · 퇴근을 찍었는지만 보입니다 — 본부가 승인한 「출퇴근 기록 요청」 기간은 시각도 보입니다" : "출근 · 퇴근 시각"}>
        <ul className="px-6 py-1">
          {past7.map((d) => {
            const r = recent.find((x) => ymdOf(x.date) === d) ?? null;
            const pills = pastPills(r, dayInfo ? dayInfo[d] : undefined, today);
            return (
              <li key={d} className="flex min-h-[52px] flex-wrap items-center gap-2 border-t border-[#f1f5f9] py-2.5 first:border-t-0">
                <span className="w-[76px] text-[14px] font-semibold text-[#0f172a]">{dayShort(d)}</span>
                <span className="flex flex-1 flex-wrap items-center gap-1.5">
                  {pills.map((p) => <StatusPill key={p.label} tone={p.tone}>{p.label}</StatusPill>)}
                  {/* 시각은 서버가 풀어 준 날만 온다(본부 · 승인된 기록 요청 기간, 2026-10-27 이예지 ⑦) */}
                  {r && (hhmmOf(r.clockIn) || hhmmOf(r.clockOut)) && (
                    <span className="text-[13px] tabular-nums text-[#4f46e5]">{hhmmOf(r.clockIn) || "—"} → {hhmmOf(r.clockOut) || "—"}</span>
                  )}
                </span>
                {r && fixable(r, today) && <Btn kind="text" className="min-h-[44px]" onClick={() => onFix(r)}>수정 요청 ›</Btn>}
              </li>
            );
          })}
          {role !== "ADMIN" && (
            <li className="flex min-h-[52px] items-center gap-2 border-t border-[#f1f5f9] py-2.5">
              <span className="flex-1 text-[15px] font-bold text-[#0f172a]">출퇴근 기록 요청</span>
              <Btn kind="text" className="min-h-[44px]" onClick={onRecordRequest}>본부에 요청 ›</Btn>
            </li>
          )}
        </ul>
      </Box>

      {/* 폰 — 화면 아래 고정 띠에 큰 버튼 하나 */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#e2e8f0] bg-white px-4 pt-3 sm:hidden" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}>
        <ClockAction canClock={canClock} clockedIn={clockedIn} clockedOut={clockedOut} loading={clockLoading} hint={hint} onClock={onClock} />
      </div>
    </div>
  );
}

function ClockAction({ canClock, clockedIn, clockedOut, loading, hint, onClock }: {
  canClock: boolean; clockedIn: boolean; clockedOut: boolean; loading: boolean; hint: string; onClock: (type: "in" | "out") => void;
}) {
  return (
    <div className="mx-auto w-full max-w-xl">
      {hint && <p className="mb-2 text-center text-[14px] font-semibold text-[#334155]">{hint}</p>}
      {canClock ? (
        <button type="button" disabled={loading || clockedOut} onClick={() => onClock(clockedIn ? "out" : "in")}
          className="h-14 w-full rounded-[14px] bg-[#4f46e5] text-[17px] font-bold text-white hover:bg-[#4338ca] disabled:bg-[#eef1f5] disabled:text-[#7c8798]">
          {loading ? "처리 중…" : clockedOut ? "오늘 퇴근했습니다" : clockedIn ? "퇴근하기" : "출근하기"}
        </button>
      ) : (
        <p className="rounded-[14px] bg-[#f1f5f9] px-4 py-3.5 text-center text-[14px] font-semibold text-[#475569]">출근 · 퇴근은 큐브티 앱에서 찍습니다</p>
      )}
    </div>
  );
}

/* ── 지난 기록(상태만) ───────────────────────────────────────────────── */
export function StatusHistory({ records, today, showName, mine, current, onFix }: {
  records: MyRecord[]; today: string; showName: boolean; mine: boolean;
  current?: { attendDays?: number; late: number; missingDays?: number; missedDays?: number; needsCheck?: number } | null;
  onFix: (r: MyRecord) => void;
}) {
  const rows = useMemo(() => [...records].sort((a, b) => (a.date < b.date ? 1 : -1)), [records]);
  return (
    <>
      {current && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "출근한 날", val: `${current.attendDays ?? 0}일` },
            { label: "지각", val: `${current.late}일` },
            { label: "출근 · 퇴근 누락", val: `${current.missingDays ?? 0}일` },
            { label: "미출근", val: `${current.missedDays ?? 0}일` },
          ].map((t) => (
            <div key={t.label} className="rounded-xl border border-[#eef1f5] bg-[#f8fafc] px-4 py-3">
              <p className="text-[13.5px] font-semibold text-[#475569]">{t.label}</p>
              <p className="text-[24px] font-extrabold text-[#0f172a] tabular-nums">{t.val}</p>
            </div>
          ))}
        </div>
      )}
      <Box title="날짜별 상태" sub="출퇴근 시각 · 일한 시간은 본부가 관리합니다 — 본부가 승인한 「출퇴근 기록 요청」 기간은 시각도 보입니다">
        <ul className="px-6 py-1">
          {rows.length === 0 && <li className="py-6 text-center text-[14px] text-[#596578]">이 기간에 기록이 없습니다.</li>}
          {rows.map((r) => (
            <li key={r.id} className="flex min-h-[52px] flex-wrap items-center gap-2 border-t border-[#f1f5f9] py-2.5 first:border-t-0">
              <span className="w-[120px] text-[14px] font-semibold text-[#0f172a]">{dayLong(ymdOf(r.date))}</span>
              {showName && <span className="w-20 truncate text-[14px] text-[#475569]">{r.userName ?? "-"}</span>}
              <span className="flex flex-1 flex-wrap items-center gap-1.5">
                {pillsOf(r, today).map((p) => <StatusPill key={p.label} tone={p.tone}>{p.label}</StatusPill>)}
                {/* 시각은 서버가 풀어 준 날만 온다(본부 · 승인된 기록 요청 기간, 2026-10-27 이예지 ⑦) */}
                {(hhmmOf(r.clockIn) || hhmmOf(r.clockOut)) && <span className="text-[13px] tabular-nums text-[#4f46e5]">{hhmmOf(r.clockIn) || "—"} → {hhmmOf(r.clockOut) || "—"}</span>}
              </span>
              {mine && fixable(r, today) && <Btn kind="text" className="min-h-[44px]" onClick={() => onFix(r)}>수정 요청 ›</Btn>}
            </li>
          ))}
        </ul>
      </Box>
    </>
  );
}

/* ── 수정 요청(퇴근 누락 · 출근 누락) ─────────────────────────────────── */
export function FixDialog({ target, onClose, onDone }: { target: MyRecord | null; onClose: () => void; onDone: () => void }) {
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const missingOut = !!target && inOf(target) && !outOf(target);
  useEffect(() => { if (target) Promise.resolve().then(() => { setTime(""); setReason(""); }); }, [target]);
  const submit = async () => {
    if (!target) return;
    if (!time) { toast.error(`${missingOut ? "퇴근" : "출근"}한 시각을 적어 주세요.`); return; }
    if (!reason.trim()) { toast.error("사유를 적어 주세요."); return; }
    setBusy(true);
    try {
      const body = missingOut
        ? { kind: "MISSED_OUT", workDate: ymdOf(target.date), clockOut: time, reason: reason.trim() }
        : { kind: "CORRECTION", workDate: ymdOf(target.date), clockIn: time, reason: reason.trim() };
      const res = await fetch("/api/attendance-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "보내지 못했습니다."); return; }
      toast.success(`수정 요청을 보냈습니다. 결재: ${d.approverLabel ?? "원장 → 본부"}`);
      onDone();
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{target ? `${dayLong(ymdOf(target.date))} ${missingOut ? "퇴근 누락" : "출근 누락"} 수정 요청` : "수정 요청"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[14px]">
          <label className="block">
            <span className="mb-1 block font-semibold text-[#334155]">{missingOut ? "퇴근한 시각" : "출근한 시각"}</span>
            <input type="time" className={`${inputClass} w-full`} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block font-semibold text-[#334155]">사유</span>
            <input className={`${inputClass} w-full`} maxLength={100} placeholder={missingOut ? "예: 퇴근 찍는 것을 잊음" : "예: 출근 찍는 것을 잊음"} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p className="text-[13.5px] text-[#596578]">결재 순서 · 지점 원장 → 본부. 원장은 상태만 보고, 적은 시각은 본부가 확인합니다.</p>
          <div className="flex justify-end gap-2">
            <Btn onClick={onClose}>닫기</Btn>
            <Btn kind="primary" disabled={busy} onClick={submit}>{busy ? "보내는 중…" : "요청 보내기"}</Btn>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── 출퇴근 기록 요청(본부로) ─────────────────────────────────────────── */
export function RecordRequestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const today = kstYmd();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!from || !to || from > to) { toast.error("기간을 확인해 주세요."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/attendance-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "RECORD", from, to, reason: reason.trim() || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "보내지 못했습니다."); return; }
      toast.success("본부에 출퇴근 기록을 요청했습니다. 본부가 확인해 전해 드립니다.");
      setReason("");
      onClose();
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>출퇴근 기록 요청</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[14px]">
          <p className="text-[#475569]">출퇴근 찍은 시각은 본부가 관리합니다. 기록이 필요하면 기간을 골라 요청하세요. 본부가 확인해 전해 드립니다.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" aria-label="시작일" className={inputClass} value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
            <span>~</span>
            <input type="date" aria-label="끝 날" className={inputClass} value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          </div>
          <label className="block">
            <span className="mb-1 block font-semibold text-[#334155]">쓰는 곳 (적지 않아도 됩니다)</span>
            <input className={`${inputClass} w-full`} maxLength={100} placeholder="예: 재직 확인 · 급여 확인" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <Btn onClick={onClose}>닫기</Btn>
            <Btn kind="primary" disabled={busy} onClick={submit}>{busy ? "보내는 중…" : "본부에 요청"}</Btn>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
