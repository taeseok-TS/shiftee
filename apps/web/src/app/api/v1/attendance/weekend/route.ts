import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, v1Error } from "@/lib/api-key";
import { prisma } from "@/lib/db";
import { excludedBranchNames, testAccountWhere } from "@/lib/employee-scope";
import { breakHours, isRealDate, toMin } from "@/lib/schedule-payload";

export const dynamic = "force-dynamic";

// 주말 · 휴일 근무 읽기 — 회사 연동 키(ORG, scope attendance:weekend:read) 전용 (2026-11-13 이예지 요청, 디렉터 「처리해 줘」)
// 직영 포털이 매달 급여 작업 때 큐브티 「주말 근무 엑셀」을 옮겨 붙이던 것을 바로 읽어 간다.
//   GET /api/v1/attendance/weekend?from=2026-10-20&to=2026-11-19
//     from · to — 근무 날짜(KST) 기준, 둘 다 넣는다. 한 번에 93일까지
//   → { from, to, rows: [...] }
// 대상 날짜 = 토 · 일 + 공휴일(Holiday). 사람 범위는 주말 근무 엑셀과 같다(관리자 · 통계 제외 지점 · 테스트 계정 · 지운 계정 제외).
// 한 줄 = (직원, 날짜). 아래 셋 중 하나라도 있으면 줄이 생긴다 — 엑셀은 실제 출근한 날만 넣지만 API 는 포털이 가려 쓰게 다 준다.
//   ① 근무일정(Schedule, WORK)  ② 출근 기록(Attendance.clockIn)  ③ 그날이 들어 있는 근무일정 신청(ScheduleRequest, 상태 무관)
// 출퇴근 기록은 (직원, 날짜) 당 하나뿐이다(@@unique) — 하루 두 번 출퇴근이라는 경우가 생기지 않는다.
// 지점은 지금 소속이다(지점 이동 이력은 따로 저장되지 않는다). 그날 실제로 찍은 곳은 clockInPlace(출근 장소)로 본다.
//
// ■ 확정 여부의 기준은 근무일정(scheduleId · scheduled*)이다 — 승인된 신청이 반영된 것이든 원장 · 본부가 직접 넣은 것이든.
//   approvalStatus 는 「그 근무일정을 만든 신청」 또는 (근무일정이 없으면) 「가장 최근 신청」의 상태라서,
//   반려 · 취소된 신청이 나중에 있어도 확정된 근무일정을 덮지 않는다(11/13 검증 F1 · F2).
//   근무일정을 만든 신청 = 그날이 들어 있는 승인된 신규 · 수정 신청 중 **승인이 가장 늦은 것**(반영은 나중 승인이 덮는다 — F3).
//   그 뒤 들어온 대기 신청은 pendingRequestId 로 따로 준다.
const MAX_DAYS = 93;
const STATUS_LABEL: Record<string, string> = { PENDING: "대기", APPROVED: "승인", REJECTED: "반려", CANCELLED: "취소" };
const KIND_LABEL: Record<string, string> = { CREATE: "신규", UPDATE: "수정", DELETE: "삭제" };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const dateOf = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
const kst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString();
const kstHhmm = (d: Date | null) => (d ? kst(d).slice(11, 16) : null);
/** 근무일정 시간 → 휴게 · 인정 분(주말 근무 엑셀 · 근무일정 신청과 같은 규칙: 4.5시간↑ 30분, 9시간↑ 60분) */
function minutesOf(s: string, e: string) {
  const span = toMin(e) - toMin(s);
  if (span <= 0) return { breakMinutes: null, recognizedMinutes: null };
  const br = Math.round(breakHours(span / 60) * 60);
  return { breakMinutes: br, recognizedMinutes: span - br };
}
/** 출근 장소 — 「지점 밖 · <직원이 쓴 사유> (원장 승인)」의 사유 원문은 내보내지 않는다(요청 범위 밖 개인 작성 글, 검증 권고) */
function placeOf(p: string | null | undefined): string | null {
  if (!p) return null;
  if (!p.startsWith("지점 밖")) return p;
  // 사유에 줄바꿈이 섞여도 통째로 버린다(재검증 N3) — 승인 주체만 남긴다
  const m = /\((본부|원장) 승인\)\s*$/.exec(p);
  return m ? `지점 밖 (${m[1]} 승인)` : "지점 밖";
}

type Req = { id: string; kind: string; status: string; createdAt: Date; updatedAt: Date; start: string | null; end: string | null };

export async function GET(request: NextRequest) {
  const a = await authenticateApiKey(request, "attendance:weekend:read", "read");
  if (a.ok === false) return a.res;
  if (a.p.key.kind !== "ORG") return v1Error(403, "회사 연동 키로만 쓸 수 있습니다.", "ORG_KEY_ONLY");

  const sp = new URL(request.url).searchParams;
  const from = (sp.get("from") || "").trim(), to = (sp.get("to") || "").trim();
  if (!isRealDate(from) || !isRealDate(to)) return v1Error(400, "from · to 는 YYYY-MM-DD 날짜여야 합니다(예: from=2026-10-20&to=2026-11-19).", "BAD_RANGE");
  if (from > to) return v1Error(400, "from 이 to 보다 늦습니다.", "BAD_RANGE");
  const fromD = dateOf(from), toD = dateOf(to);
  if (toD.getTime() - fromD.getTime() > (MAX_DAYS - 1) * 86400_000) return v1Error(400, `한 번에 ${MAX_DAYS}일까지 받을 수 있습니다.`, "RANGE_TOO_LONG");

  // 대상 날짜 — 토 · 일 · 공휴일(공휴일이 먼저)
  const holidayRows = await prisma.holiday.findMany({ where: { date: { gte: fromD, lte: toD } }, select: { date: true, name: true } });
  const holidayName = new Map(holidayRows.map((h) => [ymdOf(h.date), h.name]));
  const days: Date[] = [];
  const dayType = new Map<string, string>();
  for (let d = new Date(fromD); d <= toD; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = ymdOf(d), w = d.getUTCDay();
    if (holidayName.has(k)) dayType.set(k, "공휴일");
    else if (w === 6) dayType.set(k, "토");
    else if (w === 0) dayType.set(k, "일");
    else continue;
    days.push(new Date(d));
  }

  const excluded = await excludedBranchNames();
  const userWhere = {
    deletedAt: null, role: { not: "ADMIN" as const },
    ...(excluded.length ? { OR: [{ branch: null }, { branch: { notIn: excluded } }] } : {}),
    NOT: await testAccountWhere(),
  };
  const [schedules, atts, reqs] = days.length
    ? await Promise.all([
        prisma.schedule.findMany({ where: { date: { in: days }, type: "WORK", user: userWhere }, select: { id: true, userId: true, date: true, startTime: true, endTime: true } }),
        prisma.attendance.findMany({ where: { date: { in: days }, clockIn: { not: null }, user: userWhere }, select: { userId: true, date: true, clockIn: true, clockOut: true, clockInPlace: true } }),
        prisma.scheduleRequest.findMany({
          where: { startDate: { lte: toD }, endDate: { gte: fromD }, user: userWhere },
          select: { id: true, userId: true, kind: true, status: true, startDate: true, endDate: true, scheduleData: true, createdAt: true, updatedAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      ])
    : [[], [], []];

  type Acc = { userId: string; ymd: string; sched?: (typeof schedules)[number]; att?: (typeof atts)[number]; reqs: Req[] };
  const map = new Map<string, Acc>();
  const at = (userId: string, ymd: string) => {
    const k = `${userId}|${ymd}`;
    let r = map.get(k);
    if (!r) { r = { userId, ymd, reqs: [] }; map.set(k, r); }
    return r;
  };
  for (const s of schedules) at(s.userId, ymdOf(s.date)).sched = s;
  for (const t of atts) at(t.userId, ymdOf(t.date)).att = t;
  // 근무일정 신청 — 날짜별 항목(scheduleData)에서 대상 날짜만. 신청 기간 밖 날짜는 반영되지 않으므로 뺀다(lib/schedule-materialize 와 같게)
  for (const q of reqs) {
    const qs = ymdOf(q.startDate), qe = ymdOf(q.endDate);
    const entries = Array.isArray(q.scheduleData) ? (q.scheduleData as unknown[]) : [];
    const seen = new Set<string>();
    for (const e of entries) {
      const date = (e as { date?: unknown })?.date;
      if (!isRealDate(date) || seen.has(date)) continue;
      seen.add(date);
      if (date < qs || date > qe || !dayType.has(date)) continue;
      const kind = q.kind || "CREATE";
      // 시각이 빠진 옛 신청(2026-09-08 이전)은 승인 때 09:00/18:00 으로 반영됐다(lib/schedule-materialize) — 같게 채운다(3차 검증)
      const st = (e as { startTime?: unknown }).startTime ?? "09:00", et = (e as { endTime?: unknown }).endTime ?? "18:00";
      const ok = (v: unknown): v is string => typeof v === "string" && TIME_RE.test(v);
      at(q.userId, date).reqs.push({
        id: q.id, kind, status: q.status, createdAt: q.createdAt, updatedAt: q.updatedAt,
        // 삭제 신청에 적힌 시각은 지울 일정이다 — 근무 시각으로 읽히지 않게 비운다(검증 권고)
        start: kind !== "DELETE" && ok(st) ? st : null,
        end: kind !== "DELETE" && ok(et) ? et : null,
      });
    }
  }

  const userIds = [...new Set([...map.values()].map((r) => r.userId))];
  const users = new Map(
    (userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, empNo: true, branch: true, jobGroup: true } }) : [])
      .map((u) => [u.id, u]),
  );
  const rows = [...map.values()]
    .filter((r) => users.has(r.userId))
    .sort((x, y) => x.ymd.localeCompare(y.ymd) || users.get(x.userId)!.name.localeCompare(users.get(y.userId)!.name, "ko") || x.userId.localeCompare(y.userId))
    .map((r) => {
      const u = users.get(r.userId)!;
      const m = r.sched ? minutesOf(r.sched.startTime, r.sched.endTime) : { breakMinutes: null, recognizedMinutes: null };
      // 근무일정을 만든 신청 — 승인된 신규 · 수정 중 승인(상태가 바뀐 시각)이 가장 늦은 것
      // 승인된 삭제가 있으면 그보다 뒤에 승인된 것만 — 삭제 뒤 직접 다시 넣은 일정에 지운 옛 신청이 붙지 않게(재검증 N2)
      const lastDelete = r.reqs.filter((q) => q.status === "APPROVED" && q.kind === "DELETE").reduce((t, q) => Math.max(t, q.updatedAt.getTime()), 0);
      const approved = r.reqs
        .filter((q) => q.status === "APPROVED" && q.kind !== "DELETE" && q.updatedAt.getTime() > lastDelete)
        .sort((p, q) => p.updatedAt.getTime() - q.updatedAt.getTime() || p.id.localeCompare(q.id))
        .pop();
      const latest = r.reqs[r.reqs.length - 1];   // 신청 시각 순으로 쌓였다
      // 근무일정이 있으면: 그것을 만든 승인 신청(없으면 직접 등록 — null). 없으면: 가장 최근 신청(반려 · 취소 · 대기 · 승인된 삭제)
      const shown = r.sched ? approved ?? null : latest ?? null;
      // 아직 결재를 기다리는 신청 중 가장 최근 것(위에 고른 것 제외) — 승인되면 근무일정이 바뀐다
      const pending = r.reqs.filter((q) => q.status === "PENDING" && q !== shown).pop() ?? null;
      const outKst = r.att?.clockOut ? kst(r.att.clockOut).slice(0, 10) : null;
      return {
        id: `${r.userId}_${r.ymd}`,
        empNo: u.empNo != null ? String(u.empNo).padStart(5, "0") : null,
        name: u.name,
        branch: u.branch,
        jobGroup: u.jobGroup,
        workDate: r.ymd,
        dayType: dayType.get(r.ymd)!,
        holidayName: holidayName.get(r.ymd) ?? null,
        // 근무일정 — 확정 여부의 기준(주말근로수당 인정 기준). 승인된 신청이 반영된 것 또는 원장 · 본부 직접 등록
        scheduleId: r.sched?.id ?? null,
        // 승인된 신청과 시각이 다르면 원장 · 본부가 승인 뒤 직접 고친 것(재검증 N1)
        scheduleSource: r.sched
          ? !approved ? "직접 등록"
            : approved.start === r.sched.startTime && approved.end === r.sched.endTime ? "신청 승인" : "직접 수정"
          : null,
        scheduledStart: r.sched?.startTime ?? null,
        scheduledEnd: r.sched?.endTime ?? null,
        breakMinutes: m.breakMinutes,
        recognizedMinutes: m.recognizedMinutes,
        // 실제 기록
        checkIn: kstHhmm(r.att?.clockIn ?? null),
        checkOut: kstHhmm(r.att?.clockOut ?? null),
        checkOutNextDay: outKst != null && outKst > r.ymd,   // 자정 넘긴 퇴근(checkOut 이 checkIn 보다 작게 보인다)
        clockInPlace: placeOf(r.att?.clockInPlace),
        // 신청 — 위 규칙으로 고른 한 건
        requestId: shown?.id ?? null,
        requestKind: shown ? KIND_LABEL[shown.kind] ?? shown.kind : null,
        approvalStatus: shown ? STATUS_LABEL[shown.status] ?? shown.status : null,
        requestedStart: shown?.start ?? null,
        requestedEnd: shown?.end ?? null,
        requestedAt: shown ? shown.createdAt.toISOString() : null,
        // 아직 결재 전인 뒤 신청
        pendingRequestId: pending?.id ?? null,
        pendingRequestKind: pending ? KIND_LABEL[pending.kind] ?? pending.kind : null,
        pendingStart: pending?.start ?? null,
        pendingEnd: pending?.end ?? null,
      };
    });

  return NextResponse.json({ from, to, rows }, { headers: { "Cache-Control": "no-store, private" } });
}
