import { prisma } from "@/lib/db";

type ScheduleEntry = { date: string; startTime?: string; endTime?: string };

// 최종 승인된 신청의 scheduleData를 실제 근무일정(Schedule)으로 생성
export async function materializeSchedules(
  tx: Pick<typeof prisma, "schedule">,
  req: { id: string; userId: string; scheduleData: unknown; templateName: string | null }
) {
  const entries = (Array.isArray(req.scheduleData) ? req.scheduleData : []) as ScheduleEntry[];
  for (const entry of entries) {
    if (!entry?.date) continue;
    const date = new Date(entry.date);
    if (isNaN(date.getTime())) continue;
    // 같은 날짜의 기존 일정은 승인된 일정으로 대체
    await tx.schedule.deleteMany({ where: { userId: req.userId, date } });
    await tx.schedule.create({
      data: {
        userId: req.userId,
        date,
        startTime: entry.startTime || "09:00",
        endTime: entry.endTime || "18:00",
        type: "WORK",
        note: req.templateName ? `근무일정 승인 (${req.templateName})` : "근무일정 승인",
      },
    });
  }
}
