import { prisma } from "@/lib/db";
import { isRealDate, toMin } from "@/lib/schedule-payload";

type ScheduleEntry = { date: string; startTime?: string; endTime?: string };

// 최종 승인된 신청의 scheduleData를 실제 근무일정(Schedule)으로 생성
//
// ⚠ 신청 시점에 이미 검증하지만(lib/schedule-payload) 여기서도 다시 본다 —
//   **2026-09-08 이전에 만들어진 신청**에는 검증을 거치지 않은 payload 가 남아 있고,
//   그게 승인되는 순간 그대로 근무일정이 된다. 근무일정은 지각.조퇴.퇴근상한의
//   기준이므로 이상한 값이 들어오면 근태가 통째로 틀어진다.
//   범위(startDate~endDate) 밖 날짜도 버린다 — 결재자는 기간만 보고 승인했다.
export async function materializeSchedules(
  tx: Pick<typeof prisma, "schedule">,
  req: { id: string; userId: string; scheduleData: unknown; templateName: string | null;
         startDate?: Date | null; endDate?: Date | null }
) {
  const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  const from = ymd(req.startDate);
  const to = ymd(req.endDate);

  const entries = (Array.isArray(req.scheduleData) ? req.scheduleData : []) as ScheduleEntry[];
  const seen = new Set<string>();

  for (const entry of entries) {
    const date = entry?.date;
    if (!isRealDate(date)) continue;              // 형식이 어긋난 날짜는 반영하지 않는다
    if (from && date < from) continue;            // 신청 기간 밖
    if (to && date > to) continue;
    if (seen.has(date)) continue;                 // 같은 날짜 중복
    seen.add(date);

    const st = entry.startTime ?? "09:00";
    const et = entry.endTime ?? "18:00";
    const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!TIME_RE.test(st) || !TIME_RE.test(et)) continue;
    if (toMin(et) <= toMin(st) || toMin(et) - toMin(st) > 12 * 60) continue;

    const [y, m, d] = date.split("-").map(Number);
    const dateUtc = new Date(Date.UTC(y, m - 1, d));   // @db.Date 는 UTC 자정 저장

    // 같은 날짜의 기존 일정은 승인된 일정으로 대체한다.
    // ⚠ delete→create 가 아니라 **upsert** 다. 같은 날짜에 대해 두 트랜잭션이 겹치면
    //   뒤늦은 delete 가 앞 트랜잭션이 넣은 행을 스냅샷상 못 보고 지나친 뒤 자기
    //   insert 에서 유니크 위반으로 죽는다(2026-09-09 검증에서 적발).
    const note = req.templateName ? `근무일정 승인 (${req.templateName})` : "근무일정 승인";
    await tx.schedule.upsert({
      where: { userId_date: { userId: req.userId, date: dateUtc } },
      create: { userId: req.userId, date: dateUtc, startTime: st, endTime: et, type: "WORK", note },
      update: { startTime: st, endTime: et, type: "WORK", note },
    });
  }
}
