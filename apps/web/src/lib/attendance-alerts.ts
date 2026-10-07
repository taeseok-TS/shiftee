import { prisma } from "@/lib/db";
import { kstTodayDateUTC } from "@/lib/kst";
import { isResigned } from "@/lib/resign";
import { isHoliday } from "@/lib/holidays";

// ─── 휴대폰 근태 알림(2026-10-07 QA #11, 디렉터 결정) ─────────────────────────
// 근무일정(WORK)이 있는 날만 보낸다(일정 없는 날은 쉬는 날일 수 있다 — 출근 누락 안내는 지각 알림이 겸한다).
//  · 출근 10분 전        본인
//  · 지각(시작 5분 후)   본인 + 그 지점 원장(원장대행 포함). 본부에는 보내지 않는다
//  · 근무 종료 5분 전    본인 (출근했고 아직 퇴근 전일 때)
//  · 종료 5분 후 미퇴근  본인 — **중립 문구만**. 「초과근무」·근무시간을 적지 않는다(노무 분쟁 기록 방지, 디렉터)
// 승인된 휴가가 걸친 날은 보내지 않는다. 같은 알림은 하루 한 번(AttendanceAlertLog 유니크로 잡는다).
// 봇 틱(1분)마다 부른다 — 창을 넉넉히(1시간) 두어 틱이 밀리거나 재시작돼도 놓치지 않게 하되,
// 그보다 늦으면 보내지 않는다(밤늦게 「지각」이 오는 일이 없게).

type Kind = "BEFORE_START" | "LATE" | "END_SOON" | "AFTER_END";

const toMin = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** 오늘 이 알림을 이미 보냈으면 false — 유니크 제약으로 먼저 잡은 쪽만 보낸다(여러 틱·여러 컨테이너가 겹쳐도 한 번) */
async function claim(userId: string, date: Date, kind: Kind): Promise<boolean> {
  try {
    await prisma.attendanceAlertLog.create({ data: { userId, date, kind } });
    return true;
  } catch {
    return false;
  }
}

export async function runAttendanceAlerts(now: Date = new Date()) {
  const today = kstTodayDateUTC();
  const k = new Date(now.getTime() + 9 * 3600_000);
  const nowMin = k.getUTCHours() * 60 + k.getUTCMinutes();

  const schedules = await prisma.schedule.findMany({
    where: {
      date: today, type: "WORK",
      // 휴직·임시휴무는 일정이 남아 있어도 보내지 않는다(검증 P1)
      user: { isActive: true, deletedAt: null, role: { not: "ADMIN" }, employmentStatus: "ACTIVE" },
    },
    select: { userId: true, startTime: true, endTime: true, user: { select: { name: true, branch: true, role: true, resignDate: true } } },
  });
  if (schedules.length === 0) return;

  // 지금 어느 알림 창에 걸린 사람만 추린다(대부분의 틱에서 아무도 없다)
  type Due = { s: (typeof schedules)[number]; kind: Kind; start: number; end: number };
  const due: Due[] = [];
  for (const s of schedules) {
    if (isResigned(s.user.resignDate)) continue;
    const start = toMin(s.startTime), end = toMin(s.endTime);
    if (start == null || end == null || end <= start) continue;
    if (nowMin >= start - 10 && nowMin < start) due.push({ s, kind: "BEFORE_START", start, end });
    else if (nowMin >= start + 5 && nowMin < start + 65) due.push({ s, kind: "LATE", start, end });
    if (nowMin >= end - 5 && nowMin < end) due.push({ s, kind: "END_SOON", start, end });
    else if (nowMin >= end + 5 && nowMin < end + 65) due.push({ s, kind: "AFTER_END", start, end });
  }
  if (due.length === 0) return;

  const ids = [...new Set(due.map((d) => d.s.userId))];
  const [atts, leaves, pendIn, pendOut, sent] = await Promise.all([
    prisma.attendance.findMany({ where: { userId: { in: ids }, date: today }, select: { userId: true, clockIn: true, clockOut: true } }),
    prisma.leaveRequest.findMany({
      where: { userId: { in: ids }, status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } },
      select: { userId: true },
    }),
    prisma.attendanceRequest.findMany({ where: { userId: { in: ids }, workDate: today, action: "IN", status: "PENDING" }, select: { userId: true, clockOut: true } }),
    prisma.attendanceRequest.findMany({ where: { userId: { in: ids }, workDate: today, action: "OUT", status: "PENDING" }, select: { userId: true } }),
    prisma.attendanceAlertLog.findMany({ where: { userId: { in: ids }, date: today }, select: { userId: true, kind: true } }),
  ]);
  const att = new Map(atts.map((a) => [a.userId, a]));
  const onLeave = new Set(leaves.map((l) => l.userId));
  const waitingIn = new Set(pendIn.map((p) => p.userId));
  // 승인 대기 중인 퇴근(출근 요청에 담긴 퇴근, 지점 밖·사진·본부 퇴근 요청)도 퇴근한 것으로 본다(검증 C1)
  const waitingOut = new Set([...pendIn.filter((p) => !!p.clockOut).map((p) => p.userId), ...pendOut.map((p) => p.userId)]);
  // 공휴일에는 지각 판정을 하지 않으므로(출근 처리·calcStatus) 원장에게 「[지각]」을 보내지 않는다(검증 P2)
  const holidayToday = await isHoliday(new Date(today).toISOString().slice(0, 10)).catch(() => false);
  const already = new Set(sent.map((x) => `${x.userId}:${x.kind}`));

  const { botSendDM } = await import("@/lib/bot");
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  for (const d of due) {
    const uid = d.s.userId;
    if (onLeave.has(uid) || already.has(`${uid}:${d.kind}`)) continue;
    const a = att.get(uid);
    const clockedIn = !!a?.clockIn || waitingIn.has(uid);   // 출근 요청 대기 중이면 출근한 것으로 본다
    const clockedOut = !!a?.clockOut || waitingOut.has(uid);

    if ((d.kind === "BEFORE_START" || d.kind === "LATE") && clockedIn) continue;
    if ((d.kind === "END_SOON" || d.kind === "AFTER_END") && (!clockedIn || clockedOut)) continue;
    if (!(await claim(uid, today, d.kind))) continue;

    try {
      if (d.kind === "BEFORE_START") {
        await botSendDM(uid, `⏰ 출근 10분 전이에요\n오늘 근무 ${hhmm(d.start)} ~ ${hhmm(d.end)}`);
      } else if (d.kind === "LATE") {
        await botSendDM(uid, `⚠️ 출근 기록이 아직 없어요\n오늘 근무 시작 ${hhmm(d.start)} — 출근 버튼을 눌러 주세요.\n지점 밖이라면 출퇴근 화면에서 「지점 밖 출근 요청」을 보낼 수 있어요.`);
        // 그 지점 원장(+원장대행)에게도 — 원장 본인의 지각은 본인에게만
        if (d.s.user.branch && d.s.user.role !== "MANAGER" && !holidayToday) {
          const { branchManagers } = await import("@/lib/manager-branches");
          const { branchDelegates } = await import("@/lib/approval-delegate");
          const targets = new Set([
            ...(await branchManagers(d.s.user.branch).catch(() => [] as { id: string }[])).map((m) => m.id),
            ...(await branchDelegates(d.s.user.branch).catch(() => [] as string[])),
          ]);
          targets.delete(uid);
          for (const t of targets) {
            await botSendDM(t, `⚠️ [지각] ${d.s.user.name} — 근무 시작 ${hhmm(d.start)}, 아직 출근 기록이 없습니다.`).catch(() => {});
          }
        }
      } else if (d.kind === "END_SOON") {
        await botSendDM(uid, `🔔 곧 근무 종료 시간이에요 (${hhmm(d.end)})\n퇴근할 때 퇴근 버튼을 눌러 주세요.`);
      } else {
        // ⚠ 문구를 바꿀 때 근무시간·초과분을 적지 않는다(디렉터 지시 — 노무 분쟁의 기록이 될 수 있다)
        await botSendDM(uid, `퇴근 시간이 지났어요. 퇴근 버튼을 눌러 주세요.`);
      }
    } catch (e) {
      console.error("[근태 알림] 보내기 실패:", uid, d.kind, e);
    }
  }
}
